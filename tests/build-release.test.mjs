import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runReleaseBuild, buildRelease } from '../scripts/build-release.mjs';

const require = createRequire(import.meta.url);
const { bundleArguments } = require('../android/packages/app/scripts/expo-bundle.cjs');
const { configureBundleCache } = require('../android/packages/app/plugins/with-android-bundle-cache.js');
const builderConfig = require('../android/packages/desktop/electron-builder.cjs');
const { getMainFileMatchers, getNodeModuleFileMatcher } =
    require('../android/node_modules/app-builder-lib/out/fileMatcher.js');

test('desktop postcompile generates the installer from the package working directory', t => {
    const directory = mkdtempSync(join(tmpdir(), 'paseodog-postcompile-'));
    t.after(() => rmSync(directory, { recursive: true }));
    const desktop = new URL('../android/packages/desktop/', import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('package.json', desktop), 'utf8'));
    const [program, ...args] = manifest.scripts['build:main'].split('&&')[1].trim().split(/\s+/);
    const output = join(directory, 'installer.nsi');
    const result = spawnSync(program, [...args.slice(0, -1), output], {
        cwd: desktop, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(readFileSync(output).length > 0);
});

// 플랫폼별 필터도 공통 소스맵·임시파일 제외를 보존하고 네이티브 대상만 남긴다.
test('desktop filters do not create a second unrestricted file copy', () => {
    const directory = '/fixture/desktop';
    const debugLogger = { isEnabled: false };
    const packager = { config: builderConfig, projectDir: directory, buildResourcesDir: 'assets', debugLogger };
    const file = { isDirectory: () => false };
    for (const platform of ['linux', 'win', 'mac']) {
        const options = builderConfig[platform];
        const matchers = getMainFileMatchers(directory, '/output', value => value,
            options, { info: packager }, '/output', false);
        assert.equal(matchers.length, 1);
        const filter = matchers[0].createFilter();
        assert.equal(filter(directory + '/dist/main.js', file), true);
        assert.equal(filter(directory + '/dist/main.js.map', file), false);
        assert.equal(filter(directory + '/src/private-test.ts', file), false);
        const native = getNodeModuleFileMatcher(directory, '/output', value => value, options, packager).createFilter();
        assert.equal(native(directory + '/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude', file), false);
        if (platform !== 'mac') {
            assert.equal(native(directory + '/node_modules/sherpa-onnx-darwin-arm64/library.node', file), false);
            assert.equal(native(directory + `/node_modules/sherpa-onnx-${platform}-x64/library.node`, file), true);
            const foreign = platform === 'linux' ? 'win' : 'linux';
            assert.equal(native(directory + `/node_modules/sherpa-onnx-${foreign}-x64/library.node`, file), false);
        }
    }
});

// 자동 초기화만 생략하며 개발 서버 명령과 명시적 복구 요청은 보존한다.
test('bundle wrapper preserves every argument except the implicit Gradle cache reset', () => {
    const args = ['export:embed', '--platform', 'android', '--reset-cache', '--dev', 'false'];
    assert.deepEqual(bundleArguments(args, false), ['export:embed', '--platform', 'android', '--dev', 'false']);
    assert.deepEqual(bundleArguments(args, true), args);
    assert.deepEqual(bundleArguments(['start', '--reset-cache'], false), ['start', '--reset-cache']);
    assert.deepEqual(bundleArguments(args, false, '2'),
        ['export:embed', '--platform', 'android', '--dev', 'false', '--max-workers', '2']);
    assert.deepEqual(bundleArguments(['export:embed', '--max-workers', '3'], false, '2'),
        ['export:embed', '--max-workers', '3']);
    assert.throws(() => bundleArguments(args, false, '0'), /positive integer/);
});

// 지원하는 생성 템플릿만 교체하고 중복·알 수 없는 템플릿은 거부한다.
test('Expo native generation replaces one CLI entry point idempotently', () => {
    const original = 'cliFile = new File(["node", "--print", "require.resolve(\'@expo/cli\', { paths: [require.resolve(\'expo/package.json\')] })"].execute(null, rootDir).text.trim())';
    const result = configureBundleCache(`react {\n    ${original}\n}`);
    assert.equal(result, 'react {\n    cliFile = file("../../scripts/expo-bundle.cjs")\n}');
    assert.equal(configureBundleCache(result), result);
    assert.throws(() => configureBundleCache('unknown'), /Expected one Expo/);
    assert.throws(() => configureBundleCache(original + original), /Expected one Expo/);
});

// APK가 끝나지 않아도 웹 의존성만 준비되면 두 PC 패키징을 시작한다.
test('desktop packaging starts before a pending APK completes and dependencies run once', async () => {
    const calls = [];
    let finishAndroid;
    const android = new Promise(resolve => { finishAndroid = resolve; });
    const build = runReleaseBuild(async name => {
        calls.push(name);
        if (name === 'android') await android;
        if (name === 'windows') finishAndroid();
    });
    await build;
    assert.deepEqual(calls, ['dependencies', 'android', 'desktop-dependencies', 'web', 'desktop-main', 'linux', 'windows']);
});

// 독립 작업 중 실패해도 이미 시작한 빌드를 남기지 않고 모두 종료 후 실패를 알린다.
// APK와 두 PC 패키징이 겹치지 않게 무거운 작업을 최대 두 개로 제한한다.
test('release scheduling never overlaps Android with both desktop packagers', async () => {
    let finishAndroid;
    const android = new Promise(resolve => { finishAndroid = resolve; });
    let active = 0;
    let peak = 0;
    await runReleaseBuild(async name => {
        active++;
        peak = Math.max(peak, active);
        if (name === 'android') await android;
        else await new Promise(resolve => setImmediate(resolve));
        if (name === 'windows') finishAndroid();
        active--;
    });
    assert.equal(peak, 2);
    assert.equal(active, 0);
});

// 독립 작업 중 실패해도 이미 시작한 빌드를 남기지 않고 모두 종료 후 실패를 알린다.
test('Windows uses the free Android slot without waiting for an independent Linux package', async () => {
    let finishAndroid, finishLinux;
    const android = new Promise(resolve => { finishAndroid = resolve; });
    const linux = new Promise(resolve => { finishLinux = resolve; });
    const calls = [];
    await runReleaseBuild(async name => {
        calls.push(name);
        if (name === 'android') await android;
        if (name === 'linux') { finishAndroid(); await linux; }
        if (name === 'windows') {
            assert.ok(calls.includes('linux'));
            finishLinux();
        }
    });
    assert.equal(calls.filter(name => name === 'dependencies').length, 1);
});

test('failed builds drain their siblings and never start dependent stages', async () => {
    let androidCompleted = false;
    const calls = [];
    await assert.rejects(runReleaseBuild(async name => {
        calls.push(name);
        if (name === 'web') throw new Error('web failed');
        if (name === 'android') {
            await new Promise(resolve => setImmediate(resolve));
            androidCompleted = true;
        }
    }), /web failed/);
    assert.equal(androidCompleted, true);
    assert.deepEqual(calls, ['dependencies', 'android', 'desktop-dependencies', 'web']);
    await assert.rejects(runReleaseBuild(async () => { throw new Error('deps failed'); }), /deps failed/);
});

// 입력 검증은 빌드나 디렉터리 생성보다 먼저 실행한다.
test('release builds require explicit versions and separate absolute output/cache paths', async () => {
    await assert.rejects(buildRelease({ workspace: 'relative' }), /must be absolute/);
    await assert.rejects(buildRelease({
        workspace: '/unused', cacheRoot: '/unused-cache', signingInit: '/unused-init',
        versionCode: '0', version: '1.0.0',
    }), /positive version-code/);
});

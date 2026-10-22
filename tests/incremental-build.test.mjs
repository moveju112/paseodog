import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
    existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
    renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { buildPackage, withBuildLock } from '../android/scripts/build-package.mjs';

const require = createRequire(new URL('../plugin/package.json', import.meta.url));
const compilerPath = require.resolve('typescript/bin/tsc');

// 실제 TypeScript 컴파일러를 사용할 최소 패키지를 만들고 테스트 종료 시 정리한다.
function makeFixture(context) {
    const root = mkdtempSync(join(tmpdir(), 'paseodog-incremental-'));
    context.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
            target: 'ES2020', module: 'ESNext', strict: true, types: [],
            rootDir: 'src', outDir: 'dist', declaration: true,
            sourceMap: true, declarationMap: true, skipLibCheck: true,
        },
        include: ['src/**/*.ts'],
    }));
    writeFileSync(join(root, 'src/index.ts'), 'export const version = "first";\n');
    return root;
}

// 배포 출력 전체를 독립적인 비증분 컴파일 결과와 바이트 단위로 비교한다.
function assertFreshOutput(root) {
    const result = spawnSync(process.execPath, [
        compilerPath, '-p', join(root, 'tsconfig.json'),
        '--incremental', 'false', '--outDir', join(root, 'fresh'),
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const names = readdirSync(join(root, 'dist')).sort();
    assert.deepEqual(names, readdirSync(join(root, 'fresh')).sort());
    for (const name of names) {
        assert.deepEqual(readFileSync(join(root, 'dist', name)),
            readFileSync(join(root, 'fresh', name)), name);
    }
}

// 무변경 재사용과 실제 소스 수정 후 코드·선언·소스맵의 정확성을 검증한다.
test('incremental compilation preserves unchanged outputs and emits source changes exactly', context => {
    const root = makeFixture(context);
    assert.equal(buildPackage(root, compilerPath), 0);
    const originalTime = statSync(join(root, 'dist/index.js')).mtimeMs;
    assert.equal(buildPackage(root, compilerPath), 0);
    assert.equal(statSync(join(root, 'dist/index.js')).mtimeMs, originalTime);
    writeFileSync(join(root, 'src/index.ts'), 'export const version = "changed";\n');
    assert.equal(buildPackage(root, compilerPath), 0);
    assert.match(readFileSync(join(root, 'dist/index.js'), 'utf8'), /"changed"/);
    assert.match(readFileSync(join(root, 'dist/index.d.ts'), 'utf8'), /"changed"/);
    assertFreshOutput(root);
});

// 삭제·이름 변경 뒤 오래된 JS·선언·소스맵을 남기지 않는다.
test('source removal and rename remove every obsolete compiler output', context => {
    const root = makeFixture(context);
    writeFileSync(join(root, 'src/old.ts'), 'export const retired = true;\n');
    assert.equal(buildPackage(root, compilerPath), 0);
    renameSync(join(root, 'src/old.ts'), join(root, 'src/renamed.ts'));
    assert.equal(buildPackage(root, compilerPath), 0);
    for (const suffix of ['.js', '.js.map', '.d.ts', '.d.ts.map']) {
        assert.equal(existsSync(join(root, `dist/old${suffix}`)), false);
        assert.equal(existsSync(join(root, `dist/renamed${suffix}`)), true);
    }
    rmSync(join(root, 'src/renamed.ts'));
    assert.equal(buildPackage(root, compilerPath), 0);
    assertFreshOutput(root);
});

// 누락·변조된 출력과 명시적인 dist 정리 뒤에는 메타데이터도 무효화해 복구한다.
test('missing, modified and explicitly cleaned outputs are rebuilt safely', context => {
    const root = makeFixture(context);
    assert.equal(buildPackage(root, compilerPath), 0);
    rmSync(join(root, 'dist/index.d.ts'));
    assert.equal(buildPackage(root, compilerPath), 0);
    assert.equal(existsSync(join(root, 'dist/index.d.ts')), true);
    writeFileSync(join(root, 'dist/index.js'), 'stale output\n');
    assert.equal(buildPackage(root, compilerPath), 0);
    assert.match(readFileSync(join(root, 'dist/index.js'), 'utf8'), /"first"/);
    rmSync(join(root, 'dist'), { recursive: true });
    assert.equal(buildPackage(root, compilerPath), 0);
    assertFreshOutput(root);
});

// 실패 중 생성된 파일도 다음 성공 빌드에 섞이지 않게 정리한다.
test('a failed compilation cannot publish or retain an old successful cache receipt', context => {
    const root = makeFixture(context);
    assert.equal(buildPackage(root, compilerPath), 0);
    writeFileSync(join(root, 'src/failed.ts'), 'export const invalid: string = 1;\n');
    assert.notEqual(buildPackage(root, compilerPath), 0);
    assert.equal(existsSync(join(root, '.cache/paseodog-build/outputs.json')), false);
    rmSync(join(root, 'src/failed.ts'));
    assert.equal(buildPackage(root, compilerPath), 0);
    assert.equal(existsSync(join(root, 'dist/failed.js')), false);
    assertFreshOutput(root);
});

// 출력 경로가 패키지 밖으로 바뀐 설정은 어떤 정리 작업보다 먼저 거부한다.
test('compiler output outside package dist is rejected without removing files', context => {
    const root = makeFixture(context);
    const config = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8'));
    config.compilerOptions.outDir = 'outside';
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify(config));
    mkdirSync(join(root, 'outside'));
    writeFileSync(join(root, 'outside/keep.txt'), 'keep');
    assert.throws(() => buildPackage(root, compilerPath), /Expected package-local dist output/);
    assert.equal(readFileSync(join(root, 'outside/keep.txt'), 'utf8'), 'keep');
});

// 실제 npm 의존성 실행 경로에서 공통 타깃을 한 번씩만 호출하고 증분 캐시를 보존한다.
test('desktop dependencies build each shared target once without unconditional clean', context => {
    const root = makeFixture(context);
    const source = JSON.parse(readFileSync(new URL('../android/package.json', import.meta.url), 'utf8'));
    const scriptNames = ['build:desktop-deps', 'build:highlight', 'build:client', 'build:plugin'];
    writeFileSync(join(root, 'package.json'), JSON.stringify({
        private: true, workspaces: ['packages/*'],
        scripts: Object.fromEntries(scriptNames.map(name => [name, source.scripts[name]])),
    }));
    const logPath = join(root, 'calls.txt');
    writeFileSync(join(root, 'record.cjs'),
        `require('node:fs').appendFileSync(${JSON.stringify(logPath)}, process.argv[2] + '\\n');\n`);
    const targets = ['highlight', 'client', 'plugin', 'expo-two-way-audio', 'server', 'cli'];
    for (const name of targets) {
        const directory = join(root, 'packages', name);
        mkdirSync(directory, { recursive: true });
        writeFileSync(join(directory, 'package.json'), JSON.stringify({
            name: `@getpaseo/${name}`, version: '1.0.0',
            scripts: {
                clean: `node ../../record.cjs clean:${name}`,
                build: `node ../../record.cjs build:${name}`,
                'build:clean': 'npm run clean && npm run build',
            },
        }));
    }
    const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
        ['run', 'build:desktop-deps'], {
            cwd: root, encoding: 'utf8', shell: process.platform === 'win32',
        });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const calls = readFileSync(logPath, 'utf8').trim().split('\n');
    assert.deepEqual(calls.filter(call => call.startsWith('build:')),
        targets.map(name => `build:${name}`));
    assert.deepEqual(calls.filter(call => call.startsWith('clean:')), []);
});

// 실제 npm prepack 경로도 증분 검증을 거치고 무조건적인 clean은 호출하지 않는다.
test('package lifecycle preserves incremental compilation and daemon web export', context => {
    const root = makeFixture(context);
    const targets = ['cli', 'client', 'protocol', 'highlight', 'plugin', 'server'];
    const logPath = join(root, 'calls.txt');
    writeFileSync(join(root, 'record.cjs'),
        `require('node:fs').appendFileSync(${JSON.stringify(logPath)}, process.argv[2] + '\\n');\n`);
    writeFileSync(join(root, 'package.json'), JSON.stringify({
        private: true, workspaces: ['packages/*'],
        scripts: { 'build:daemon-web-ui': 'node record.cjs daemon-web' },
    }));
    for (const name of targets) {
        const source = JSON.parse(readFileSync(new URL(`../android/packages/${name}/package.json`, import.meta.url), 'utf8'));
        const directory = join(root, 'packages', name);
        mkdirSync(directory, { recursive: true });
        writeFileSync(join(directory, 'package.json'), JSON.stringify({
            name: `@getpaseo/${name}`, version: '1.0.0',
            scripts: {
                prepack: source.scripts.prepack,
                build: `node ../../record.cjs build:${name}`,
                'build:clean': `node ../../record.cjs clean:${name}`,
            },
        }));
    }
    const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
        ['run', 'prepack', '--workspaces'], {
            cwd: root, encoding: 'utf8', shell: process.platform === 'win32',
        });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const calls = readFileSync(logPath, 'utf8').trim().split('\n');
    assert.deepEqual(calls.filter(call => call.startsWith('build:')).sort(),
        targets.map(name => `build:${name}`).sort());
    assert.deepEqual(calls.filter(call => call.startsWith('clean:')), []);
    assert.equal(calls.filter(call => call === 'daemon-web').length, 1);
});

// 공유 출력 디렉터리의 두 컴파일과 자산을 함께 보존하고 삭제·복사 실패를 복구한다.
test('multiple configs and assets share one complete success receipt', context => {
    const root = makeFixture(context);
    const library = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8'));
    library.compilerOptions.outDir = 'dist/server';
    writeFileSync(join(root, 'tsconfig.server.json'), JSON.stringify(library));
    writeFileSync(join(root, 'tsconfig.scripts.json'), JSON.stringify({
        ...library,
        compilerOptions: {
            ...library.compilerOptions, rootDir: '.', outDir: 'dist',
            declaration: false, declarationMap: false,
        },
        include: ['scripts/**/*.ts', 'src/**/*.ts'],
    }));
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'scripts/entry.ts'),
        'import { version } from "../src/index.js"; export const result = version;\n');
    writeFileSync(join(root, 'src/retired.ts'), 'export const retired = true;\n');
    writeFileSync(join(root, 'assets/old.txt'), 'old');
    writeFileSync(join(root, 'package.json'), JSON.stringify({
        scripts: { 'build:assets': 'node copy-assets.cjs' },
    }));
    writeFileSync(join(root, 'copy-assets.cjs'), `
const fs = require('node:fs');
if (fs.existsSync('fail-assets')) process.exit(7);
fs.rmSync('dist/assets', {recursive:true, force:true});
fs.cpSync('assets', 'dist/assets', {recursive:true});
`);
    const options = { configs: ['tsconfig.server.json', 'tsconfig.scripts.json'], assetsScript: 'build:assets' };
    assert.equal(buildPackage(root, compilerPath, options), 0);
    assert.equal(existsSync(join(root, 'dist/server/index.js')), true);
    assert.equal(existsSync(join(root, 'dist/scripts/entry.js')), true);
    const before = statSync(join(root, 'dist/server/index.js')).mtimeMs;
    rmSync(join(root, 'assets/old.txt'));
    writeFileSync(join(root, 'assets/new.txt'), 'new');
    assert.equal(buildPackage(root, compilerPath, options), 0);
    assert.equal(statSync(join(root, 'dist/server/index.js')).mtimeMs, before);
    assert.equal(existsSync(join(root, 'dist/assets/old.txt')), false);
    assert.equal(readFileSync(join(root, 'dist/assets/new.txt'), 'utf8'), 'new');
    library.exclude = ['src/retired.ts'];
    writeFileSync(join(root, 'tsconfig.server.json'), JSON.stringify(library));
    assert.equal(buildPackage(root, compilerPath, options), 0);
    assert.equal(existsSync(join(root, 'dist/server/retired.js')), false);
    assert.equal(existsSync(join(root, 'dist/src/retired.js')), true);
    rmSync(join(root, 'src/retired.ts'));
    assert.equal(buildPackage(root, compilerPath, options), 0);
    assert.equal(existsSync(join(root, 'dist/server/retired.js')), false);
    assert.equal(existsSync(join(root, 'dist/src/retired.js')), false);
    assert.equal(existsSync(join(root, 'dist/scripts/entry.js')), true);
    writeFileSync(join(root, 'fail-assets'), '');
    assert.notEqual(buildPackage(root, compilerPath, options), 0);
    assert.equal(existsSync(join(root, '.cache/paseodog-build/outputs.json')), false);
    rmSync(join(root, 'fail-assets'));
    writeFileSync(join(root, 'scripts/entry.ts'), 'export const invalid: string = 1;\n');
    assert.notEqual(buildPackage(root, compilerPath, options), 0);
    assert.equal(existsSync(join(root, '.cache/paseodog-build/outputs.json')), false);
    writeFileSync(join(root, 'scripts/entry.ts'), 'export const restored = true;\n');
    assert.equal(buildPackage(root, compilerPath, options), 0);
    assert.match(readFileSync(join(root, 'dist/scripts/entry.js'), 'utf8'), /restored/);
    assert.equal(readFileSync(join(root, 'dist/assets/new.txt'), 'utf8'), 'new');
});

// 다른 실행의 잠금은 건드리지 않고 자신의 실패 경로에서만 잠금을 해제한다.
test('overlapping package builds fail without stealing or retaining locks', context => {
    const root = makeFixture(context);
    const cache = join(root, '.cache/paseodog-build');
    withBuildLock(cache, () => {
        assert.throws(() => buildPackage(root, compilerPath), /Package build already running/);
        assert.equal(existsSync(join(cache, 'lock/owner.json')), true);
    });
    assert.equal(existsSync(join(cache, 'lock')), false);
    assert.throws(() => withBuildLock(cache, () => { throw new Error('fixture failure'); }), /fixture failure/);
    assert.equal(existsSync(join(cache, 'lock')), false);
    assert.equal(buildPackage(root, compilerPath), 0);
});

// 의미가 바뀐 컴파일 옵션은 오래된 출력을 지우고 같은 옵션의 키 순서 변경은 캐시를 유지한다.
test('compiler option changes remove obsolete outputs without treating key order as a change', context => {
    const root = makeFixture(context);
    assert.equal(buildPackage(root, compilerPath), 0);
    const config = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8'));
    config.compilerOptions.declaration = false;
    config.compilerOptions.declarationMap = false;
    config.compilerOptions.sourceMap = false;
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify(config));
    assert.equal(buildPackage(root, compilerPath), 0);
    assert.deepEqual(readdirSync(join(root, 'dist')), ['index.js']);
    const before = statSync(join(root, 'dist/index.js')).mtimeMs;
    config.compilerOptions = Object.fromEntries(Object.entries(config.compilerOptions).reverse());
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify(config));
    assert.equal(buildPackage(root, compilerPath), 0);
    assert.equal(statSync(join(root, 'dist/index.js')).mtimeMs, before);
    assertFreshOutput(root);
});

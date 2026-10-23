import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import release from '../plugin/shared/release.json' with { type: 'json' };

const root = fileURLToPath(new URL('../', import.meta.url));

// 독립 빌드는 모두 종료를 확인하고 하나라도 실패하면 릴리즈 전체를 실패시킨다.
async function settleBuilds(builds) {
    const results = await Promise.allSettled(builds);
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, errors.map(error => error.message).join('; '));
}

// 공통 의존성은 한 번만 빌드하고 웹이 준비되는 즉시 PC 패키징을 시작한다.
export async function runReleaseBuild(run) {
    await run('dependencies');
    const android = run('android');
    await settleBuilds([
        android,
        (async () => {
            await run('web');
            await run('desktop-main');
            const linux = run('linux');
            // APK 또는 Linux가 끝나 빈 자리가 생기면 Windows를 시작한다. 최대 두 작업은 유지한다.
            const windows = (async () => {
                await Promise.race([android, linux]);
                await run('windows');
            })();
            await settleBuilds([linux, windows]);
        })(),
    ]);
}

// 고유 산출물 폴더와 재사용 캐시를 분리하고 플랫폼별 Metro 임시 경로를 고정한다.
export async function buildRelease({ workspace, cacheRoot, signingInit, versionCode, version, metroWorkers, checkpoint }) {
    for (const value of [workspace, cacheRoot, signingInit]) {
        if (!value || !isAbsolute(value)) throw new Error('workspace, cache-root and signing-init must be absolute');
    }
    if (!/^[1-9]\d*$/.test(versionCode ?? '') || !/^[0-9][0-9A-Za-z.+-]*$/.test(version ?? '')) {
        throw new Error('Explicit release version and positive version-code are required');
    }
    if (resolve(workspace) === resolve(cacheRoot)) throw new Error('Workspace must differ from cache-root');
    if (metroWorkers !== undefined && !/^[1-9]\d*$/.test(String(metroWorkers))) {
        throw new Error('metro-workers must be a positive integer');
    }
    if (Number(versionCode) !== release.versionCode || version !== `${release.version}.${release.versionCode}`)
        throw new Error('Release arguments must match plugin/shared/release.json');
    await mkdir(workspace, { recursive: true });
    const androidRoot = join(root, 'android');
    const desktopRoot = join(androidRoot, 'packages/desktop');
    const output = join(workspace, 'desktop');
    const builder = ['npx', 'electron-builder', '--config', 'electron-builder.cjs',
        `-c.directories.output=${output}`, `-c.extraMetadata.version=${version}`, '--publish', 'never'];
    const commands = {
        dependencies: [androidRoot, ['npm', 'run', 'build:desktop-deps']],
        android: [join(androidRoot, 'packages/app/android'), ['./gradlew', '--init-script', signingInit,
            'assembleRelease', `-PpaseodogVersionCode=${versionCode}`, `-PpaseodogVersionName=${version}`]],
        web: [join(androidRoot, 'packages/app'), ['npx', 'expo', 'export', '--platform', 'web',
            ...(metroWorkers ? ['--max-workers', metroWorkers] : [])]],
        'desktop-main': [desktopRoot, ['npm', 'run', 'build:main']],
        linux: [desktopRoot, [...builder, '--linux', 'deb', 'AppImage']],
        windows: [desktopRoot, [...builder, '--win', 'nsis', '--x64']],
    };
    const execute = async name => {
        const temporary = join(cacheRoot, name);
        await mkdir(temporary, { recursive: true });
        const [cwd, command] = commands[name];
        const start = performance.now();
        const log = createWriteStream(join(workspace, `${name}.log`), { flags: checkpoint ? 'a' : 'wx' });
        console.log(`${new Date().toISOString()} ${name}: start`);
        await new Promise((resolveRun, reject) => {
            const child = spawn('systemd-run', ['--user', '--scope', '-q',
                '-p', 'MemoryHigh=16G', '-p', 'MemorySwapMax=2G', ...command], {
                cwd,
                env: { ...process.env, TMPDIR: temporary, CI: '1',
                    PASEODOG_BUILD_CACHE_ROOT: cacheRoot,
                    PASEODOG_RELEASE_METRICS: join(workspace, `${name}-metrics.jsonl`),
                    ...(metroWorkers ? { PASEODOG_METRO_WORKERS: metroWorkers } : {}),
                    APP_VARIANT: 'production', PASEO_WEB_PLATFORM: name === 'web' ? 'electron' : '' },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            log.on('error', reject);
            child.stdout.pipe(log, { end: false });
            child.stderr.pipe(log, { end: false });
            child.on('error', error => { log.end(); reject(error); });
            child.on('close', (code, signal) => {
                log.end(() => {
                    console.log(`${new Date().toISOString()} ${name}: ${(performance.now() - start).toFixed(0)}ms exit=${code} signal=${signal}`);
                    if (code === 0) resolveRun();
                    else reject(new Error(`${name} failed (${signal ?? code}); see ${join(workspace, `${name}.log`)}`));
                });
            });
        });
        if (name === 'android') {
            await copyFile(join(cwd, 'app/build/outputs/apk/release/app-arm64-v8a-release.apk'),
                join(workspace, `PaseoDog-${version}-arm64-v8a.apk`));
        }
    };
    const artifacts = {
        dependencies: ['packages/highlight/dist', 'packages/client/dist', 'packages/protocol/dist',
            'packages/relay/dist', 'packages/plugin/dist', 'packages/server/dist', 'packages/cli/dist']
            .map(path => join(androidRoot, path)),
        android: [join(workspace, `PaseoDog-${version}-arm64-v8a.apk`)],
        web: [join(androidRoot, 'packages/app/dist')],
        'desktop-main': [join(desktopRoot, 'dist')],
        linux: [join(output, `PaseoDog-${version}-amd64.deb`), join(output, `PaseoDog-${version}-x86_64.AppImage`),
            join(output, 'latest-linux.yml')],
        windows: [join(output, `PaseoDog-Setup-${version}-x64.exe`),
            join(output, `PaseoDog-Setup-${version}-x64.exe.blockmap`), join(output, 'latest.yml')],
    };
    await runReleaseBuild(name => checkpoint
        ? checkpoint(`build-${name}`, () => execute(name), { artifacts: artifacts[name] })
        : execute(name));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const { values } = parseArgs({ options: {
            workspace: { type: 'string' }, 'cache-root': { type: 'string' },
            'signing-init': { type: 'string' }, 'version-code': { type: 'string' },
            version: { type: 'string' },
            'metro-workers': { type: 'string' },
        } });
        await buildRelease({ workspace: values.workspace, cacheRoot: values['cache-root'],
            signingInit: values['signing-init'], versionCode: values['version-code'], version: values.version,
            metroWorkers: values['metro-workers'] });
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { patch } from './patch-mixdog.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeFiles = [
    'package.json', 'LICENSE', 'NOTICE', 'engine/package.json', 'engine/package-lock.json',
    'engine/bin', 'engine/src', 'plugin/package.json', 'plugin/paseo-plugin.json',
    'plugin/index.server.ts', 'plugin/index.client.tsx', 'plugin/server', 'plugin/client', 'plugin/shared',
    'scripts/configure.mjs', 'scripts/paths.mjs', 'scripts/desktop-profile.mjs', 'scripts/patch-mixdog.mjs',
    'patches/effort-usage.mjs', 'patches/default-output-style.mjs', 'patches/compaction-summary-route.mjs',
];

// 잠금 파일의 해시로 Windows 데스크톱 네이티브 패키지를 검증해 산출물에만 설치한다.
async function prepareWindowsDesktopDependencies(resources) {
    const lock = JSON.parse(await readFile(join(root, 'android/package-lock.json'), 'utf8'));
    const cache = await mkdtemp(join(tmpdir(), 'paseodog-win-natives-'));
    try {
        for (const name of ['@esbuild/win32-x64', 'sherpa-onnx-win-x64']) {
            const entry = lock.packages[`node_modules/${name}`];
            const result = spawnSync('npm', ['pack', entry.resolved, '--json', '--pack-destination', cache],
                { encoding: 'utf8', shell: process.platform === 'win32' });
            if (result.status !== 0) throw new Error(`Native package download failed: ${result.stderr}`);
            const archive = join(cache, JSON.parse(result.stdout)[0].filename);
            const integrity = 'sha512-' + createHash('sha512').update(await readFile(archive)).digest('base64');
            if (integrity !== entry.integrity) throw new Error(`Native package integrity mismatch: ${name}`);
            // 호스트 OS에서 실행하지 않는 대상 바이너리는 설치 스크립트 없이 산출물로 푼다.
            const destination = join(resources, 'node_modules', name);
            await mkdir(destination, { recursive: true });
            const extracted = spawnSync('tar', ['-xzf', archive, '-C', destination, '--strip-components=1'],
                { stdio: 'inherit' });
            if (extracted.error) throw extracted.error;
            if (extracted.status !== 0) throw new Error(`Windows native extraction failed: ${name}`);
        }
    } finally { await rm(cache, { recursive: true }); }
}

// 잠금 파일로 대상 OS 의존성을 설치하고 해시 검증 패치·대상 네이티브 도구를 묶는다.
export async function prepareDesktopRuntime({ output, platform, arch }) {
    if (!['linux', 'win32'].includes(platform) || arch !== 'x64')
        throw new Error(`Unsupported PaseoDog desktop runtime: ${platform}-${arch}`);
    for (const name of runtimeFiles) {
        const destination = join(output, name);
        await mkdir(dirname(destination), { recursive: true });
        await cp(join(root, name), destination, { recursive: true, errorOnExist: true, force: false });
    }
    // 대상별 선택 의존성을 설치하되 호스트용 postinstall은 실행하지 않는다.
    const result = spawnSync('npm', ['ci', '--ignore-scripts', '--install-strategy=nested',
        `--os=${platform}`, `--cpu=${arch}`], {
        cwd: join(output, 'engine'), stdio: 'inherit', shell: process.platform === 'win32',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Bundled engine dependency install failed: ${result.status}`);
    const mixdog = join(output, 'engine/node_modules/mixdog');
    patch(mixdog);
    const { downloadNativeTool, nativeToolInstalledName, NATIVE_TOOL_KINDS } =
        await import(pathToFileURL(join(mixdog, 'scripts/native-tool-download.mjs')).href);
    const cache = await mkdtemp(join(tmpdir(), 'paseodog-native-'));
    try {
        await mkdir(join(mixdog, 'native-tools'), { recursive: true });
        for (const kind of NATIVE_TOOL_KINDS) {
            const target = { platform, arch };
            const binary = await downloadNativeTool(kind, target, cache);
            const destination = join(mixdog, 'native-tools', nativeToolInstalledName(kind, target));
            await copyFile(binary, destination);
            await chmod(destination, 0o755);
        }
    } finally { await rm(cache, { recursive: true }); }
    const { pruneEmbeddingRuntime } =
        await import(pathToFileURL(join(mixdog, 'scripts/prune-embedding-runtime.mjs')).href);
    await pruneEmbeddingRuntime(mixdog, { platform, arch });
    patch(mixdog, { check: true });
    if (platform === 'win32') await prepareWindowsDesktopDependencies(dirname(output));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const [platform, output] = process.argv.slice(2);
        if (!output) throw new Error('Usage: prepare-desktop-runtime.mjs <linux|win32> <new-output-directory>');
        await prepareDesktopRuntime({ platform, arch: 'x64', output: resolve(output) });
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}

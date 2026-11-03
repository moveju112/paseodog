import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from './paths.mjs';
import { runCommand } from './release-command.mjs';
import { AGENT_MESSAGE_PATCHES, patchedAgentMessageSource } from './patch-paseo-agent-messages.mjs';
import { patchMetroImageSize } from '../android/scripts/patch-metro-image-size.mjs';
import { releaseEnvironment } from './release-environment.mjs';

export function releaseDependencyPaths({ platform = process.platform, arch = process.arch } = {}) {
    return [
        'engine/node_modules/mixdog/src/cli.mjs',
        'tools/node_modules/@getpaseo/cli/bin/paseo',
        'plugin/node_modules/typescript/bin/tsc',
        'android/node_modules/vitest/vitest.mjs',
        'android/node_modules/vite/dist/client/client.mjs',
        'android/node_modules/@typescript/native-preview/bin/tsgo.js',
        `android/node_modules/@typescript/native-preview-${platform}-${arch}/lib/lib.d.ts`,
    ];
}

export async function verifyReleaseDependencies(sourceRoot = root, host) {
    for (const path of releaseDependencyPaths(host)) {
        let info;
        try { info = await stat(join(sourceRoot, path)); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (!info?.isFile() || !info.size)
            throw Object.assign(new Error(`Required dependency file is missing or empty: ${path}`),
                { code: 'dependency-missing' });
    }
}

// 실제 배포 입력을 사용한다. 키·패치 오류를 수분짜리 검증 전에 읽기 전용으로 거절한다.
export async function releasePreflight(config, run = runCommand, sourceRoot = root) {
    const init = await readFile(config.signingInit, 'utf8');
    const lines = init.split('\n').filter(line => line.includes('storeFile'));
    if (lines.length !== 1 || !lines[0].includes(config.signingKey))
        throw new Error('Signing init does not reference the existing approved key');
    for (const path of [config.signingKey, config.previousApk,
        ...['apksigner', 'zipalign', 'aapt'].map(name => join(config.androidTools, name))])
        if (!(await stat(path)).isFile()) throw new Error('Release input is not a file');
    for (const directory of ['engine', 'tools', 'plugin', 'android']) {
        const lock = JSON.parse(await readFile(join(sourceRoot, directory, 'package-lock.json'), 'utf8'));
        const installed = JSON.parse(await readFile(join(sourceRoot, directory, 'node_modules/.package-lock.json'), 'utf8'));
        // 설치된 패키지 버전을 잠금 파일과 대조한다.
        for (const [path, pkg] of Object.entries(lock.packages)) {
            if (!path.startsWith('node_modules/') || pkg.link || pkg.optional) continue;
            if (installed.packages?.[path]?.version !== pkg.version)
                throw new Error(`Installed dependency differs from lockfile: ${directory}/${path}`);
        }
    }
    await verifyReleaseDependencies(sourceRoot);
    const env = releaseEnvironment(config);
    if (env.ANDROID_HOME) {
        let info;
        try { info = await stat(env.ANDROID_HOME); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (!info?.isDirectory()) throw Object.assign(new Error('Android SDK directory does not exist'),
            { code: 'android-sdk-missing' });
    }
    const server = join(sourceRoot, 'tools/node_modules/@getpaseo/server');
    for (const spec of AGENT_MESSAGE_PATCHES)
        patchedAgentMessageSource(await readFile(join(server, spec.file), 'utf8'), spec);
    patchMetroImageSize(join(sourceRoot, 'android/node_modules/metro'), { check: true });
    await run(join(config.androidTools, 'apksigner'), ['verify', config.previousApk], { capture: true });
    console.log('Release preflight: signing inputs, installed locks, agent-message and Metro hash gates passed');
}

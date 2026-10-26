import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileHash } from './release-state.mjs';
import { runCommand } from './release-command.mjs';
import { patch } from './patch-mixdog.mjs';
import { carriedAssets } from './release-targets.mjs';

const require = createRequire(new URL('../android/packages/desktop/package.json', import.meta.url));
const yaml = require('js-yaml');
const asar = require('@electron/asar');

export function releaseArtifacts(workspace, version) {
    const desktop = join(workspace, 'desktop');
    return [
        join(workspace, `PaseoDog-${version}-arm64-v8a.apk`),
        join(workspace, 'paseodog-android-update.json'),
        ...[`PaseoDog-${version}-amd64.deb`, `PaseoDog-${version}-x86_64.AppImage`,
            'latest-linux.yml', `PaseoDog-Setup-${version}-x64.exe`,
            `PaseoDog-Setup-${version}-x64.exe.blockmap`, 'latest.yml'].map(name => join(desktop, name)),
    ];
}

export async function verifyUpdaterManifest(directory, name, version) {
    const manifest = yaml.load(await readFile(join(directory, name), 'utf8'));
    assert.equal(manifest.version, version);
    for (const entry of manifest.files) {
        assert.equal(basename(entry.url), entry.url);
        const path = join(directory, entry.url);
        assert.equal((await stat(path)).size, entry.size);
        assert.equal(await fileHash(path, 'sha512', 'base64'), entry.sha512);
    }
    return manifest.files.map(entry => entry.url);
}

const FULL_PLAN = { targets: { android: true, desktop: true }, carry: { android: null, desktop: null } };

// 이번 배포가 빌드한 산출물과 이전 공개 릴리즈에서 이월한 산출물의 경로.
export function deliveryAssets(workspace, version, plan = FULL_PLAN) {
    const built = releaseArtifacts(workspace, version);
    return [
        ...(plan.targets.android ? built.slice(0, 2) : []),
        ...(plan.targets.desktop ? built.slice(2) : []),
        ...carriedAssets(plan.carry).map(name => join(workspace, 'carry', name)),
    ];
}

// 서명·업데이터·내장 런타임까지 검사한 산출물만 공개 목록에 올린다.
export async function verifyReleaseArtifacts(config, run = runCommand, plan = FULL_PLAN) {
    const { workspace, version, versionCode, androidTools, previousApk, root } = config;
    const built = releaseArtifacts(workspace, version);
    const assets = deliveryAssets(workspace, version, plan);
    const capture = { capture: true };
    if (plan.targets.android) {
        const certificate = async path => {
            const text = await run(join(androidTools, 'apksigner'), ['verify', '--print-certs', path], capture);
            const digest = /Signer #1 certificate SHA-256 digest: ([0-9a-f]+)/.exec(text)?.[1];
            assert.ok(digest, 'APK certificate missing');
            return digest;
        };
        assert.equal(await certificate(built[0]), await certificate(previousApk));
        await run(join(androidTools, 'zipalign'), ['-c', '4', built[0]]);
        const badging = await run(join(androidTools, 'aapt'), ['dump', 'badging', built[0]], capture);
        assert.ok(badging.includes("name='local.paseodog.app'"));
        assert.ok(badging.includes(`versionCode='${versionCode}'`));
        assert.ok(badging.includes(`versionName='${version}'`));
        assert.ok(badging.includes("native-code: 'arm64-v8a'"));
        const update = JSON.parse(await readFile(built[1], 'utf8'));
        assert.equal(update.versionCode, Number(versionCode));
    }
    if (plan.targets.desktop) {
        const desktop = join(workspace, 'desktop');
        const linux = await verifyUpdaterManifest(desktop, 'latest-linux.yml', version);
        assert.deepEqual(linux.slice().sort(), [basename(built[2]), basename(built[3])].sort());
        assert.deepEqual(await verifyUpdaterManifest(desktop, 'latest.yml', version), [basename(built[5])]);
        const debVersion = (await run('dpkg-deb', ['--field', built[2], 'Version'], capture)).trim();
        assert.equal(debVersion, version.replace('-', '~'));
        for (const platform of ['linux', 'win']) {
            const resources = join(desktop, `${platform}-unpacked`, 'resources');
            const pkg = JSON.parse(asar.extractFile(join(resources, 'app.asar'), 'package.json').toString());
            assert.equal(pkg.version, version);
            const runtime = join(resources, 'paseodog-runtime');
            assert.equal(JSON.parse(await readFile(join(runtime, 'plugin/shared/release.json'), 'utf8')).versionCode, Number(versionCode));
            for (const file of ['engine/src/native-engine.mjs', 'plugin/server/process-engine.mjs'])
                assert.equal(await fileHash(join(runtime, file)), await fileHash(join(root, file)));
            patch(join(runtime, 'engine/node_modules/mixdog'), { check: true });
        }
    }
    // 이월 산출물은 이전 공개 버전 그대로여야 한다. 새 버전 번호로 바꿔 올리지 않는다.
    const carried = join(workspace, 'carry');
    if (plan.carry.android) {
        const update = JSON.parse(await readFile(join(carried, 'paseodog-android-update.json'), 'utf8'));
        assert.equal(update.versionCode, plan.carry.android.versionCode);
        assert.equal(update.versionName, plan.carry.android.version);
        assert.ok(update.url.startsWith(`https://github.com/moveju112/paseodog/releases/download/v${plan.carry.android.version}/`));
    }
    if (plan.carry.desktop) {
        const previous = plan.carry.desktop.version;
        const linux = await verifyUpdaterManifest(carried, 'latest-linux.yml', previous);
        assert.deepEqual(linux.slice().sort(), [`PaseoDog-${previous}-amd64.deb`, `PaseoDog-${previous}-x86_64.AppImage`].sort());
        assert.deepEqual(await verifyUpdaterManifest(carried, 'latest.yml', previous), [`PaseoDog-Setup-${previous}-x64.exe`]);
    }
    const rows = [];
    for (const path of assets) rows.push(`${await fileHash(path)}  ${basename(path)}\n`);
    await writeFile(join(workspace, 'SHA256SUMS'), rows.join(''));
    return [...assets, join(workspace, 'SHA256SUMS')];
}

export function verifyRemoteAssets(remote, expected) {
    assert.deepEqual(Object.fromEntries(remote.map(asset => [asset.name, asset.size])), expected);
}

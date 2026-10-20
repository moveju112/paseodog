import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rewriteArchive, patchDesktopUpdater } from '../scripts/desktop-release.mjs';
const asar = createRequire(new URL('../tools/package.json', import.meta.url))('@electron/asar');

test('desktop archive updates preserve unrelated bytes and links across shifted offsets', async (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'paseodog-desktop-release-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const source = join(directory, 'source'); mkdirSync(source);
    const binary = Buffer.alloc(1024 * 1024 + 3, 0xa5);
    writeFileSync(join(source, 'aaa.txt'), 'UNCHANGED_PREFIX');
    writeFileSync(join(source, 'package.json'), '{"version":"0.11.4"}');
    writeFileSync(join(source, 'zzz.bin'), binary);
    symlinkSync('aaa.txt', join(source, 'link.txt'));
    const input = join(directory, 'before.asar'), output = join(directory, 'after.asar');
    await asar.createPackage(source, input);
    const manifest = Buffer.from('{"version":"1.0.0-rc.6","paseodogUpstream":{"paseo":"0.11.4","mixdog":"1.2.6"}}');
    rewriteArchive(input, output, new Map([['package.json', manifest]]));
    assert.deepEqual(asar.extractFile(output, 'package.json'), manifest);
    assert.equal(asar.extractFile(output, 'aaa.txt').toString(), 'UNCHANGED_PREFIX');
    assert.deepEqual(asar.extractFile(output, 'zzz.bin'), binary);
    assert.equal(asar.statFile(output, 'link.txt', false).link, asar.statFile(input, 'link.txt', false).link);
});

test('desktop updater rejects unreviewed binaries instead of dropping the patch gate', () => {
    assert.throws(() => patchDesktopUpdater('unreviewed source'), /Unreviewed desktop updater/);
});

const installedArchive = '/opt/PaseoDog/resources/app.asar';
test('desktop updater reports manual updates instead of a false latest status', { skip: !existsSync(installedArchive) && 'installed desktop archive absent' }, async () => {
    const patched = patchDesktopUpdater(asar.extractFile(installedArchive, 'dist/features/auto-updater.js').toString());
    // 설치본(이전 패치 또는 새 패치)과 재패치본 모두 같은 검토 원본으로 되돌린 뒤 동일 결과를 낸다.
    assert.equal(patchDesktopUpdater(patched), patched);
    assert.match(patched, /async checkForUpdates\(\) \{\n[^\n]*\n\s+return null;/);
    const check = patched.match(/async function checkForAppUpdate[\s\S]*?\n}\n/)[0];
    const result = await new Function(`${check}; return checkForAppUpdate;`)()({
        currentVersion: '1.0.0', releaseChannel: 'stable', intent: 'manual',
    });
    assert.deepEqual(result, {
        hasUpdate: false, readyToInstall: false, currentVersion: '1.0.0', latestVersion: null,
        body: null, date: null, errorMessage: null, updateMode: 'manual',
    });
});

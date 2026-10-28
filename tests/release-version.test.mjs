import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { scratchPath } from '../scripts/paths.mjs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { advanceReleaseVersion } from '../scripts/release-version.mjs';
import { prepareRelease } from '../scripts/release-prepare.mjs';

async function fixture(t) {
    const root = await mkdtemp(scratchPath('paseodog-version-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'plugin/shared'), { recursive: true });
    const metadata = { version: '1.0.0-rc.7', versionCode: 40, paseodogUpstream: { paseo: '0.11.4' } };
    const inputs = {
        'plugin/shared/release.json': JSON.stringify(metadata, null, 2) + '\n',
        'CHANGELOG.md': '# Changelog\n\n## 1.0.0-rc.7 - 2026-10-21\n\n- existing\n',
    };
    for (const [path, text] of Object.entries(inputs)) await writeFile(join(root, path), text);
    await writeFile(join(root, 'MANIFEST.sha256'), Object.entries(inputs)
        .map(([path, text]) => `${createHash('sha256').update(text).digest('hex')}  ${path}\n`).join(''));
    const calls = [];
    const run = async (command, args) => {
        calls.push([command, ...args]);
        if (command === 'gh') return JSON.stringify([
            { tagName: 'v1.0.0-rc.7.42', isDraft: false },
            { tagName: 'v1.0.0-rc.7.44', isDraft: true },
        ]);
        if (args[0] === 'rev-parse') return 'a'.repeat(40);
        return '';
    };
    return { root, metadata, inputs, calls, run, installedRelease: async () => ({ versionCode: 43 }) };
}

test('automatic release preparation exceeds source, installed and draft versions and stages only metadata', async t => {
    const f = await fixture(t);
    const result = await advanceReleaseVersion(f.root, 'moveju112/paseodog', f.run, f);
    assert.deepEqual(result, { commit: 'a'.repeat(40), versionCode: 45 });
    assert.deepEqual(JSON.parse(await readFile(join(f.root, 'plugin/shared/release.json'), 'utf8')),
        { ...f.metadata, versionCode: 45 });
    const changelog = await readFile(join(f.root, 'CHANGELOG.md'), 'utf8');
    assert.ok(changelog.includes('- 45:') && changelog.includes('- existing'));
    for (const line of (await readFile(join(f.root, 'MANIFEST.sha256'), 'utf8')).trim().split('\n')) {
        const [digest, path] = line.split('  ');
        assert.equal(createHash('sha256').update(await readFile(join(f.root, path))).digest('hex'), digest);
    }
    assert.deepEqual(f.calls.find(call => call[1] === 'add'),
        ['git', 'add', '--', 'plugin/shared/release.json', 'CHANGELOG.md', 'MANIFEST.sha256']);
    assert.deepEqual(f.calls.find(call => call[1] === 'push'), ['git', 'push', 'origin', 'HEAD:main']);
    assert.equal(f.calls.filter(call => call[1] === 'push').length, 1);
});

test('dirty sources, invalid targets and non-start mode cannot generate or push a version', async t => {
    const f = await fixture(t);
    await assert.rejects(advanceReleaseVersion(f.root, 'other/repo', f.run, f), /Unexpected/);
    await assert.rejects(advanceReleaseVersion(f.root, 'moveju112/paseodog',
        async () => ' M user-work', f), /clean checkout/);
    await assert.rejects(prepareRelease({}, 'a'.repeat(40), { nextVersion: true }), /requires --start/);
    assert.equal(await readFile(join(f.root, 'plugin/shared/release.json'), 'utf8'), f.inputs['plugin/shared/release.json']);
    assert.equal(f.calls.length, 0);
});

test('missing manifest entry fails before any write and failed push is never retried', async t => {
    const f = await fixture(t);
    const manifestPath = join(f.root, 'MANIFEST.sha256');
    const manifest = await readFile(manifestPath, 'utf8');
    await writeFile(manifestPath, '');
    await assert.rejects(advanceReleaseVersion(f.root, 'moveju112/paseodog', f.run, f), /manifest entry/);
    assert.equal(await readFile(join(f.root, 'plugin/shared/release.json'), 'utf8'), f.inputs['plugin/shared/release.json']);
    await writeFile(manifestPath, manifest);
    let pushes = 0;
    await assert.rejects(advanceReleaseVersion(f.root, 'moveju112/paseodog', async (command, args) => {
        if (args[0] === 'push') { pushes++; throw new Error('push outcome uncertain'); }
        return f.run(command, args);
    }, f), /push outcome uncertain/);
    assert.equal(pushes, 1);
    assert.equal(JSON.parse(await readFile(join(f.root, 'plugin/shared/release.json'), 'utf8')).versionCode, 45);
});

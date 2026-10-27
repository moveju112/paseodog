import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareWebUi } from '../scripts/prepare-paseo-web-ui.mjs';
import { COMPOSER_FILE } from '../scripts/patch-paseo-composer.mjs';
import pin from '../scripts/paseo-web-ui-base.json' with { type: 'json' };

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('pinned web-ui base covers the composer bundle and never looks like an app update tag', () => {
    const [prefix, file] = [pin.target + '/', COMPOSER_FILE];
    assert.ok(file.startsWith(prefix));
    for (const extension of ['', '.br', '.gz']) assert.match(pin.files[file.slice(prefix.length) + extension], /^[0-9a-f]{64}$/);
    // semver prerelease 채널이 alpha/beta가 아니어야 electron-updater beta 조회가 이 tag를 고르지 않는다.
    assert.match(pin.tag, /^\d+\.\d+\.\d+-web-ui-base\.\d+$/);
    assert.ok(pin.url.endsWith(`/releases/download/${pin.tag}/paseo-web-ui-base-${pin.version}.${pin.tag.split('.').at(-1)}.tar.gz`));
    assert.match(pin.sha256, /^[0-9a-f]{64}$/);
});

async function fixture(t) {
    const directory = await mkdtemp(join(tmpdir(), 'paseodog-web-ui-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const source = join(directory, 'source', 'web-ui');
    await mkdir(join(source, 'nested'), { recursive: true });
    const files = { 'index.html': '<html></html>', 'nested/app.js': 'console.log(1)' };
    for (const [path, text] of Object.entries(files)) await writeFile(join(source, path), text);
    const packed = spawnSync('tar', ['-czf', join(directory, 'base.tar.gz'), 'web-ui'], { cwd: join(directory, 'source') });
    assert.equal(packed.status, 0);
    const archive = await readFile(join(directory, 'base.tar.gz'));
    const server = join(directory, 'server');
    const target = join(server, 'dist/server/web-ui');
    await mkdir(target, { recursive: true });
    await writeFile(join(server, 'package.json'), JSON.stringify({ name: pin.package, version: pin.version }));
    await writeFile(join(target, 'npm-only.js'), 'stale');
    const base = { ...pin, sha256: sha256(archive),
        files: Object.fromEntries(Object.entries(files).map(([path, text]) => [path, sha256(text)])) };
    return { server, target, archive, base };
}

test('prepared web-ui replaces the whole npm directory only after archive and file checks pass', async t => {
    const state = await fixture(t);
    const requested = [];
    await prepareWebUi(state.server, { base: state.base, fetchArchive: async url => { requested.push(url); return state.archive; } });
    assert.deepEqual(requested, [pin.url]);
    assert.deepEqual((await readdir(state.target, { recursive: true })).sort(), ['index.html', 'nested', 'nested/app.js']);
    assert.deepEqual((await readdir(join(state.server, 'dist/server'))).sort(), ['web-ui']);
});

test('archive, content and package mismatches leave the installed web-ui untouched', async t => {
    const state = await fixture(t);
    const untouched = async () => assert.deepEqual(await readdir(state.target), ['npm-only.js']);
    await assert.rejects(prepareWebUi(state.server, { base: state.base, fetchArchive: async () => Buffer.from('other') }),
        /archive hash mismatch/);
    await untouched();
    await assert.rejects(prepareWebUi(state.server, { base: { ...state.base, files: { ...state.base.files, 'missing.js': '0'.repeat(64) } },
        fetchArchive: async () => state.archive }), /file list mismatch/);
    await untouched();
    await assert.rejects(prepareWebUi(state.server, { base: { ...state.base, files: { ...state.base.files, 'index.html': '0'.repeat(64) } },
        fetchArchive: async () => state.archive }), /hash mismatch: index\.html/);
    await untouched();
    await writeFile(join(state.server, 'package.json'), JSON.stringify({ name: pin.package, version: '0.11.5' }));
    await assert.rejects(prepareWebUi(state.server, { base: state.base, fetchArchive: async () => assert.fail('downloaded') }),
        /requires @getpaseo\/server@0\.11\.4/);
    await untouched();
    assert.deepEqual((await readdir(join(state.server, 'dist/server'))).sort(), ['web-ui']);
});

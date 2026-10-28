import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { scratchPath } from '../scripts/paths.mjs';
import { join } from 'node:path';
import { patchQueryStringDecoder } from '../android/scripts/patch-query-string-decoder.mjs';

test('decoder patch rejects version drift without changing input', async (t) => {
    const root = await mkdtemp(scratchPath('paseodog-decoder-test-'));
    t.after(() => rm(root, { recursive: true }));
    await writeFile(join(root, 'package.json'), JSON.stringify({ version: '7.1.4' }));
    await writeFile(join(root, 'index.js'), 'UNREVIEWED');
    assert.throws(() => patchQueryStringDecoder(root), /query-string 7\.1\.3 required/);
    assert.equal(await readFile(join(root, 'index.js'), 'utf8'), 'UNREVIEWED');
});

test('decoder patch rejects unreviewed bytes in apply and check modes', async (t) => {
    const root = await mkdtemp(scratchPath('paseodog-decoder-test-'));
    t.after(() => rm(root, { recursive: true }));
    await writeFile(join(root, 'package.json'), JSON.stringify({ version: '7.1.3' }));
    await writeFile(join(root, 'index.js'), 'UNREVIEWED');
    for (const check of [false, true]) {
        assert.throws(() => patchQueryStringDecoder(root, { check }), /source hash mismatch/);
    }
    assert.equal(await readFile(join(root, 'index.js'), 'utf8'), 'UNREVIEWED');
});

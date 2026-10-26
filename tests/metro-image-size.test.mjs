import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import {
    patchedMetroAssets, patchMetroImageSize, withoutMetroImageSize,
} from '../android/scripts/patch-metro-image-size.mjs';

const assetFile = fileURLToPath(new URL('../android/node_modules/metro/src/Assets.js', import.meta.url));
const original = withoutMetroImageSize(readFileSync(assetFile, 'utf8'));

function fixture(t) {
    const root = mkdtempSync('/data/tmp/ubuntu/paseodog-metro-image-size-');
    t.after(() => rmSync(root, { recursive: true, force: true }));
    return root;
}

test('Metro image dimensions accept image-size 2 bytes and preserve density and non-image assets', async t => {
    const root = fixture(t);
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000008000000060806000000', 'hex');
    const image = join(root, 'sample@2x.png');
    const text = join(root, 'sample.txt');
    writeFileSync(image, png);
    writeFileSync(text, 'asset');
    const exports = {};
    runInNewContext(`(function (exports, require) {\n${patchedMetroAssets(original)}\n})`,
        { Buffer, console, process })(exports, createRequire(assetFile));
    const dimensions = await exports.getAssetData(image, 'sample@2x.png', [], null, '/assets');
    assert.equal(dimensions.width, 4);
    assert.equal(dimensions.height, 3);
    assert.equal(dimensions.scales.length, 1);
    assert.equal(dimensions.scales[0], 2);
    const asset = await exports.getAssetData(text, 'sample.txt', [], null, '/assets');
    assert.equal(asset.width, undefined);
    assert.equal(asset.height, undefined);
    assert.equal(asset.type, 'txt');
});

test('Metro compatibility patch is reversible, idempotent and rejects source drift', () => {
    const patched = patchedMetroAssets(original);
    assert.notEqual(patched, original);
    assert.equal(withoutMetroImageSize(patched), original);
    assert.equal(patchedMetroAssets(patched), patched);
    assert.throws(() => patchedMetroAssets(original + '\n'), /hash mismatch/);
    assert.throws(() => patchedMetroAssets(patched + '\n'), /hash mismatch/);
});

test('Metro compatibility installer guards versions and check mode does not write', t => {
    const root = fixture(t);
    mkdirSync(join(root, 'src'));
    const path = join(root, 'src/Assets.js');
    writeFileSync(path, original);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.83.2' }));
    assert.throws(() => patchMetroImageSize(root), /metro 0\.83\.3 required/);
    assert.equal(readFileSync(path, 'utf8'), original);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.83.3' }));
    assert.throws(() => patchMetroImageSize(root, { check: true }), /patch is missing/);
    assert.equal(readFileSync(path, 'utf8'), original);
    patchMetroImageSize(root);
    patchMetroImageSize(root);
    patchMetroImageSize(root, { check: true });
    assert.equal(readFileSync(path, 'utf8'), patchedMetroAssets(original));
    writeFileSync(path, original + '\n');
    assert.throws(() => patchMetroImageSize(root), /hash mismatch/);
    assert.equal(readFileSync(path, 'utf8'), original + '\n');
});

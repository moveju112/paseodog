import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { patchedExpoActivityResult, patchExpoActivityResult } from '../scripts/patch-expo-activity-result.mjs';
import {
    EXPO_ACTIVITY_RESULT_VERSION, EXPO_ACTIVITY_RESULT_FILE, EXPO_ACTIVITY_RESULT_EDITS, withoutExpoActivityResult,
} from '../patches/expo-activity-result.mjs';

const original = withoutExpoActivityResult(readFileSync(new URL(
    `../android/node_modules/expo-modules-core/${EXPO_ACTIVITY_RESULT_FILE}`, import.meta.url), 'utf8'));

test('Expo lifecycle patch is reversible, idempotent and rejects source drift or partial application', () => {
    const patched = patchedExpoActivityResult(original);
    assert.equal(withoutExpoActivityResult(patched), original);
    assert.equal(patchedExpoActivityResult(patched), patched);
    assert.throws(() => patchedExpoActivityResult(original + '\n'), /hash mismatch/);
    assert.throws(() => patchedExpoActivityResult(original.replace(...EXPO_ACTIVITY_RESULT_EDITS[0])), /Partial/);
});

test('Expo lifecycle installer refuses wrong versions and missing patches without writing during check', t => {
    const root = mkdtempSync(join(tmpdir(), 'paseodog-expo-lifecycle-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const path = join(root, EXPO_ACTIVITY_RESULT_FILE);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, original);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '3.0.31' }));
    assert.throws(() => patchExpoActivityResult(root), new RegExp(`${EXPO_ACTIVITY_RESULT_VERSION.replaceAll('.', '\\.')} required`));
    assert.equal(readFileSync(path, 'utf8'), original);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: EXPO_ACTIVITY_RESULT_VERSION }));
    assert.throws(() => patchExpoActivityResult(root, { check: true }), /patch is missing/);
    assert.equal(readFileSync(path, 'utf8'), original);
    patchExpoActivityResult(root);
    patchExpoActivityResult(root, { check: true });
    assert.equal(readFileSync(path, 'utf8'), patchedExpoActivityResult(original));
});

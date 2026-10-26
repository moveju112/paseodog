import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COMPOSER_FILE, patchedComposerSource, patchedComposerWholeSource } from '../scripts/patch-paseo-composer.mjs';

const installed = readFileSync(new URL(`../tools/node_modules/@getpaseo/server/${COMPOSER_FILE}`, import.meta.url), 'utf8');

test('indexed composer matches the complete reviewed transformation byte for byte', () => {
    const expected = patchedComposerWholeSource(installed);
    assert.equal(patchedComposerSource(installed), expected);
    assert.equal(patchedComposerSource(expected), expected);
});

test('whole bundle hash gate still rejects edits outside the selected modules and changed boundaries', () => {
    assert.throws(() => patchedComposerSource('/* unreviewed prefix */' + installed), /source hash mismatch/);
    const parts = installed.split('\n__d(');
    parts[1] += '/* untouched module drift */';
    assert.throws(() => patchedComposerSource(parts.join('\n__d(')), /source hash mismatch/);
    assert.throws(() => patchedComposerSource(installed.replace('\n__d(', '\n/* drift */__d(')), /source hash mismatch/);
});

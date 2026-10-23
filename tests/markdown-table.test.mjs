import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { LEGACY_MARKDOWN_TABLE_EDITS, MARKDOWN_TABLE_EDITS, withMarkdownTable, withoutMarkdownTable } from '../patches/paseo-markdown-table.mjs';
import { COMPOSER_FILE, patchedComposerSource } from '../scripts/patch-paseo-composer.mjs';
import { composerFixture } from './composer-fixture.mjs';

test('content-sized tables upgrade the pinned web bundle with reversible, complete, hash-gated edits', () => {
    const installed = readFileSync(new URL('../tools/node_modules/@getpaseo/server/' + COMPOSER_FILE, import.meta.url), 'utf8');
    const result = composerFixture(installed);
    new vm.Script(result);
    assert.equal(composerFixture(result), result);
    assert.equal(withMarkdownTable(withoutMarkdownTable(result)), result);
    const [before, after] = MARKDOWN_TABLE_EDITS[1];
    assert.throws(() => patchedComposerSource(result.replace(after, () => before)), /Partial/);
    assert.throws(() => patchedComposerSource(result + '\n'), /hash mismatch/);
    const current = MARKDOWN_TABLE_EDITS[0][1];
    for (const [[, legacy]] of LEGACY_MARKDOWN_TABLE_EDITS) {
        assert.notEqual(legacy, current);
        assert.equal(patchedComposerSource(result.replace(current, () => legacy)), result);
    }
});

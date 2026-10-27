import test from 'node:test';
import assert from 'node:assert/strict';
import { patchedComposerSource, patchedComposerWholeSource } from '../scripts/patch-paseo-composer.mjs';

// 공유 소스 export로 전환해도 옛 변환기가 임의 바이트를 승인해서는 안 된다.
const installed = 'unreviewed bundle\n__d(function(){},1,[]);';

test('both legacy transformation paths reject unreviewed bytes', () => {
    assert.throws(() => patchedComposerWholeSource(installed), /source hash mismatch/);
    assert.throws(() => patchedComposerSource(installed), /source hash mismatch/);
});

test('whole bundle hash gate still rejects edits outside the selected modules and changed boundaries', () => {
    assert.throws(() => patchedComposerSource('/* unreviewed prefix */' + installed), /source hash mismatch/);
    const parts = installed.split('\n__d(');
    parts[1] += '/* untouched module drift */';
    assert.throws(() => patchedComposerSource(parts.join('\n__d(')), /source hash mismatch/);
    assert.throws(() => patchedComposerSource(installed.replace('\n__d(', '\n/* drift */__d(')), /source hash mismatch/);
});

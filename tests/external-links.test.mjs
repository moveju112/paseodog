import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { COMPOSER_FILE, patchedComposerSource } from '../scripts/patch-paseo-composer.mjs';
import { EXTERNAL_LINK_EDITS, withExternalLinks, withoutExternalLinks } from '../patches/paseo-external-links.mjs';

const installed = readFileSync(new URL('../tools/node_modules/@getpaseo/server/' + COMPOSER_FILE, import.meta.url), 'utf8');
const patched = patchedComposerSource(installed);

test('web bundle renders no community or repository link buttons and unwraps exactly', () => {
    assert.equal(patchedComposerSource(patched), patched);
    new Script(patched);
    for (const [before, after] of EXTERNAL_LINK_EDITS) {
        assert.equal(patched.includes(before), false);
        assert.equal(patched.split(after).length, 2);
    }
    // 렌더 위치가 사라졌으므로 버튼 testID·문구가 화면 트리에 들어갈 경로가 없다.
    assert.equal(patched.includes('children:(0,R.jsx)(j.CommunityLinks,{})'), false);
    assert.equal(patched.includes('children:(0,Pe.jsx)(J.CommunityLinks,{})'), false);
    assert.equal(patched.includes('children:"Open GitHub issue"'), false);
    assert.equal(patched.includes('actions:C},n[7]=b'), false);
    assert.equal(patched.includes('children:"PaseoDog \\xb7 GitHub"'), false);
    const original = withoutExternalLinks(patched);
    assert.equal(withExternalLinks(original), patched);
    assert.throws(() => withExternalLinks(patched), /external links anchor mismatch/);
});

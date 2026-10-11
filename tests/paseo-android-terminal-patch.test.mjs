import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { patchPaseoTerminalInput, PATCH_MARKER } from '../scripts/patch-paseo-android.mjs';

const source = readFileSync(fileURLToPath(new URL('../patches/paseo-android-terminal/baseline-state-fixture.tsx', import.meta.url)), 'utf8');
const { content } = patchPaseoTerminalInput(source, { allowFixture: true });
// Node's standard test job runs before npm ci. Use the built-in Node TS strip
// when available, or a narrow type-only removal on this audited fixture.
function loadState() {
    const body = content
        .replace(/interface TerminalTextInputChange[^\n]*\n/, '')
        .replace(/interface TerminalTextInputState[^\n]*\n/, '')
        .replace(/: string \| null/g, '')
        .replace(/: TerminalTextInputChange/g, '')
        .replace(/: TerminalTextInputState/g, '')
        .replace(/: string\[\]/g, '')
        .replace(/: string/g, '')
        .replace(/: boolean/g, '')
        .replace(/: number/g, '')
        .replace(/: void/g, '')
        .replace('export function createTerminalTextInputState', 'function createTerminalTextInputState');
    // Fixture is a known source snapshot, not arbitrary user input.
    return (new Function(`${body}; return createTerminalTextInputState`))();
}
const createState = loadState();
function write(state, events) {
    let result = '';
    for (const [kind, value] of events) result += (kind === 'key' ? state.receiveKeyPress(value) : state.receiveTextChange(value)).data;
    return result;
}

test('audited Android patch is idempotent and restricted to exact changes', () => {
    assert.ok(content.includes(PATCH_MARKER));
    assert.equal(patchPaseoTerminalInput(content, { allowFixture: true }).status, 'already-patched');
    assert.throws(() => patchPaseoTerminalInput('unrelated code'), /not the audited upstream blob/);
});
test('ordinary key-first text is transmitted once', () => {
    const s = createState();
    assert.equal(write(s, [['key', 'a'],['text','a'],['key','b'],['text','ab'],['key','c'],['text','abc']]), 'abc');
});
test('reversed initial Samsung style text-before-key does not duplicate abcdefg', () => {
    const s = createState();let result='';const word='abcdefg';
    for(let i=0;i<word.length;i++) result += write(s, [['text',word.slice(0,i+1)],['key',word[i]]]);
    assert.equal(result,'abcdefg');
});
test('reversed repeated identical keys are sent only once per actual edit', () => {
    const s=createState();
    assert.equal(write(s,[['text','a'],['key','a'],['text','aa'],['key','a'],['text','aaa'],['key','a']]),'aaa');
});
test('keypress-only fallback still works without text updates', () => {
    const s=createState();
    assert.equal(write(s,[['key','p'],['key','w'],['key','d'],['key','Enter']]),'pwd\r');
});
test('backspace key-before-text sends exactly one DEL', () => {
    const s=createState();
    assert.equal(write(s,[['key','a'],['text','a'],['key','b'],['text','ab'],['key','Backspace'],['text','a']]),'ab\x7f');
});
test('text-before-backspace sends exactly one DEL', () => {
    const s=createState();
    assert.equal(write(s,[['text','ab'],['text','a'],['key','Backspace']]),'ab\x7f');
});
test('text-before-backspace deletion to empty sends exactly one DEL', () => {
    const s=createState();
    assert.equal(write(s,[['text','a'],['text',''],['key','Backspace']]),'a\x7f');
});
test('Korean composition and key-first decomposing Backspace preserve CJK replacements', () => {
    const s=createState();
    assert.equal(write(s,[['key','ㅎ'],['text','ㅎ'],['key','ㅏ'],['text','하'],['key','ㄴ'],['text','한'],['key','Backspace'],['text','하']]),'ㅎ\x7f하\x7f한\x7f하');
});
test('Swallowed non-CJK replacement still prevents unsafe deletion', () => {
    const s=createState();
    assert.equal(write(s,[['text','teh'],['text','the'],['key','Backspace'],['text','th']]),'teh');
});
test('Unicode surrogate deletion uses code point count', () => {
    const s=createState();
    assert.equal(write(s,[['text','😀a'],['text','😀'],['key','Backspace'],['text',''],['key','Backspace']]),'😀a\x7f\x7f');
});

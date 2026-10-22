import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { CHAT_USABILITY_EDITS, withChatUsability, withoutChatUsability } from '../patches/paseo-chat-usability.mjs';
import { COMPOSER_FILE, patchedComposerSource } from '../scripts/patch-paseo-composer.mjs';

const pinSource = stripTypeScriptTypes(readFileSync(new URL('../android/packages/app/src/usage/pin-compatibility.ts', import.meta.url), 'utf8')).replace(/^export /gm, '');
const restorePins = new Function(`${pinSource}\nreturn restoreClaudeUsagePins;`)();

test('mobile message copy button moves 12px inward without changing desktop spacing', () => {
    const shared = readFileSync(new URL('../android/packages/app/src/components/message.tsx', import.meta.url), 'utf8');
    const styleText = shared.slice(shared.indexOf('  copyButton: {'), shared.indexOf('  trailingRow: {'));
    const theme = { spacing: { 1: 4, 2: 8 } };
    const style = vm.runInNewContext(`({${styleText}}).copyButton`, { theme });
    assert.equal(style.marginRight.xs, 8);
    assert.equal(style.marginRight.md, -4);
    const web = CHAT_USABILITY_EDITS[0][1].split(',uni__dependencies:')[0];
    const webStyle = vm.runInNewContext(`({${web}})`, { e: theme });
    assert.equal(webStyle.marginRight.xs, style.marginRight.xs);
    assert.equal(webStyle.marginRight.md, style.marginRight.md);
});

test('old Claude pins retain their periods without adding explicitly hidden sources', () => {
    const reports = [{
        id: 'claude:mixdog-anthropic-oauth', sourceId: 'claude',
        report: { status: 'available', windows: [
            { id: 'claude-0', label: '5H', usedPct: 53 },
            { id: 'claude-1', label: '7D', usedPct: 79 },
        ] },
    }];
    const pins = [{ sourceId: 'claude', windowId: 'five_hour' },
        { sourceId: 'claude', windowId: 'weekly' }, { sourceId: 'codex', windowId: 'weekly' }];
    assert.deepEqual(restorePins(pins, reports), [
        { sourceId: 'claude', windowId: 'claude-0' },
        { sourceId: 'claude', windowId: 'claude-1' }, pins[2],
    ]);
    assert.equal(pins[0].windowId, 'five_hour');
    assert.deepEqual(restorePins([], reports), []);
    assert.deepEqual(restorePins([pins[2]], reports), [pins[2]]);
    assert.equal(restorePins(pins, []), pins);
    assert.equal(restorePins(pins, [{ ...reports[0], report: { status: 'error' } }]), pins);
});

test('web and shared source pin compatibility return identical selections', () => {
    const text = CHAT_USABILITY_EDITS.find(([before]) => before.startsWith('function l(n,t)'))[1];
    const restore = vm.runInNewContext(`(${text}return [];})`);
    const pins = [{ sourceId: 'claude', windowId: 'weekly' }];
    const reports = [{ id: 'claude:mixdog-anthropic-oauth', sourceId: 'claude',
        report: { status: 'available', windows: [{ id: 'claude-1', label: '7D' }] } }];
    assert.deepEqual(JSON.parse(JSON.stringify(restore({ pins }, reports))), restorePins(pins, reports));
});

test('sent image and loading placeholder double both dimensions while drafts retain 48px', () => {
    let uri = 'blob:test';
    const styles = { thumbnail: { width: 48, height: 48 }, thumbnailPlaceholder: { width: 48, height: 48 } };
    const edit = CHAT_USABILITY_EDITS.find(([before]) => before.startsWith('e.AttachmentThumbnail='));
    const component = vm.runInNewContext(`(${edit[1].slice('e.AttachmentThumbnail='.length)})`, {
        y: { useAttachmentPreviewUrl: () => uri }, S: styles, t: { View: 'view' }, l: { Image: 'image' },
        _: { jsx: (type, props) => ({ type, props }) },
    });
    for (const preview of ['blob:test', null]) {
        uri = preview;
        for (const sent of [false, true]) {
            const node = component({ metadata: {}, sent });
            const style = Object.assign({}, ...node.props.style.filter(Boolean));
            assert.equal(style.width, sent ? 96 : 48);
            assert.equal(style.height, sent ? 96 : 48);
            assert.equal(node.type, preview ? 'image' : 'view');
        }
    }
});

test('web UI upgrades the installed renderer and remains hash-gated and idempotent', () => {
    const installed = readFileSync(new URL('../tools/node_modules/@getpaseo/server/' + COMPOSER_FILE, import.meta.url), 'utf8');
    const source = patchedComposerSource(installed);
    new vm.Script(source);
    assert.equal(patchedComposerSource(source), source);
    assert.equal(withChatUsability(withoutChatUsability(source)), source);
    const [before, after] = CHAT_USABILITY_EDITS[1];
    assert.throws(() => patchedComposerSource(source.replace(after, () => before)), /Partial/);
    assert.throws(() => patchedComposerSource(source + '// drift'), /hash mismatch/);
});

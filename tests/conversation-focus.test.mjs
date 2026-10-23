import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { Script } from 'node:vm';
import { COMPOSER_FILE, patchedComposerSource } from '../scripts/patch-paseo-composer.mjs';
import { composerFixture } from './composer-fixture.mjs';
import { CONVERSATION_FOCUS_EDITS, withConversationFocus, withoutConversationFocus } from '../patches/paseo-conversation-focus.mjs';
import { WORK_RECORD_EDITS } from '../patches/paseo-work-records.mjs';
import { withoutAssistantIcon } from '../patches/paseo-assistant-icon.mjs';

test('the injected web renderer retains its disconnect check without module closures', () => {
    const code = WORK_RECORD_EDITS.find(([before]) => before.startsWith('function ae('))[1];
    const prefix = code.slice(0, code.indexOf('function ae('));
    const render = new Function('h', 'f', 'l', 'y', 'F', 'k', prefix + ';return pdRenderWorkRecord;')(
        { createElement: (...args) => args },
        { withUnistyles: (component) => component, StyleSheet: { create: () => ({}) } },
        { View: 'view', Text: 'text', Pressable: 'button' },
        { useTranslation: () => ({ i18n: { language: 'ko' } }) },
        { useSettings: () => 'Dog' }, {},
    );
    assert.doesNotThrow(() => render({
        item: { kind: 'assistant_message', text: '본문', answerStart: true },
        belowItem: null, phase: 'complete',
    }, () => null, { serverId: 's', agentId: 'a' }));
});

test('focus web patch is reversible, idempotent, exact-blob gated and rejects partial application', () => {
    const source = readFileSync(new URL('../tools/node_modules/@getpaseo/server/' + COMPOSER_FILE, import.meta.url), 'utf8');
    const patched = composerFixture(source);
    new Script(patched);
    assert.equal(composerFixture(patched), patched);
    assert.equal(withConversationFocus(withoutConversationFocus(patched)), patched);
    const [before, after] = CONVERSATION_FOCUS_EDITS[0];
    const nicknameOnly = withoutAssistantIcon(patched);
    const partial = nicknameOnly.replace(after, before);
    assert.notEqual(partial, nicknameOnly);
    assert.throws(() => patchedComposerSource(partial), /Partial/);
    assert.throws(() => patchedComposerSource(patched + '// drift'), /hash mismatch/);
});

test('assistant heading updates its nickname without replacing Markdown content', async () => {
    const require = createRequire(new URL('../plugin/package.json', import.meta.url));
    const React = require('react');
    const { create, act } = require('react-test-renderer');
    const code = stripTypeScriptTypes(readFileSync(new URL('../android/packages/app/src/agent-stream/work-record-renderer.ts', import.meta.url), 'utf8')).replace(/^export /gm, '');
    const createRenderer = new Function(code + '\nreturn createWorkRecordRenderer;')();
    let nickname = 'Dog';
    const render = createRenderer({
        React, View: 'view', Text: 'text', Pressable: 'pressable',
        StyleSheet: { create: () => ({}) },
        useTranslation: () => ({ i18n: { language: 'ko' } }),
        useAssistantNickname: () => nickname,
        useAssistantIcon: () => '',
        getClient: () => null,
    });
    const row = { item: { kind: 'assistant_message', answerStart: true, text: '**본문**' } };
    // 본문은 기존 렌더러를 그대로 통과시킨다.
    const body = (layout) => React.createElement('markdown', null, layout.item.text);
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    let tree;
    await act(async () => { tree = create(render(row, body)); });
    const heading = () => tree.root.findAll((node) => node.type === 'text' && node.props.accessibilityRole === 'header')[0].props.children;
    assert.equal(heading(), 'Dog');
    nickname = '강아지';
    await act(async () => tree.update(render(row, body)));
    assert.equal(heading(), '강아지');
    assert.equal(tree.root.findByType('markdown').props.children, '**본문**');
    await act(async () => tree.unmount());
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

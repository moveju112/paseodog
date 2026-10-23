import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createNativeEngine } from '../engine/src/native-engine.mjs';
import { normalizeOrchestrationMode } from '../engine/src/orchestration-mode.mjs';
import { createEngineControls } from '../plugin/server/controls.mjs';
import { patchedComposerSource, COMPOSER_FILE, withoutWorktreeSetupTip } from '../scripts/patch-paseo-composer.mjs';
import { composerFixture } from './composer-fixture.mjs';
import { withoutWhite2Theme } from '../scripts/patch-paseo-theme.mjs';
import { withoutSingleWorkspace } from '../patches/paseo-single-workspace.mjs';
import { withoutHostSwitch } from '../patches/paseo-host-switch.mjs';
import { gitBlob } from '../scripts/patch-mixdog.mjs';
import {
    createCollaborationState, COLLABORATION_SOURCE, COLLABORATION_SOURCE_ANCHOR,
    COLLABORATION_RENDER, COLLABORATION_ANCHOR, COLLABORATION_DRAFT_ANCHOR, COLLABORATION_DRAFT_RENDER,
    LEGACY_COLLABORATION_SOURCES, withoutCollaboration,
    FAST_RENDER, FAST_DRAFT_RENDER,
} from '../patches/paseo-collaboration.mjs';
import { withoutAutoEffort } from '../patches/paseo-auto-effort.mjs';
import { withoutAgentProgress } from '../patches/paseo-agent-progress.mjs';
import { withoutSidebarToolbar } from '../patches/paseo-sidebar-toolbar.mjs';
import { withoutHelpMenu } from '../patches/paseo-help-menu.mjs';
import { withoutUsageColors } from '../patches/paseo-usage-colors.mjs';
import { withoutUsageOrder as withoutUsageOrderOnly } from '../patches/paseo-usage-order.mjs';
import { withoutUsageDonut } from '../patches/paseo-usage-donut.mjs';
import { withoutSidebarStatusShapes } from '../patches/paseo-sidebar-status-shapes.mjs';
import { withoutWorkRecords } from '../patches/paseo-work-records.mjs';
import { withoutConversationFocus } from '../patches/paseo-conversation-focus.mjs';
import { withoutExternalLinks } from '../patches/paseo-external-links.mjs';
import { withoutRelayPassword } from '../patches/paseo-relay-password.mjs';
import { withoutCompactionBuffer } from '../patches/paseo-compaction-buffer.mjs';
import { withoutOfferLink } from '../patches/paseo-offer-link.mjs';
import { withoutSettingsCorrections } from '../patches/paseo-settings-corrections.mjs';
import { withoutAgentEditorSafety } from '../patches/paseo-agent-editor-safety.mjs';
import { withoutChatUsability } from '../patches/paseo-chat-usability.mjs';
import { withoutMarkdownTable } from '../patches/paseo-markdown-table.mjs';
import { withoutDaemonUpdate } from '../patches/paseo-daemon-update.mjs';
import { withoutSettingsOrganization } from '../patches/paseo-settings-organization.mjs';
import { withoutSettingsBehavior } from '../patches/paseo-settings-behavior.mjs';
// 사이드바 쿼터 패치 해제 (도넛 -> 고정 순서, 실제 composer 체인 순서)
const withoutUsageOrder = (source) => {
    source = withoutHostSwitch(source);
    source = withoutSingleWorkspace(source);
    source = withoutSettingsBehavior(source);
    source = withoutSettingsOrganization(source);
    source = withoutDaemonUpdate(source);
    source = withoutMarkdownTable(source);
    source = withoutCompactionBuffer(withoutOfferLink(withoutSettingsCorrections(withoutAgentEditorSafety(withoutChatUsability(source)))));
    return withoutUsageOrderOnly(withoutUsageDonut(withoutSidebarStatusShapes(withoutWorkRecords(withoutExternalLinks(withoutRelayPassword(withoutConversationFocus(source)))))));
};
import { withoutHideReasoning } from '../patches/paseo-hide-reasoning.mjs';
import { withoutImportCwd } from '../patches/paseo-import-cwd.mjs';
import { withoutAgentsSettings } from '../patches/paseo-agents-settings.mjs';

const require = createRequire(new URL('../plugin/package.json', import.meta.url));
const React = require('react');
const { create, act } = require('react-test-renderer');

test('the actual SDK RPC schema accepts only the two supported orchestration values', async () => {
    const { build } = require('esbuild');
    const result = await build({
        entryPoints: [new URL('../plugin/shared/controls.ts', import.meta.url).pathname],
        bundle: true, platform: 'node', format: 'cjs', write: false,
    });
    const module = { exports: {} };
    new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, require);
    const schema = module.exports.engineControls.input;
    for (const mode of ['none', 'swarm']) {
        assert.deepEqual(schema.parse({ action: 'orchestration', mode }), { action: 'orchestration', mode });
    }
    for (const mode of ['focused', 'balanced', 'invented', '', true]) {
        assert.equal(schema.safeParse({ action: 'orchestration', mode }).success, false);
    }
});

test('composer hook preserves the reviewed original, existing controls, and refuses partial or drifted bundles', () => {
    const installed = readFileSync(new URL('../tools/node_modules/@getpaseo/server/' + COMPOSER_FILE, import.meta.url), 'utf8');
    const original = withoutAgentsSettings(withoutHideReasoning(withoutUsageOrder(withoutUsageColors(withoutHelpMenu(withoutSidebarToolbar(withoutAgentProgress(withoutAutoEffort(withoutCollaboration(withoutWhite2Theme(withoutWorktreeSetupTip(withoutImportCwd(installed))))))))))));
    assert.equal(gitBlob(original), 'bdc4b8ed97dbccc7e6215d7f2f7be2e420fce895');
    const result = patchedComposerSource(original);
    assert.equal(withoutAgentsSettings(withoutHideReasoning(withoutUsageOrder(withoutUsageColors(withoutHelpMenu(withoutSidebarToolbar(withoutAgentProgress(withoutAutoEffort(withoutCollaboration(withoutWhite2Theme(withoutWorktreeSetupTip(withoutImportCwd(result)))))))))))), original);
    assert.equal(composerFixture(result), result);
    assert.ok(result.includes(FAST_RENDER));
    assert.ok(result.includes('children:[Fe,Le,Ee,ze,Be]'));
    assert.ok(result.includes('j.AgentModeControl,Object.assign({},ve,{onClose:E})'));
    assert.ok(result.includes('k.PluginComposerPills,{serverId:j,workspaceId:D,agentId:x,compact:L}'));
    assert.throws(() => patchedComposerSource(result.replace(FAST_RENDER, '')), /Partial Paseo collaboration/);
    assert.throws(() => patchedComposerSource(result.replace(FAST_DRAFT_RENDER, COLLABORATION_DRAFT_ANCHOR)),
        /Partial Paseo collaboration/);
    assert.throws(() => patchedComposerSource(original + '// drift'), /hash mismatch/);
    new Function(result);
});

test('new-agent draft composer gets Fast, and each exact previous install upgrades through the hash gate', () => {
    const installed = readFileSync(new URL('../tools/node_modules/@getpaseo/server/' + COMPOSER_FILE, import.meta.url), 'utf8');
    const result = composerFixture(installed);
    const draftStart = result.indexOf('_e.DraftAgentControls=function');
    const draftEnd = result.indexOf('var o=r(d[0])', draftStart);
    assert.ok(draftStart > 0 && result.slice(draftStart, draftEnd).endsWith(FAST_DRAFT_RENDER));
    assert.ok(result.slice(draftStart, draftEnd).includes('modelSelectorServerId:w'));
    assert.ok(result.includes('Trigger:K.AgentControlTrigger,Icon:b.Zap'));
    // 모든 이전 협업 UI는 원본 해시를 통과한 뒤 Fast 토글로 바뀐다.
    const [v1, v2] = LEGACY_COLLABORATION_SOURCES;
    const legacyBase = result.replace(FAST_RENDER, COLLABORATION_RENDER).replace(FAST_DRAFT_RENDER, COLLABORATION_DRAFT_RENDER)
        .replace('jsx:J.jsx,Controls:PaseodogFastControls})}', 'jsx:J.jsx,Controls:ve})}');
    const legacyV1 = legacyBase.replace(COLLABORATION_SOURCE, v1.source).replace(COLLABORATION_DRAFT_RENDER, COLLABORATION_DRAFT_ANCHOR);
    const legacyV2 = legacyBase.replace(COLLABORATION_SOURCE, v2.source);
    for (const entry of LEGACY_COLLABORATION_SOURCES) {
        const legacy = legacyBase.replace(COLLABORATION_SOURCE, entry.source)
            .replace(COLLABORATION_DRAFT_RENDER, entry.draft ? COLLABORATION_DRAFT_RENDER : COLLABORATION_DRAFT_ANCHOR);
        assert.notEqual(legacy, result);
        assert.equal(patchedComposerSource(legacy), result);
        assert.throws(() => patchedComposerSource(legacy + '// drift'), /hash mismatch/);
    }
    assert.throws(() => patchedComposerSource(legacyV1.replace(COLLABORATION_RENDER, COLLABORATION_ANCHOR)), /Partial Paseo collaboration/);
    assert.throws(() => patchedComposerSource(legacyV2.replace(COLLABORATION_DRAFT_RENDER, COLLABORATION_DRAFT_ANCHOR)), /Partial Paseo collaboration/);
    assert.throws(() => patchedComposerSource(result.replace(COLLABORATION_SOURCE_ANCHOR, v1.source)), /Partial Paseo collaboration/);
});

// 주입 소스를 번들과 같은 이름으로 평가한다. 트리거·Combobox는 열기/선택/닫기 계약만 흉내 내는 테스트용 대역이다.
function ocheModule(store = { sessions: {} }) {
    const Trigger = React.forwardRef((props, ref) => React.createElement('trigger', { ...props, ref: undefined, anchored: Boolean(ref) }));
    function Combobox(props) {
        if (!props.open) return React.createElement('combobox-closed', { title: props.title });
        return React.createElement('combobox', { title: props.title }, props.header, props.options.map((option) =>
            React.createElement(React.Fragment, { key: option.id }, props.renderOption({ option, selected: props.value === option.id,
                active: false, onPress: () => { props.onSelect(option.id); if (!props.keepOpenOnSelect) props.onOpenChange(false); } }))));
    }
    const theme = { colors: { foreground: '#000', border: '#ccc', surface0: '#fff', foregroundMuted: '#666' } };
    return new Function('s', 'J', 'n', 't', 'K', 'A', 'b', 'f', 'O',
        LEGACY_COLLABORATION_SOURCES.at(-1).source.replace(COLLABORATION_SOURCE_ANCHOR, '') + ';return { PaseodogCollaboration, PaseodogDraftCollaboration };')(
        React, { jsx: React.createElement, jsxs: React.createElement }, { View: 'view' }, { Text: 'text' },
        { AgentControlTrigger: Trigger }, { Combobox, ComboboxItem: 'item' }, { Users: 'users-icon' },
        { useUnistyles: () => ({ theme }) }, { useSessionStore: (selector) => selector(store) });
}

test('the draft OCHE reads the selected host client from the session store and hides for other providers', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const calls = [];
    const client = { async invokePluginRpc(plugin, method, input) { calls.push(input); return { orchestration: 'swarm' }; } };
    const { PaseodogDraftCollaboration: Draft } = ocheModule({ sessions: { host1: { client } } });
    let draft, other, offline;
    try {
        await act(async () => {
            draft = create(React.createElement(Draft, { serverId: 'host1', provider: 'paseodog' }));
            other = create(React.createElement(Draft, { serverId: 'host1', provider: 'codex' }));
            offline = create(React.createElement(Draft, { serverId: null, provider: 'paseodog' }));
        });
        assert.equal(other.toJSON(), null);
        assert.equal(offline.toJSON(), null);
        const trigger = draft.root.findByType('trigger');
        assert.equal(trigger.props.label, 'OCHE');
        const icon = trigger.props.icon({});
        assert.equal(icon.props.children[0].props.color, '#16a34a');
        assert.equal(icon.props.children[1].props.children, '●');
        assert.match(trigger.props.accessibilityLabel, /^OCHE .*켜짐/);
        assert.deepEqual(calls, [{ action: 'read' }]);
    } finally {
        await act(async () => { draft?.unmount(); other?.unmount(); offline?.unmount(); });
        delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    }
});

test('host collaboration writes the real controls RPC once, shares state, and exposes uncertain failures without replay', async () => {
    const calls = [];
    let mode = 'none', fail = false;
    const client = { async invokePluginRpc(plugin, method, input) {
        calls.push({ plugin, method, input });
        if (input.action === 'orchestration') mode = input.mode;
        if (fail) throw new Error('ack lost after write');
        return { orchestration: mode };
    } };
    const state = createCollaborationState(client);
    let changes = 0;
    const unsubscribe = state.subscribe(() => { changes++; });
    await state.refresh();
    assert.equal(state.getSnapshot().mode, 'none');
    await state.setEnabled(true);
    assert.equal(state.getSnapshot().mode, 'swarm');
    await state.setEnabled(false);
    assert.equal(state.getSnapshot().mode, 'none');
    fail = true;
    await state.setEnabled(true);
    assert.equal(mode, 'swarm');
    assert.equal(state.getSnapshot().mode, null);
    assert.match(state.getSnapshot().error, /자동 재전송하지/);
    assert.deepEqual(calls.map(({ input }) => input), [
        { action: 'read' }, { action: 'orchestration', mode: 'swarm' },
        { action: 'orchestration', mode: 'none' }, { action: 'orchestration', mode: 'swarm' },
    ]);
    assert.ok(calls.every(({ plugin, method }) => plugin === 'paseodog-provider' && method === 'engine-controls'));
    fail = false;
    await state.refresh();
    assert.equal(state.getSnapshot().mode, 'swarm');
    assert.ok(changes > 0);
    unsubscribe();
});

test('OCHE opens a dropdown whose inner switch writes the shared host RPC once, stays open, closes, and never retries', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const calls = [];
    let fail = false;
    const client = { async invokePluginRpc(plugin, method, input) {
        calls.push({ plugin, method, input });
        if (fail && input.action === 'orchestration') throw new Error('ack lost');
        return { orchestration: input.mode || 'none' };
    } };
    const { PaseodogCollaboration: Component } = ocheModule();
    let first, second, other;
    try {
        await act(async () => {
            first = create(React.createElement(Component, { client, provider: 'paseodog' }));
            second = create(React.createElement(Component, { client, provider: 'paseodog' }));
            other = create(React.createElement(Component, { client, provider: 'codex' }));
        });
        assert.equal(other.toJSON(), null);
        const trigger = () => first.root.findByType('trigger');
        const item = () => first.root.findByType('item');
        assert.equal(trigger().props.label, 'OCHE');
        assert.equal(trigger().props.showCaret, true);
        assert.equal(trigger().props.anchored, true);
        assert.equal(first.root.findAllByType('item').length, 0);
        await act(async () => trigger().props.onPress());
        assert.equal(trigger().props.open, true);
        assert.match(item().props.accessibilityLabel, /에이전트 협업 스위치 \(호스트 전체\): 꺼짐 · 단독 실행/);
        assert.equal(item().props.selected, false);
        const header = first.root.findByType('combobox').findAllByType('text').map((node) => node.props.children).join(' ');
        assert.match(header, /호스트 전체.*다음 요청.*승인 설정은 그대로/);
        // 메뉴 안 스위치: 공유 RPC 한 번, 저장 중 두 번째 누름은 무시, 메뉴는 열린 채 유지.
        await act(async () => { item().props.onPress(); item().props.onPress(); });
        assert.equal(item().props.selected, true);
        assert.equal(trigger().props.open, true);
        assert.equal(second.root.findByType('trigger').props.accessibilityLabel, 'OCHE 오케스트레이션: 켜짐 · 에이전트 협업');
        assert.deepEqual(calls.filter(({ input }) => input.action !== 'read').map(({ input }) => input),
            [{ action: 'orchestration', mode: 'swarm' }]);
        assert.ok(calls.every(({ plugin, method }) => plugin === 'paseodog-provider' && method === 'engine-controls'));
        // 닫기는 상태 변경 없이 메뉴만 닫는다.
        const before = calls.length;
        await act(async () => first.root.findByType('combobox').parent.props.onOpenChange(false));
        assert.equal(trigger().props.open, false);
        assert.equal(first.root.findAllByType('item').length, 0);
        assert.equal(calls.length, before);
        // 저장 실패: 확인 필요 표시, 다음 누름은 읽기만 하고 저장을 다시 보내지 않는다.
        fail = true;
        await act(async () => trigger().props.onPress());
        await act(async () => item().props.onPress());
        assert.match(item().props.description, /확인 필요/);
        await act(async () => item().props.onPress());
        const writes = calls.filter(({ input }) => input.action === 'orchestration');
        assert.equal(writes.length, 2);
        assert.deepEqual(calls.at(-1).input, { action: 'read' });
    } finally {
        await act(async () => { first?.unmount(); second?.unmount(); other?.unmount(); });
        delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    }
});

test('a lost controls daemon acknowledgment never falls back to replaying a mutation', async () => {
    let fallbacks = 0;
    const controls = createEngineControls({
        execCommand: async () => { fallbacks++; return { stdout: '{}' }; },
        spawnProcess() {
            const child = new EventEmitter();
            child.stdin = new PassThrough();
            child.stdout = new PassThrough();
            child.kill = () => {};
            child.stdin.on('data', () => child.emit('exit', 1));
            return child;
        },
    });
    controls.bind({ command: '/test/engine', args: [], env: {} });
    try {
        await assert.rejects(controls.read({ action: 'orchestration', mode: 'swarm' }), /새로고침/);
        assert.equal(fallbacks, 0);
    } finally { await controls.close(); }
});

test('legacy saved modes normalize and open sessions switch on the next turn without history, agent or approval changes', async () => {
    for (const legacy of ['focused', 'balanced']) assert.equal(normalizeOrchestrationMode(legacy), 'swarm');
    for (const mode of ['none', 'swarm']) assert.equal(normalizeOrchestrationMode(mode), mode);
    let savedMode = 'balanced';
    const disabledAgents = ['worker'], history = [{ role: 'user', content: 'Existing native context' }];
    const engines = [], sessions = [], writes = [];
    try {
        for (const permission of ['ask', 'bypass']) {
            const session = { id: permission, messages: structuredClone(history), orchestrationMode: 'balanced' };
            sessions.push(session);
            const runtime = {
                id: session.id, session,
                get orchestrationMode() { return session.orchestrationMode; },
                async setOrchestrationMode(mode) { writes.push(mode); savedMode = mode; },
                async ask(text, options) { options.beforeSessionAsk(session); return { content: text }; },
                resume: async () => session, abort() {}, close() {}, compact() {},
            };
            engines.push(await createNativeEngine({
                nativeSessionId: session.id, config: { cwd: '/work', mode: permission, mcpServers: {} },
            }, {
                modules: {
                    loadConfig: () => ({ orchestrationMode: savedMode, disabledAgents }),
                    async createMixdogSessionRuntime(options) {
                        assert.equal(options.initialConfig.orchestrationMode, 'swarm');
                        assert.deepEqual(options.initialConfig.disabledAgents, ['worker']);
                        session.cwd = '/work';
                        const tool = { getStatus: () => ({ jobs: [] }), onStatusChange: () => () => {},
                            closeAll: async () => ({ failed: [] }) };
                        options.agentSessionSurface({ mgr: {}, getAgentTool: () => tool });
                        return runtime;
                    },
                },
            }));
        }
        for (const mode of ['swarm', 'none', 'swarm']) {
            savedMode = mode === 'swarm' ? 'focused' : mode;
            for (let index = 0; index < engines.length; index++) {
                await engines[index].ask('continue', {});
                const session = sessions[index];
                assert.equal(session.orchestrationMode, mode);
                assert.deepEqual(session.messages, history);
                assert.equal(engines[index].id, session.id);
                assert.equal((await session.beforeToolHook({ name: 'shell', args: {} })).action, index ? 'rewrite' : 'ask');
                assert.equal((await session.beforeToolHook({ name: 'agent', args: {} })).action,
                    index ? 'rewrite' : 'ask');
            }
        }
        assert.deepEqual(disabledAgents, ['worker']);
        assert.ok(writes.every((mode) => ['none', 'swarm'].includes(mode)));
    } finally { await Promise.all(engines.map((engine) => engine.close('test-done'))); }
});

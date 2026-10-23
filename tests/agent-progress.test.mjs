import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { patchedComposerSource, COMPOSER_FILE, withoutWorktreeSetupTip } from '../scripts/patch-paseo-composer.mjs';
import { withoutWhite2Theme } from '../scripts/patch-paseo-theme.mjs';
import { withoutSingleWorkspace } from '../patches/paseo-single-workspace.mjs';
import { withoutHostSwitch } from '../patches/paseo-host-switch.mjs';
import { gitBlob } from '../scripts/patch-mixdog.mjs';
import { withoutCollaboration, FAST_RENDER as COLLABORATION_RENDER } from '../patches/paseo-collaboration.mjs';
import { withoutAutoEffort } from '../patches/paseo-auto-effort.mjs';
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
import { withoutVersionDetails } from '../patches/paseo-version-details.mjs';
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
    source = withoutVersionDetails(source);
    source = withoutSettingsOrganization(source);
    source = withoutDaemonUpdate(source);
    source = withoutMarkdownTable(source);
    source = withoutCompactionBuffer(withoutOfferLink(withoutSettingsCorrections(withoutAgentEditorSafety(withoutChatUsability(source)))));
    return withoutUsageOrderOnly(withoutUsageDonut(withoutSidebarStatusShapes(withoutWorkRecords(withoutExternalLinks(withoutRelayPassword(withoutConversationFocus(source)))))));
};
import { withoutHideReasoning } from '../patches/paseo-hide-reasoning.mjs';
import { withoutImportCwd } from '../patches/paseo-import-cwd.mjs';
import { withoutAgentsSettings } from '../patches/paseo-agents-settings.mjs';
import {
    summarizeAgentJobs, paseodogBridgeId, agentProgressSegments, withoutAgentProgress,
    PROGRESS_SOURCE, PROGRESS_HOOK, PROGRESS_VISIBLE, PROGRESS_RENDER,
} from '../patches/paseo-agent-progress.mjs';

const require = createRequire(new URL('../plugin/package.json', import.meta.url));
const React = require('react');
const { create, act } = require('react-test-renderer');
const installed = readFileSync(new URL('../tools/node_modules/@getpaseo/server/' + COMPOSER_FILE, import.meta.url), 'utf8');
const original = withoutAgentsSettings(withoutHideReasoning(withoutUsageOrder(withoutUsageColors(withoutHelpMenu(withoutSidebarToolbar(withoutAgentProgress(withoutAutoEffort(withoutCollaboration(withoutWhite2Theme(withoutWorktreeSetupTip(withoutImportCwd(installed))))))))))));
const patched = composerFixture(installed);
import { composerFixture } from './composer-fixture.mjs';
const handle = (bridgeId) => ({ provider: 'paseodog', sessionId: `plugin:${JSON.stringify({ version: 2, data: { bridgeId } })}` });

// 패치된 실제 AgentTracks 번들 모듈만 잘라 Metro 의존성 대역으로 실행한다.
function loadAgentTracks({ store, hasDiff = false }) {
    const end = patched.indexOf('279,898,4779]);') + '279,898,4779]);'.length;
    const start = patched.lastIndexOf('__d(function', patched.indexOf(PROGRESS_RENDER));
    const useSessionStore = (selector) => selector(store);
    useSessionStore.getState = () => store;
    const modules = {
        455: require('react/compiler-runtime'), 36: React, 279: require('react/jsx-runtime'),
        4999: { WorkspaceDiffStatPill: 'diff-pill' }, 4985: { useWorkspaceHasDiffStat: () => hasDiff },
        5000: { AgentTaskList: 'tasks' }, 1218: { useIsCompactFormFactor: () => false, supportsDesktopPaneSplits: () => false },
        5001: { ComposerTrackBar: ({ children }) => React.createElement('track-bar', null, children),
            ComposerTrackPill: 'track-pill', ComposerTrackRow: 'track-row' },
        4612: { usePaneContext: () => ({ tabId: 'tab', openTab() {} }) }, 885: { useSettings: () => ({}) },
        4770: { PluginComposerPills: 'plugin-pills' }, 3657: { useSessionStore },
        5002: { useArchiveSubagent: () => () => {}, useDetachSubagent: () => () => {} }, 5010: { SubagentsTrack: 'subagents' },
        4014: { navigateToAgent() {} }, 3786: { buildWorkspaceTabPersistenceKey: () => 'key' },
        4610: { openPreferredWorkspaceTarget() {} }, 4608: { openComposerChanges() {} },
        898: { Text: 'text' }, 4779: { composerPillStyles: { label: { color: 'muted' } } },
    };
    let exports;
    new Function('__d', patched.slice(start, end))((factory, id, deps) => {
        assert.equal(id, 4998);
        exports = {};
        factory(globalThis, (moduleId) => modules[moduleId], null, null, {}, exports, deps);
    });
    return exports.AgentTracks;
}

test('Mixdog statusline classification counts only live child jobs of one parent', () => {
    assert.equal(summarizeAgentJobs([]), null);
    assert.equal(summarizeAgentJobs([{ id: 'a', status: 'completed' }, { id: 'b', status: 'running', stage: 'cancelled' },
        { id: 'c', status: 'failed' }, { id: 'd', status: 'idle' }, { id: 'e' }]), null);
    const summary = summarizeAgentJobs([
        { id: '1', agent: 'worker', tag: 'w1', status: 'running', stage: 'streaming' },
        { id: '2', agent: 'reviewer', status: 'queued' },
        { id: '3', agent: 'worker', status: 'running', waitingApproval: true },
        { id: '4', agent: 'worker', stage: 'tool_running' },
        { id: '5', agent: 'worker', status: 'done' },
    ]);
    assert.deepEqual({ running: summary.running, waiting: summary.waiting, queued: summary.queued }, { running: 2, waiting: 1, queued: 1 });
    assert.deepEqual(agentProgressSegments(summary), [
        { bucket: 'running', text: '에이전트 2 실행' }, { bucket: 'needs_input', text: '1 승인 대기' }, { text: '1 실행 대기' }]);
    assert.equal(paseodogBridgeId({ provider: 'paseodog', persistence: handle('b1') }), 'b1');
    assert.equal(paseodogBridgeId({ provider: 'paseodog', persistence: { metadata: { pluginProviderPersistence: { data: { bridgeId: 'b2' } } } } }), 'b2');
    assert.equal(paseodogBridgeId({ provider: 'codex', persistence: handle('b1') }), null);
    assert.equal(paseodogBridgeId({ provider: 'paseodog', persistence: { sessionId: 'plugin:{bad' } }), null);
});

test('progress hook rides the reviewed composer bundle and refuses partial or drifted bundles', () => {
    assert.ok(['bdc4b8ed97dbccc7e6215d7f2f7be2e420fce895', '35606b3c900c220239427937d2aa55f0860f1bb4'].includes(gitBlob(original)));
    for (const marker of [PROGRESS_SOURCE, PROGRESS_HOOK, PROGRESS_VISIBLE, PROGRESS_RENDER, COLLABORATION_RENDER])
        assert.equal(patched.split(marker).length, 2);
    assert.ok(patched.includes('(0,T.jsx)(PaseodogAgentProgress,{serverId:j,agentId:x}),ie]'));
    assert.equal(withoutAgentsSettings(withoutHideReasoning(withoutUsageOrder(withoutUsageColors(withoutHelpMenu(withoutSidebarToolbar(withoutAgentProgress(withoutAutoEffort(withoutCollaboration(withoutWhite2Theme(withoutWorktreeSetupTip(withoutImportCwd(patched)))))))))))), original);
    assert.ok(patched.includes('n.WorkspaceDiffStatPill,{serverId:j,workspaceId:D,onPress:ne}'));
    assert.equal(composerFixture(patched), patched);
    assert.throws(() => patchedComposerSource(patched.replace(PROGRESS_RENDER, 'children:[re,oe,ce,ie]')), /Partial Paseo agent progress/);
});

test('the patched dist module polls only while mounted and visible, never overlaps, and shows this parent only', async (t) => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    mock.timers.enable({ apis: ['setTimeout'] });
    const listeners = new Set();
    const view = { visibilityState: 'visible', addEventListener: (_, listener) => listeners.add(listener),
        removeEventListener: (_, listener) => listeners.delete(listener) };
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { value: view, configurable: true });
    const calls = [];
    let jobs = [{ id: 'j1', agent: 'worker', status: 'running' }, { id: 'j2', agent: 'reviewer', status: 'queued' }];
    let pending = null;
    const client = { invokePluginRpc(plugin, method, input) {
        calls.push({ plugin, method, input });
        if (pending) return pending.promise;
        return Promise.resolve({ observedAt: 1, sessions: [
            { id: 'p1', bridgeId: 'b1', state: 'running', jobs },
            { id: 'p2', bridgeId: 'other', state: 'running', jobs: [{ id: 'x', status: 'running' }, { id: 'y', status: 'running' }] },
        ] });
    } };
    const store = { sessions: { srv: { client, agents: new Map([
        ['a1', { provider: 'paseodog', persistence: handle('b1') }],
        ['c1', { provider: 'codex', persistence: { provider: 'codex', sessionId: 'codex-1' } }],
    ]) } } };
    const AgentTracks = loadAgentTracks({ store });
    const props = (agentId) => ({ serverId: 'srv', workspaceId: 'w', agentId, cwd: '/work', subagentRows: [], tasks: [],
        archiveFinishedStatus: { kind: 'idle' }, onArchiveFinished() {}, hasPluginComposerPills: false });
    const flush = () => act(async () => { for (let index = 0; index < 5; index++) await Promise.resolve(); });
    let tree, other;
    try {
        await act(async () => { other = create(React.createElement(AgentTracks, props('c1'))); });
        assert.equal(other.toJSON(), null);
        assert.equal(calls.length, 0);
        await act(async () => { tree = create(React.createElement(AgentTracks, props('a1'))); });
        await flush();
        assert.equal(calls.length, 1);
        assert.deepEqual(calls[0], { plugin: 'paseodog-provider', method: 'engine-status', input: {} });
        const pill = () => tree.root.findByProps({ testID: 'paseodog-agent-progress' });
        assert.deepEqual(pill().props.segments, [{ bucket: 'running', text: '에이전트 1 실행' }, { text: '1 실행 대기' }]);
        assert.match(pill().props.accessibilityLabel, /이 세션 하위 에이전트/);
        const bar = tree.toJSON();
        assert.deepEqual(bar.children.map((child) => child.type), ['tasks', 'subagents', 'plugin-pills', 'track-pill', 'diff-pill']);

        pending = Promise.withResolvers();
        await act(async () => mock.timers.tick(2000));
        assert.equal(calls.length, 2);
        view.visibilityState = 'hidden';
        await act(async () => { for (const listener of listeners) listener(); });
        view.visibilityState = 'visible';
        await act(async () => { for (const listener of listeners) listener(); });
        assert.equal(calls.length, 2, 'an in-flight read is never overlapped');
        jobs = [{ id: 'j1', agent: 'worker', status: 'completed' }];
        const resolve = pending.resolve; pending = null;
        resolve({ observedAt: 2, sessions: [{ id: 'p1', bridgeId: 'b1', jobs }] });
        await flush();
        assert.equal(tree.toJSON(), null, 'idle parent and no diff hides the bar');

        view.visibilityState = 'hidden';
        await act(async () => { for (const listener of listeners) listener(); });
        await act(async () => mock.timers.tick(10000));
        assert.equal(calls.length, 2, 'background stops polling');
        await act(async () => tree.unmount());
        await act(async () => other.unmount());
        tree = other = null;
        view.visibilityState = 'visible';
        await act(async () => mock.timers.tick(10000));
        assert.equal(calls.length, 2, 'unmount stops polling');
        assert.equal(listeners.size, 0);
    } finally {
        await act(async () => { tree?.unmount(); other?.unmount(); });
        mock.timers.reset();
        if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
        else delete globalThis.document;
        delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    }
});

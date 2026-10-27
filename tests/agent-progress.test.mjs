import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runSharedAppTests } from './shared-app-tests.mjs';
import { withoutWhite2Theme } from '../scripts/patch-paseo-theme.mjs';
import { withoutSingleWorkspace } from '../patches/paseo-single-workspace.mjs';
import { withoutHostSwitch } from '../patches/paseo-host-switch.mjs';
import { withoutComposerControls } from '../patches/paseo-composer-controls.mjs';
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
    source = withoutComposerControls(source);
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
const handle = (bridgeId) => ({ provider: 'paseodog', sessionId: `plugin:${JSON.stringify({ version: 2, data: { bridgeId } })}` });


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

// 실제 공유 monitor와 행의 부모 격리·숨김/해제 후 중단·중복 조회 방지·오류 표시를 실행한다.
test('shared progress polling is visible-only, non-overlapping and isolated by parent', () =>
    runSharedAppTests([
        'src/panels/agent-progress-state.test.ts',
        'src/panels/agent-tracks.test.tsx',
    ]));

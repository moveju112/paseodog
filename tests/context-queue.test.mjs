import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { contextUsage } from '../plugin/server/util.mjs';
import { fixture, until, deferred } from './helpers.mjs';
import { COMPOSER_FILE, QUEUE_GUARD, patchedComposerSource, patchPaseoComposer, withoutWorktreeSetupTip } from '../scripts/patch-paseo-composer.mjs';
import { withWhite2Theme, withoutWhite2Theme } from '../scripts/patch-paseo-theme.mjs';
import { withoutSingleWorkspace } from '../patches/paseo-single-workspace.mjs';
import { withoutCollaboration } from '../patches/paseo-collaboration.mjs';
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

const root = new URL('../tools/node_modules/@getpaseo/server/', import.meta.url).pathname;
const bundle = readFileSync(root + COMPOSER_FILE, 'utf8');

test('composer patch applies exactly to a temporary installation and is idempotent', (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'paseodog-composer-test-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, COMPOSER_FILE);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(join(directory, 'package.json'), readFileSync(root + 'package.json'));
    writeFileSync(path, bundle);
    writeFileSync(path + '.br', brotliCompressSync(bundle));
    writeFileSync(path + '.gz', gzipSync(bundle));
    patchPaseoComposer(directory);
    patchPaseoComposer(directory, { check: true });
    const patched = readFileSync(path, 'utf8');
    assert.equal(patchedComposerSource(patched) === patched, true);
    assert.throws(() => patchedComposerSource(bundle + '// drift'), /hash mismatch/);
    assert.equal(patched.includes(QUEUE_GUARD), false, 'Native steering must not be replaced with a client queue');
});

test('retiring the queue override preserves the separately applied White2 theme', () => {
    const themed = withoutAgentsSettings(withWhite2Theme(withoutHideReasoning(withoutUsageOrder(withoutUsageColors(withoutHelpMenu(withoutSidebarToolbar(withoutAgentProgress(withoutAutoEffort(withoutCollaboration(withoutWhite2Theme(withoutWorktreeSetupTip(withoutImportCwd(bundle)))))))))))));
    const patched = patchedComposerSource(themed);
    assert.equal(withoutAgentsSettings(withoutHideReasoning(withoutUsageOrder(withoutUsageColors(withoutHelpMenu(withoutSidebarToolbar(withoutAgentProgress(withoutAutoEffort(withoutCollaboration(withoutWorktreeSetupTip(withoutImportCwd(patched))))))))))) === themed, true);
});

test('explicit queued messages preserve FIFO attachments separately from native steering', () => {
    const start = bundle.indexOf('e.queueComposerMessage=function(t)') + 'e.queueComposerMessage='.length;
    const end = bundle.indexOf(',e.editQueuedComposerMessage=', start);
    assert.ok(start > 0 && end > start);
    let sequence = 0;
    const queueComposerMessage = new Function('i', `return (${bundle.slice(start, end)});`)({
        generateMessageId: () => `queued-${++sequence}`,
    });
    let messages = new Map();
    const queue = { read: (id) => messages.get(id) || [], write: (update) => { messages = update(messages); } };
    const attachment = { kind: 'image', metadata: { id: 'image-1' } };
    queueComposerMessage({ agentId: 'a', text: 'A 추가 1', attachments: [attachment], queue });
    queueComposerMessage({ agentId: 'a', text: 'A 추가 2', attachments: [], queue });
    assert.deepEqual(messages.get('a').map((entry) => entry.text), ['A 추가 1', 'A 추가 2']);
    assert.deepEqual(messages.get('a')[0].attachments, [attachment]);
});

test('context projection keeps real zero and unknowns without summing cumulative usage', () => {
    assert.deepEqual(contextUsage({ usedTokens: 0, effectiveContextWindow: 100 }), {
        contextWindowMaxTokens: 100, contextWindowUsedTokens: 0,
    });
    assert.deepEqual(contextUsage({ usedTokens: 42, contextWindow: 100, totalInputTokens: 99999 }), {
        contextWindowMaxTokens: 100, contextWindowUsedTokens: 42,
    });
    assert.deepEqual(contextUsage({ usedTokens: NaN, contextWindow: null }), {});
    assert.deepEqual(contextUsage({ usedTokens: -1, contextWindow: Infinity }), {});
});

test('chat context is published on open, response and compact without replacing token counts', async (t) => {
    let usedTokens = 40;
    const f = fixture({
        async status() { return { context: { usedTokens, effectiveContextWindow: 1000 } }; },
        async compact() { usedTokens = 10; return { changed: true }; },
    });
    t.after(() => f.connection.close());
    await f.ready();
    assert.deepEqual(f.events.find((event) => event.type === 'session.usage').usage, {
        contextWindowMaxTokens: 1000, contextWindowUsedTokens: 40,
    });
    await f.run();
    const usage = f.events.filter((event) => event.type === 'session.usage').at(-1).usage;
    assert.equal(usage.inputTokens, 12);
    assert.equal(usage.contextWindowUsedTokens, 40);
    const command = { ...f.prompt, prompt: { ...f.prompt.prompt, clientMessageId: 'compact-1',
        input: { type: 'command', name: 'compact' } } };
    await f.connection.send(command);
    await until(f.events, (event) => event.type === 'session.prompt_result' && event.clientMessageId === 'compact-1');
    // 다음 상태 조회가 완료되었음을 마지막 컨텍스트 이벤트로 확인한다.
    await until(f.events, (event) => event.type === 'session.usage' && event.usage.contextWindowUsedTokens === 10);
});

test('late context measurements cannot overwrite a canceled turn', async (t) => {
    const gate = deferred(), started = deferred();
    let reads = 0;
    const f = fixture({
        async status() {
            if (++reads > 1) { started.resolve(); await gate.promise; }
            return { context: { usedTokens: reads > 1 ? 999 : 40, contextWindow: 1000 } };
        },
    });
    t.after(async () => { gate.resolve(); await f.connection.close(); });
    await f.ready();
    await f.connection.send(f.prompt);
    await started.promise;
    await f.connection.send({ type: 'session.interrupt', requestId: 'stop', sessionId: 'p1' });
    await until(f.events, (event) => event.type === 'request.completed' && event.requestId === 'stop');
    gate.resolve();
    await f.connection.close();
    assert.equal(f.events.some((event) => event.type === 'session.usage' && event.usage.contextWindowUsedTokens === 999), false);
});

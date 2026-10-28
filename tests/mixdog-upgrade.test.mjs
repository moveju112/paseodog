import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attachHostPolicy } from '../engine/src/policy.mjs';
import { createNativeEngine, loadNativeModules } from '../engine/src/native-engine.mjs';
import { readHookSettings } from '../engine/src/hook-settings.mjs';
import { promptText } from '../plugin/server/util.mjs';

// 실제 엔진 모듈도 개인 프로필 대신 이 테스트가 소유한 전용 경로만 사용한다.
const home = mkdtempSync(join(tmpdir(), 'paseodog-mixdog-upgrade-'));
process.env.MIXDOG_HOME = home;
process.env.MIXDOG_DATA_DIR = join(home, 'data');
after(() => rmSync(home, { recursive: true, force: true }));

const { sessionAdopter } = await import('../engine/node_modules/mixdog/src/session-runtime/boot/infrastructure.mjs');
const { createStandaloneHookBus } = await import('../engine/node_modules/mixdog/src/session-runtime/services/hook-bus.mjs');
const { writeJsonAtomicSync, readJsonStateSync } = await import('../engine/node_modules/mixdog/src/runtime/shared/atomic-file.mjs');
const { readProviderAccountPool } = await import('../engine/node_modules/mixdog/src/runtime/shared/provider-accounts.mjs');
const { resolveOutputLimit } = await import('../engine/node_modules/mixdog/src/runtime/agent/orchestrator/session/loop/no-tool-turn/output-limit.mjs');
const { invalidateDamagedEffortJudgeInstall, installEffortJudgeModel } = await import('../engine/node_modules/mixdog/src/runtime/effort-judge/model-install.mjs');
const { compactionSummaryPlan } = await import('../engine/node_modules/mixdog/src/runtime/agent/orchestrator/session/loop/fresh-context.mjs');
const { freshContextCompactMessages } = await import('../engine/node_modules/mixdog/src/runtime/agent/orchestrator/session/compact.mjs');
const { createCompactionSettings } = await import('../engine/node_modules/mixdog/src/session-runtime/settings-compaction-api.mjs');
const { normalizeCompactionConfig } = await import('../engine/node_modules/mixdog/src/runtime/agent/orchestrator/runtime-core/config-helpers.mjs');
const { _sessionForDisk } = await import('../engine/node_modules/mixdog/src/runtime/agent/orchestrator/session/store/serialize.mjs');
const { normalizeContentForAnthropic } = await import('../engine/node_modules/mixdog/src/runtime/agent/orchestrator/providers/media-normalization.mjs');

test('cold resume restores native deny hooks before every host approval mode', async () => {
    for (const mode of ['ask', 'review', 'bypass']) {
        let calls = 0;
        const boot = {
            rt: { currentCwd: home },
            hooks: {
                beforeTool: async input => {
                    calls++;
                    return input.name === 'blocked' ? { action: 'deny', reason: 'fixture rule' } : null;
                },
                dispatch: async () => {},
            },
            hookCommonPayload: value => value,
            bindRuntimeNotificationSession() {},
        };
        const session = { id: 'restored-session', cwd: home, messages: [] };
        sessionAdopter(boot)(session);
        assert.equal(typeof session.beforeToolHook, 'function');
        attachHostPolicy(session, { mode });
        sessionAdopter(boot)(session);
        attachHostPolicy(session, { mode });
        assert.deepEqual(await session.beforeToolHook({ name: 'blocked', args: {} }),
            { action: 'deny', reason: 'fixture rule' });
        assert.equal(calls, 1);
    }
});

test('unrecoverable hook corruption fails closed, while a good backup restores its deny rule', async () => {
    const directory = mkdtempSync(join(home, 'hooks-'));
    const file = join(directory, 'hooks.json');
    const bus = createStandaloneHookBus({ dataDir: directory });
    const input = { cwd: directory, name: 'shell', args: { command: 'fixture never executed' } };
    writeFileSync(file, '{broken');
    const blocked = await bus.beforeTool(input);
    assert.equal(blocked.action, 'deny');
    assert.match(blocked.reason, /policy check failed/);
    assert.equal(readFileSync(file, 'utf8'), '{broken');
    const rules = { toolBefore: [{ tool: 'shell', action: 'deny', enabled: true, reason: 'fixture deny' }] };
    writeJsonAtomicSync(file, rules, { backup: true });
    writeJsonAtomicSync(file, { toolBefore: [] }, { backup: true });
    writeFileSync(file, '{broken');
    assert.throws(() => readHookSettings({ rulesPath: file }));
    assert.equal(readFileSync(file, 'utf8'), '{broken');
    assert.equal(readdirSync(directory).some(name => name.includes('.corrupt-')), false);
    const recovered = await bus.beforeTool(input);
    assert.equal(recovered.action, 'deny');
    assert.equal(recovered.reason, 'fixture deny');
    assert.equal(readdirSync(directory).filter(name => name.startsWith('hooks.json.corrupt-')).length, 1);
});

test('damaged account state restores the last good roster without losing owner-only permissions', () => {
    const directory = mkdtempSync(join(home, 'accounts-'));
    const file = join(directory, 'provider-accounts.json');
    const roster = { version: 1, providers: { 'openai-oauth': {
        accounts: [{ id: 'default', label: 'Fixture account' }], selectedId: 'default', auto: false,
    } } };
    const options = { backup: true, secret: true, mode: 0o600, fsyncDir: true };
    writeJsonAtomicSync(file, roster, options);
    writeJsonAtomicSync(file, { version: 1, providers: {} }, options);
    writeFileSync(file, Buffer.alloc(64));
    const pool = readProviderAccountPool('openai-oauth', directory);
    assert.equal(pool.selectedId, 'default');
    assert.equal(pool.accounts[0].label, 'Fixture account');
    assert.equal(readdirSync(directory).filter(name => name.startsWith('provider-accounts.json.corrupt-')).length, 1);
    if (process.platform !== 'win32') {
        assert.equal(statSync(file).mode & 0o777, 0o600);
        assert.equal(statSync(`${file}.bak`).mode & 0o777, 0o600);
    }
});

test('writing over damaged JSON never promotes the damaged bytes to the good backup', () => {
    const file = join(home, 'settings.json');
    writeJsonAtomicSync(file, { revision: 1 }, { backup: true });
    writeJsonAtomicSync(file, { revision: 2 }, { backup: true });
    writeFileSync(file, Buffer.alloc(16));
    writeJsonAtomicSync(file, { revision: 3 }, { backup: true });
    assert.deepEqual(JSON.parse(readFileSync(`${file}.bak`, 'utf8')), { revision: 1 });
    writeFileSync(file, Buffer.alloc(16));
    assert.deepEqual(readJsonStateSync(file), { revision: 1 });
});

function recoveryContext(partial = false) {
    const messages = [];
    return {
        messages, state: { maxOutputRecoveryCount: 0, outputEscalationUsed: false },
        opts: partial ? { onTextReset: () => false } : {},
        segments: {
            parts: [],
            record(text) { this.parts.push(text); },
            commitIntermediate(response) { messages.push({ role: 'assistant', content: response.content }); },
        },
        escalateMaxTokens: () => 128000,
        streamedChars: () => partial ? 7 : 0,
    };
}

test('empty output-limit recovery raises the budget once, then resumes at most three times', async () => {
    const context = recoveryContext();
    const response = { stopReason: 'max_tokens', content: '' };
    assert.equal((await resolveOutputLimit(response, context)).action, 'continue');
    assert.equal(context.opts.maxOutputTokensOverride, 128000);
    assert.equal(context.messages.length, 0);
    for (let attempt = 0; attempt < 3; attempt++) {
        assert.equal((await resolveOutputLimit(response, context)).action, 'continue');
    }
    const terminal = await resolveOutputLimit(response, context);
    assert.equal(terminal.action, 'break');
    assert.equal(terminal.response.maxOutputRecoveryAttempts, 3);
    assert.match(terminal.response.content, /output limit/);
    assert.equal(context.messages.length, 3);
});

test('a host that cannot retract streamed text resumes instead of replaying the visible partial', async () => {
    const context = recoveryContext(true);
    const result = await resolveOutputLimit({ stopReason: 'max_tokens', content: 'partial' }, context);
    assert.equal(result.action, 'continue');
    assert.equal(context.opts.maxOutputTokensOverride, undefined);
    assert.equal(context.messages[0].content, 'partial');
    assert.equal(context.messages[1].meta.source, 'max-output-recovery');
});

test('judge repair detects same-size corruption and replaces only the damaged file', async () => {
    const directory = mkdtempSync(join(home, 'judge-'));
    const model = Buffer.from('review-only-model-bytes');
    const calibration = Buffer.from('{}');
    const metadata = (bytes, url) => ({
        size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), url,
    });
    const manifest = { release: 'test-fixture', files: {
        'model.onnx': metadata(model, 'https://example.invalid/model'),
        'calibration.json': metadata(calibration, 'https://example.invalid/calibration'),
    } };
    writeFileSync(join(directory, 'model.onnx'), model);
    writeFileSync(join(directory, 'calibration.json'), calibration);
    writeFileSync(join(directory, 'install.json'), JSON.stringify({ release: manifest.release }));
    assert.deepEqual(await invalidateDamagedEffortJudgeInstall(directory, manifest), []);
    assert.equal(existsSync(join(directory, 'install.json')), true);
    const damaged = Buffer.from(model);
    damaged[damaged.length - 1] = 0;
    writeFileSync(join(directory, 'model.onnx'), damaged);
    assert.deepEqual(await invalidateDamagedEffortJudgeInstall(directory, manifest), ['model.onnx']);
    assert.equal(existsSync(join(directory, 'install.json')), false);
    const downloads = [];
    await installEffortJudgeModel(directory, { manifest, fetchFn: async url => {
        downloads.push(url);
        return new Response(model);
    } });
    assert.deepEqual(downloads, [manifest.files['model.onnx'].url]);
    assert.deepEqual(readFileSync(join(directory, 'model.onnx')), model);
    assert.deepEqual(readFileSync(join(directory, 'calibration.json')), calibration);
    assert.deepEqual(JSON.parse(readFileSync(join(directory, 'install.json'), 'utf8')), { release: manifest.release });
});

const provider = name => ({
    name, send: async () => assert.fail('No model inference is allowed'),
    getCachedModelInfo: () => ({ contextWindow: 128000 }),
});

test('an explicit summary model uses its actual provider and never falls back to Smart', async () => {
    const parent = provider('parent'), summary = provider('summary');
    const initialized = [];
    const plan = compactionSummaryPlan({
        sessionRef: { id: 'summary-session', provider: 'parent', model: 'primary' },
        provider: parent, model: 'primary',
        config: { providers: { summary: { enabled: true } }, compaction: {
            summaryModel: 'summary/small', summaryMode: 'smart',
        } },
        getProviderFn: name => { assert.equal(name, 'summary'); return summary; },
        initProvidersFn: async config => initialized.push(config),
    });
    assert.equal(plan.mode, 'explicit');
    assert.equal(plan.steps.length, 1);
    const route = await plan.steps[0]();
    assert.equal(route.provider, summary);
    assert.equal(route.model, 'small');
    assert.equal(route.source, 'summary');
    assert.equal(initialized.length, 1);
    assert.throws(() => compactionSummaryPlan({
        provider: parent, config: { providers: { summary: { enabled: false } },
            compaction: { summaryModel: 'summary/small' } },
    }), /summary provider is disabled/);
});

test('summary model settings survive native updates and can be explicitly cleared', () => {
    let config = { compaction: { summaryModel: 'summary/small', summaryMode: 'self' } };
    const session = { compaction: { ...config.compaction } };
    const settings = createCompactionSettings({
        getConfig: () => config, getSession: () => session,
        saveConfigAndAdopt: next => { config = next; }, hasOwn: Object.hasOwn,
        normalizeCompactionConfig, invalidateContextStatusCache() {},
    });
    settings.setCompactionSettings({ mainBufferRatio: 0.2 });
    assert.equal(config.compaction.summaryModel, 'summary/small');
    assert.equal(config.compaction.summaryMode, 'self');
    settings.setCompactionSettings({ summaryModel: '' });
    assert.equal(Object.hasOwn(config.compaction, 'summaryModel'), false);
    assert.equal(Object.hasOwn(session.compaction, 'summaryModel'), false);
    assert.equal(session.compaction.summaryMode, 'self');
});

test('forced compaction keeps an unanswered agent report and its paired tool result', () => {
    const report = { role: 'user', content: 'Unique fixture report', meta: { source: 'task-notification' } };
    const messages = [
        { role: 'system', content: 'Fixture rules' },
        { role: 'user', content: 'Complete the fixture task' },
        { role: 'assistant', content: 'Checking' },
        report,
        { role: 'assistant', content: '.', meta: { source: 'context-ack' } },
        { role: 'assistant', content: '', toolCalls: [{ id: 'fixture-call', name: 'read', arguments: { path: 'fixture.txt' } }] },
        { role: 'tool', toolCallId: 'fixture-call', content: 'Unique fixture result' },
    ];
    const result = freshContextCompactMessages(messages, 32000, {
        force: true, contextWindow: 128000, preview: true, activeTurn: true,
    });
    assert.equal(result.freshContext, true);
    assert.ok(result.messages.some(message => message.content === report.content));
    assert.ok(result.messages.some(message => message.role === 'tool'
        && message.toolCallId === 'fixture-call' && message.content === 'Unique fixture result'));
    assert.ok(result.messages.some(message => message.toolCalls?.some(call => call.id === 'fixture-call')));
});

test('Anthropic receives no internal attachment metadata and PDF upload remains unadvertised', () => {
    const part = { type: 'text', text: 'Read the referenced file',
        attachmentReference: { kind: 'pdf', attachmentRef: 'fixture-reference' } };
    assert.deepEqual(normalizeContentForAnthropic([part]), [{ type: 'text', text: part.text }]);
    assert.ok(part.attachmentReference);
    assert.throws(() => promptText({ clientMessageId: 'fixture-pdf', input: { type: 'message',
        content: [{ type: 'file', mimeType: 'application/pdf', data: 'JVBERg==' }],
    } }), /Only text and images are supported/);
});

test('persisted context retains late MCP tools while dropping transient turn aliases', () => {
    const tools = [{ name: 'fixture_mcp_tool', description: 'Fixture tool', inputSchema: { type: 'object' } }];
    const session = {
        id: 'catalog-session', messages: [{ role: 'user', content: 'Fixture instruction' }],
        deferredLateToolCatalog: tools, pendingDeferredToolDelta: { added: ['fixture_mcp_tool'] },
        liveTurnMessages: [{ role: 'user', content: 'Transient alias' }],
        _providerPrefixGuardState: { fixture: true },
    };
    const restored = JSON.parse(JSON.stringify(_sessionForDisk(session)));
    assert.deepEqual(restored.deferredLateToolCatalog, tools);
    assert.deepEqual(restored.pendingDeferredToolDelta, session.pendingDeferredToolDelta);
    assert.equal(Object.hasOwn(restored, 'liveTurnMessages'), false);
    assert.equal(Object.hasOwn(restored, '_providerPrefixGuardState'), false);
});

// 같은 세션에 보관된 이전 worktree가 앞에 있어도 저장된 ID로 현재 항목을 고른다.
test('native adapter resolves the requested retained worktree by ID, not its session owner', async () => {
    const entries = Object.fromEntries(['previous', 'current'].map((id) => [id, {
        id, path: `/managed/${id}`, projectPath: '/work', repoCommonDir: '/work/.git',
        branch: `fix/${id}`, ownerSessionId: 'retained-session', state: 'ready',
        createdAt: 1, baseCommit: null,
    }]));
    writeJsonAtomicSync(join(home, 'data', 'worktrees-v1', 'registry.json'), { version: 1, entries });
    const modules = await loadNativeModules();
    for (const id of ['current', 'previous']) {
        const entry = await modules.getWorktree(id);
        assert.equal(entry.id, id);
        assert.equal(entry.path, entries[id].path);
        assert.equal(entry.ownerSessionId, 'retained-session');
        assert.equal(entry.projectSubdir, '');
    }
    assert.equal(await modules.getWorktree('missing'), null);
});

test('the actual pinned native runtime opens and closes through the adapter without model inference', async () => {
    const modules = await loadNativeModules();
    const engine = await createNativeEngine({
        config: { cwd: home, mode: 'ask', mcpServers: {}, settings: {} }, route: {},
    }, { modules: { ...modules, loadConfig: () => ({
        providers: {}, mcpServers: {}, memory: { enabled: false },
        autoClear: { enabled: false }, update: { auto: false },
        heartbeat: true, disabledAgents: ['*'], skills: { disabled: ['*'] },
    }) } });
    await engine.close('offline-upgrade-regression');
});

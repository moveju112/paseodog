import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'paseodog-stability-'));
process.env.MIXDOG_HOME = home;
process.env.MIXDOG_DATA_DIR = join(home, 'data');
process.env.ANTHROPIC_OAUTH_CREDENTIALS_PATH = join(home, 'oauth-fixture.json');
writeFileSync(process.env.ANTHROPIC_OAUTH_CREDENTIALS_PATH, JSON.stringify({
    claudeAiOauth: { accessToken: 'non-secret-fixture', scopes: ['user:inference'], expiresAt: 0 },
}));
after(() => rmSync(home, { recursive: true, force: true }));

const native = path => import(`../engine/node_modules/mixdog/src/${path}`);
const { mergeRecallConceptTokens } = await native('runtime/memory/lib/memory-text-utils.mjs');
const { createNoToolTurnResolver } = await native('runtime/agent/orchestrator/session/loop/no-tool-turn.mjs');
const { planDependencySetup } = await native('runtime/shared/worktrees/dependencies.mjs');

test('mixed Korean recall preserves content words alongside provider names', () => {
    const tokens = mergeRecallConceptTokens('웹 검색 원인 Claude Codex Hermes 비교',
        ['웹', '검색', '원인', 'Claude', 'Codex', 'Hermes', '비교']);
    for (const word of ['검색', '원인', '비교', 'claude', 'codex']) assert.ok(tokens.includes(word), word);
});

test('queued input followed by tools does not erase the earlier agent report', async () => {
    const messages = [{ role: 'user', content: 'first task' }];
    let queued = true;
    const resolver = createNoToolTurnResolver({
        messages, opts: {}, sessionId: 'report-fixture', sessionAgent: 'worker',
        drainSteering(stage, options) {
            if (!queued || stage !== 'terminal') return false;
            options.beforeAppend();
            messages.push({ role: 'user', content: 'follow-up task' });
            queued = false;
            return true;
        },
    });
    assert.equal((await resolver.resolve({ content: 'first verified answer', stopReason: 'end_turn' }, 1)).action, 'continue');
    resolver.noteToolBatchCompleted([{ name: 'shell', id: 'tool-1' }], []);
    const { response } = await resolver.resolve({ content: 'follow-up answer', stopReason: 'end_turn' }, 2);
    assert.equal(response.content, 'follow-up answer');
    assert.equal(response.reportContent, 'first verified answer\n\nfollow-up answer');
    assert.equal(messages.filter(row => row.content === 'first verified answer').length, 1);
});

test('a nested dependency link blocks installs throughout a worktree without touching its target', async () => {
    const project = join(home, 'dependency-project');
    const external = join(home, 'external-dependencies');
    mkdirSync(join(project, 'packages', 'one'), { recursive: true });
    mkdirSync(external);
    writeFileSync(join(external, 'keep'), 'owned by the main checkout');
    writeFileSync(join(project, 'package.json'), JSON.stringify({ private: true, workspaces: ['packages/*'] }));
    writeFileSync(join(project, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: {} }));
    writeFileSync(join(project, 'packages', 'one', 'package.json'), JSON.stringify({ private: true }));
    writeFileSync(join(project, '.gitignore'), 'node_modules\n');
    execFileSync('git', ['init', '-q', project]);
    execFileSync('git', ['-C', project, 'add', 'package.json', 'package-lock.json', 'packages/one/package.json', '.gitignore']);
    symlinkSync(external, join(project, 'packages', 'one', 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const plan = await planDependencySetup({ worktreeDir: project });
    assert.deepEqual(plan.commands, []);
    assert.ok(plan.notes.some(note => note.includes('packages/one/node_modules')));
    assert.equal(readFileSync(join(external, 'keep'), 'utf8'), 'owned by the main checkout');
});

test('an explicitly shared dependency link is never installed through or removed', async () => {
    const project = join(home, 'dependency-project');
    const plan = await planDependencySetup({ worktreeDir: project, shared: ['packages/one/node_modules'] });
    assert.deepEqual(plan.commands, []);
    assert.ok(plan.notes.some(note => note.includes('.worktreeinclude')));
    assert.equal(readFileSync(join(project, 'packages', 'one', 'node_modules', 'keep'), 'utf8'),
        'owned by the main checkout');
});

test('a synchronous progress read failure does not prevent later snapshots', async () => {
    const { createAgentTree } = await native('standalone/session-service/agent-tree.mjs');
    let reads = 0;
    const runtime = {
        isWireSafe: true,
        getTurnLiveness() {
            if (++reads === 1) throw Object.assign(new Error('fixture read failure'), { code: 'EWIRE' });
            return { stage: 'streaming', lastProgressAt: 4242 };
        },
    };
    const { agentManager } = createAgentTree({ sessionOwner: () => ({ runtime }), log() {} });
    assert.equal(agentManager.getSessionProgressSnapshot('worker'), null);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(agentManager.getSessionProgressObservation('worker').lastReadError, 'EWIRE');
    agentManager.getSessionProgressSnapshot('worker');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reads, 2);
    assert.equal(agentManager.getSessionProgressSnapshot('worker').lastProgressAt, 4242);
    assert.equal(agentManager.getSessionProgressObservation('worker').lastReadError, null);
    await new Promise(resolve => setImmediate(resolve));
});

test('checkpoint recovery requires its durable base and never replays a covered turn', async () => {
    const { checkpointDisposition } = await native('runtime/agent/orchestrator/session/manager/turn-checkpoint.mjs');
    const messages = [{ role: 'user', content: 'base' }];
    const checkpoint = { turnToken: 'turn-one', base: { epoch: 'epoch-one', length: 1 }, boundary: 1 };
    assert.deepEqual(checkpointDisposition({ messages, transcriptEpoch: 'epoch-one' }, checkpoint),
        { action: 'replay', boundary: 1 });
    assert.equal(checkpointDisposition({ messages, transcriptEpoch: 'other-epoch' }, checkpoint).action, 'conflict');
    assert.deepEqual(checkpointDisposition({ messages, turnCoverage: 'turn-one' }, checkpoint), { action: 'covered' });
    assert.equal(messages.length, 1);
});

test('a settled save promise alone is not proof that a turn reached disk', async () => {
    const durability = await native('runtime/agent/orchestrator/session/manager/turn-durability.mjs');
    const store = await native('runtime/agent/orchestrator/session/store/transcript-durability.mjs');
    const session = { id: 'durability-fixture', messages: [], transcriptEpoch: 'epoch-one', turnCoverage: 'turn-one' };
    const args = { sessionId: session.id, session, turnToken: 'turn-one', generation: 0 };
    assert.equal(await durability.holdTurnUntilDurable({ ...args, save: Promise.resolve() }), false);
    assert.equal(durability.hasUnsettledTurn(session.id), true);
    store.recordLandedTranscript(session, store.captureTranscriptSnapshot(session), 1);
    assert.equal(await durability.holdTurnUntilDurable({ ...args, save: Promise.resolve() }), true);
    assert.equal(durability.hasUnsettledTurn(session.id), false);
});

test('plugin publication removes its old tree without following external links', async () => {
    const { _publishManagedPluginRoot } = await native('session-runtime/services/plugin-admin.mjs');
    const root = join(home, 'managed-plugin');
    const next = join(home, 'plugin-candidate');
    const external = join(home, 'plugin-external');
    mkdirSync(root);
    mkdirSync(next);
    mkdirSync(external);
    writeFileSync(join(external, 'keep'), 'outside the plugin');
    symlinkSync(external, join(root, 'external'), process.platform === 'win32' ? 'junction' : 'dir');
    writeFileSync(join(next, 'version'), 'new');
    _publishManagedPluginRoot(root, next);
    assert.equal(readFileSync(join(root, 'version'), 'utf8'), 'new');
    assert.equal(readFileSync(join(external, 'keep'), 'utf8'), 'outside the plugin');
});

test('memory spawn locks recover stale empty holders but preserve a live legacy supervisor', async () => {
    const { withFileLock } = await native('runtime/shared/file-lock.mjs');
    const path = join(home, 'pg-spawn.lock');
    writeFileSync(path, '');
    utimesSync(path, new Date(0), new Date(0));
    assert.equal(await withFileLock(path, () => 'recovered', { timeoutMs: 1000 }), 'recovered');
    const legacy = JSON.stringify({ pid: process.pid, startedAt: Date.now() });
    writeFileSync(path, legacy);
    await assert.rejects(withFileLock(path, () => assert.fail('live supervisor lock was reclaimed'), { timeoutMs: 50 }),
        { code: 'ELOCKTIMEOUT' });
    assert.equal(readFileSync(path, 'utf8'), legacy);
});

test('OAuth-only secrets-less initialization preserves the live provider without overriding explicit disable', async () => {
    const { _withRegisteredProviderForTestAsync, getProvider, initProviders } =
        await native('runtime/agent/orchestrator/providers/registry.mjs');
    const live = { name: 'anthropic-oauth' };
    await _withRegisteredProviderForTestAsync('anthropic-oauth', live, async () => {
        await assert.rejects(initProviders({ 'anthropic-oauth': { enabled: false } }), /all providers disabled/);
        await initProviders({ 'anthropic-oauth': { enabled: false, credentialProbeUnavailable: true } });
        assert.equal(getProvider('anthropic-oauth'), live);
    });
});

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EFFORT_USAGE_PATCHES } from '../patches/effort-usage.mjs';
import { patchedAgentSource } from '../scripts/patch-mixdog.mjs';
import { readUsageMetrics } from '../engine/src/usage.mjs';

// 설치된 엔진을 건드리지 않고 동일한 의존성의 격리 복사본에 검토된 패치만 적용한다.
const candidate = await mkdtemp('/data/tmp/ubuntu/paseodog-usage-test-');
after(() => rm(candidate, { recursive: true, force: true }));
const upstream = fileURLToPath(new URL('../engine/node_modules/mixdog/', import.meta.url));
await cp(join(upstream, 'src'), join(candidate, 'src'), { recursive: true });
await cp(join(upstream, 'package.json'), join(candidate, 'package.json'));
await symlink(fileURLToPath(new URL('../engine/node_modules', import.meta.url)), join(candidate, 'node_modules'), 'dir');
for (const spec of EFFORT_USAGE_PATCHES) {
    const path = join(candidate, spec.file);
    const source = await readFile(path, 'utf8');
    const patched = patchedAgentSource(source, spec);
    assert.equal(patchedAgentSource(patched, spec), patched);
    assert.throws(() => patchedAgentSource(source + '\n// drift', spec), /source hash mismatch/);
    await writeFile(path, patched);
}
const load = path => import(pathToFileURL(join(candidate, 'src', path)).href);
const { UsageLedger, makeUsageRecord, closeUsageLedgers } = await load('runtime/shared/llm/usage-ledger.mjs');
const { withUsageContext } = await load('runtime/shared/llm/usage-context.mjs');
const { projectEffortConfiguration } = await load('runtime/agent/orchestrator/providers/effort-configuration.mjs');
const { accountProviderSend } = await load('runtime/shared/llm/usage-accounting.mjs');
const { createUsageStatsApi } = await load('session-runtime/usage-stats-api.mjs');

test('fast on, off and unrecorded remain separate with duration-weighted measured speeds', async () => {
    const ledger = new UsageLedger(':memory:');
    try {
        const ts = Date.now();
        const common = { ts, provider: 'openai', model: 'test', agent: 'worker', effort: 'high', inputTokens: 10 };
        ledger.record([
            makeUsageRecord({ ...common, id: 'on-a', fast: true, outputTokens: 100, durationMs: 1000 }),
            makeUsageRecord({ ...common, id: 'on-b', fast: true, outputTokens: 300, durationMs: 9000 }),
            makeUsageRecord({ ...common, id: 'on-untimed', fast: true, outputTokens: 9000 }),
            makeUsageRecord({ ...common, id: 'on-empty', fast: true, outputTokens: 0, durationMs: 10000 }),
            makeUsageRecord({ ...common, id: 'off', fast: false, outputTokens: 60, durationMs: 3000 }),
            makeUsageRecord({ ...common, id: 'old', outputTokens: 100 }),
            makeUsageRecord({ ...common, id: 'low', fast: true, effort: 'low', outputTokens: 50, durationMs: 500 }),
            makeUsageRecord({ ...common, id: 'model', model: 'other', fast: true, outputTokens: 25, durationMs: 500 }),
        ]);
        const api = createUsageStatsApi({ ledger: () => ledger });
        const groups = await api.getEffortUsageStats({ fromMs: ts, toMs: ts });
        assert.equal(groups.length, 5);
        const high = groups.filter(row => row.model === 'test' && row.effort === 'high');
        assert.equal(high.find(row => row.fast === true).outputTokensPerSecond, 40);
        assert.equal(high.find(row => row.fast === true).output, 9400);
        assert.equal(high.find(row => row.fast === false).outputTokensPerSecond, 20);
        assert.equal(high.find(row => row.fast === null).outputTokensPerSecond, null);
        const result = await readUsageMetrics({
            getUsageStats: async () => ({ range: { fromMs: ts, toMs: ts }, totals: {}, providers: [], daily: [] }),
            getUsageDashboard: async () => ({ rows: [] }),
            getEffortUsageStats: api.getEffortUsageStats,
        });
        // 535 measured output tokens / 14 seconds, not an average of group rates.
        assert.equal(result.totals.outputTokensPerSecond, 38.2);
        assert.equal(result.efforts.reduce((sum, row) => sum + row.turns, 0), 8);
        assert.doesNotMatch(JSON.stringify(result), /speedOutput|speedMs/);
    } finally { ledger.close(); }
});

test('effort groups preserve recorded amounts, deduplication and unknown historical attribution', async () => {
    const ledger = new UsageLedger(':memory:');
    try {
        const ts = Date.now();
        const common = { ts, provider: 'openai', model: 'test', sourceType: 'lead', inputTokens: 10, outputTokens: 2, costUsd: 1 };
        const rows = [
            makeUsageRecord({ ...common, id: 'legacy' }),
            makeUsageRecord({ ...common, id: 'low', agent: 'worker', effort: 'low' }),
            makeUsageRecord({ ...common, id: 'high', agent: 'worker', effort: 'high', inputTokens: 20 }),
        ];
        assert.equal(ledger.record(rows), 3);
        assert.equal(ledger.record(rows), 0);
        const api = createUsageStatsApi({ ledger: () => ledger });
        const groups = await api.getEffortUsageStats({ fromMs: 0, toMs: ts + 1 });
        assert.equal(groups.length, 3);
        assert.equal(groups.reduce((n, row) => n + row.turns, 0), 3);
        assert.equal(groups.reduce((n, row) => n + row.tokens, 0), 46);
        assert.equal(groups.reduce((n, row) => n + row.costUsd, 0), 3);
        assert.equal(groups.find((row) => row.effort === null).agent, null);
        assert.equal(groups.find((row) => row.effort === 'high').tokens, 22);
        assert.equal(ledger.db.prepare('SELECT COUNT(*) AS n FROM usage_events').get().n, 3);
    } finally { ledger.close(); }
});

test('request projection records the applied step effort, not the route base or the previous request', () => {
    const session = {};
    const identity = { session };
    const snapshot = { version: 1, provider: 'openai', model: 'gpt-6', mode: 'responses', initialEffort: 'high', effort: 'low' };
    withUsageContext(identity, () => {
        const projection = projectEffortConfiguration([
            { role: 'user', content: 'work', meta: { effortConfiguration: snapshot } },
        ], 'openai', 'gpt-6', { effort: 'high', effortConfiguration: snapshot });
        assert.equal(projection.effort, 'low');
        assert.equal(identity.requestEffort, 'low');
        assert.equal(session.paseodogRequestEffort.effort, 'low');
        projectEffortConfiguration([], 'openai', 'gpt-6', { effort: 'high', effortConfigurationEnabled: false });
        assert.equal(identity.requestEffort, 'high');
    });
});

test('real accounting and worker reads retain effort and agent without prompts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'paseodog-effort-'));
    const before = process.env.MIXDOG_USAGE_LEDGER_PATH;
    const path = join(directory, 'ledger.sqlite');
    process.env.MIXDOG_USAGE_LEDGER_PATH = path;
    try {
        await accountProviderSend('openai', {}, async () => ({
            model: 'test', responseId: 'one', usage: { inputTokens: 5, outputTokens: 3, costUsd: 0.25 },
        }), 'test', { effort: 'medium', fast: true, session: { id: 'child', agent: 'worker', ownerSessionId: 'parent', sourceType: 'agent' } });
        const ledger = new UsageLedger(path);
        try {
            const groups = await ledger.effortUsageAsync({ fromMs: 0, toMs: Date.now() });
            assert.equal(groups.length, 1);
            assert.equal(groups[0].agent, 'worker');
            assert.equal(groups[0].effort, 'medium');
            assert.equal(groups[0].fast, true);
            assert.equal(groups[0].turns, 1);
            assert.equal(groups[0].input + groups[0].output, 8);
            assert.doesNotMatch(JSON.stringify(groups), /child|parent/);
        } finally { ledger.close(); }
    } finally {
        closeUsageLedgers();
        if (before === undefined) delete process.env.MIXDOG_USAGE_LEDGER_PATH;
        else process.env.MIXDOG_USAGE_LEDGER_PATH = before;
        await rm(directory, { recursive: true, force: true });
    }
});

test('metrics project effort groups without private native metadata', async () => {
    const result = await readUsageMetrics({
        getUsageStats: async () => ({ range: { fromMs: 1, toMs: 2 }, totals: {}, providers: [], daily: [] }),
        getUsageDashboard: async () => ({ rows: [] }),
        getEffortUsageStats: async (range) => {
            assert.deepEqual(range, { fromMs: 1, toMs: 2 });
            return [{ provider: 'openai', model: 'test', agent: 'worker', effort: 'low', turns: 1, tokens: 10, sessionId: 'private-session', secret: 'private-token' }];
        },
    });
    assert.deepEqual(result.efforts, [{ provider: 'openai', model: 'test', agent: 'worker', effort: 'low', fast: null, turns: 1, tokens: 10 }]);
    assert.doesNotMatch(JSON.stringify(result), /private/);
});

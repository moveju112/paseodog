import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageLedger, makeUsageRecord, closeUsageLedgers } from '../engine/node_modules/mixdog/src/runtime/shared/llm/usage-ledger.mjs';
import { withUsageContext } from '../engine/node_modules/mixdog/src/runtime/shared/llm/usage-context.mjs';
import { projectEffortConfiguration } from '../engine/node_modules/mixdog/src/runtime/agent/orchestrator/providers/effort-configuration.mjs';
import { accountProviderSend } from '../engine/node_modules/mixdog/src/runtime/shared/llm/usage-accounting.mjs';
import { createUsageStatsApi } from '../engine/node_modules/mixdog/src/session-runtime/usage-stats-api.mjs';
import { readUsageMetrics } from '../engine/src/usage.mjs';

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
        }), 'test', { effort: 'medium', session: { id: 'child', agent: 'worker', ownerSessionId: 'parent', sourceType: 'agent' } });
        const ledger = new UsageLedger(path);
        try {
            const groups = await ledger.effortUsageAsync({ fromMs: 0, toMs: Date.now() });
            assert.equal(groups.length, 1);
            assert.equal(groups[0].agent, 'worker');
            assert.equal(groups[0].effort, 'medium');
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
    assert.deepEqual(result.efforts, [{ provider: 'openai', model: 'test', agent: 'worker', effort: 'low', turns: 1, tokens: 10 }]);
    assert.doesNotMatch(JSON.stringify(result), /private/);
});

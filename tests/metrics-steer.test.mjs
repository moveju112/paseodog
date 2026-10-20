import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readUsageMetrics } from '../engine/src/usage.mjs';
import { patchedSteerSource, patchPaseoSteer } from '../scripts/patch-paseo-steer.mjs';

const path = new URL('../tools/node_modules/@getpaseo/server/', import.meta.url);
const source = readFileSync(new URL('dist/server/server/agent/plugin-provider.js', path), 'utf8');

// 설치한 Paseo의 실제 admission 메서드를 외부 전송만 대체해 실행한다.
function steering() {
    const method = source.slice(source.indexOf('    async steerActiveTurn(prompt, options) {'),
        source.indexOf('    subscribe(callback) {', source.indexOf('    async steerActiveTurn(prompt, options) {')));
    return new Function('mapPromptContent', 'toJsonValue', 'providerError', `return ({${method}}).steerActiveTurn;`)(
        (prompt) => prompt, (value) => value, (error) => new Error(error.message));
}

test('audited Paseo steering patch is installed, idempotent and refuses drift', () => {
    patchPaseoSteer(path.pathname, { check: true });
    assert.equal(patchedSteerSource(source), source);
    assert.throws(() => patchedSteerSource(source + '// drift'), /hash mismatch/);
});

test('unsupported steering falls back without transmitting or clearing approvals in every mode', async () => {
    for (const mode of ['bypass', 'ask', 'review']) {
        const bridge = {
            negotiatedCapabilities: ['prompt.message'], config: { mode },
            prompt() { throw new Error('Unsupported prompt must not be transmitted'); },
        };
        const result = await steering().call({ bridge }, 'next instruction', {
            expectedTurnId: 'turn-1', clientMessageId: 'message-1', clearPendingPermissions: true,
        });
        assert.deepEqual(result, { status: 'unavailable' });
    }
});

test('supported steering retains exact turn ownership and message identity', async () => {
    const calls = [];
    const bridge = {
        negotiatedCapabilities: ['prompt.message', 'prompt.steer'],
        async prompt(input) { calls.push(input); return { type: 'steer', turnId: 'turn-1' }; },
    };
    const options = { expectedTurnId: 'turn-1', clientMessageId: 'message-1', clearPendingPermissions: false };
    assert.deepEqual(await steering().call({ bridge }, 'next', options), { status: 'accepted' });
    assert.equal(calls[0].clientMessageId, 'message-1');
    assert.equal(calls[0].delivery, 'steer');
    assert.equal(calls[0].clearPendingPermissions, false);
    assert.deepEqual(await steering().call({ bridge }, 'next', { ...options, expectedTurnId: 'turn-2' }),
        { status: 'unavailable' });
});

test('unsupported PaseoDog steering cannot trigger active-turn replacement', async () => {
    const bridge = {
        negotiatedCapabilities: ['prompt.message'],
        prompt() { throw new Error('must not transmit'); },
    };
    await assert.rejects(steering().call({ provider: 'paseodog', bridge }, 'additional instruction', {
        expectedTurnId: 'turn-1', clientMessageId: 'message-1',
    }), /Queue this message instead; the active turn was not interrupted/);
});

test('failed steering is surfaced rather than reported unavailable and replaced', async () => {
    const bridge = {
        negotiatedCapabilities: ['prompt.message', 'prompt.steer'],
        async prompt() { return { type: 'failed', error: { message: 'Admission uncertain' } }; },
    };
    await assert.rejects(steering().call({ provider: 'paseodog', bridge }, 'B', {
        expectedTurnId: 'A', clientMessageId: 'B',
    }), /Admission uncertain/);
});

test('metrics reuse native statistics and quota APIs while excluding private fields', async () => {
    const calls = [];
    const runtime = {
        async getUsageStats(input) {
            calls.push(input);
            return {
                generatedAt: 123, range: { fromMs: 1, toMs: 2, private: 'hidden' },
                totals: { tokens: 100, costBilled: 0, costEstimated: 3, secret: 'hidden' },
                providers: [{ provider: 'openai-oauth', providerKind: 'oauth', tokens: 100,
                    models: [{ model: 'gpt-test', tokens: 100, cacheHitRate: null, secret: 'hidden' }] }],
                hourly: [{ label: '12:00', tokens: 100, secret: 'hidden' }],
            };
        },
        async getUsageDashboard(input) {
            calls.push(input);
            return { rows: [{ id: 'openai-oauth', group: 'oauth', label: 'Codex', authenticated: true,
                windows: [{ label: '7D', usedPct: 65, resetAt: 1000, secret: 'hidden' }],
                resetCredits: { availableCount: 3, offerRevision: 'hidden' }, config: { secret: 'hidden' } }] };
        },
    };
    const result = await readUsageMetrics(runtime, { view: 'custom', startDay: '2026-10-18', endDay: '2026-10-19', refresh: true });
    assert.deepEqual(calls, [
        { view: 'custom', modelLimit: 50, source: 'all', startDay: '2026-10-18', endDay: '2026-10-19' },
        { refresh: true, refreshSetup: false },
    ]);
    assert.equal(result.totals.tokens, 100);
    assert.equal(result.providers[0].models[0].cacheHitRate, null);
    assert.equal(result.series[0].label, '12:00');
    assert.deepEqual(result.quotas[0].resetCredits, { availableCount: 3 });
    assert.doesNotMatch(JSON.stringify(result), /hidden|offerRevision|config|secret/);
    await assert.rejects(readUsageMetrics(runtime, { view: 'invalid' }), /Invalid usage period/);
});

// 명시한 두 OAuth 제공자만 표시하고 새 제공자나 다른 인증 방식도 노출하지 않는다.
test('OAuth usage exposes only Claude and Codex, including disconnected accounts', async () => {
    const ids = ['openai-oauth', 'anthropic-oauth', 'grok-oauth', 'muse-code-oauth', 'cursor-oauth', 'unknown-oauth'];
    const rows = ids.map((id) => ({ id, group: 'oauth', label: id, authenticated: false, windows: [] }));
    rows.push({ id: 'openai-oauth', group: 'api', label: 'API', authenticated: false, windows: [] });
    const result = await readUsageMetrics({
        async getUsageStats() { return { range: { fromMs: 1, toMs: 2 }, totals: {}, providers: [], daily: [] }; },
        async getUsageDashboard() { return { rows }; },
    });
    assert.deepEqual(result.quotas.map(({ id, label, authenticated }) => ({ id, label, authenticated })), [
        { id: 'openai-oauth', label: 'Codex', authenticated: false },
        { id: 'anthropic-oauth', label: 'Claude', authenticated: false },
    ]);
    assert.equal(rows.length, 7);
});

test('quota failure preserves token and effort metrics without exposing native error details', async () => {
    const result = await readUsageMetrics({
        async getUsageStats() {
            return { range: { fromMs: 1, toMs: 2 }, totals: { tokens: 42 },
                providers: [], daily: [] };
        },
        async getUsageDashboard() { throw new Error('secret-account-path'); },
        async getEffortUsageStats() { return [{ provider: 'openai', model: 'test', effort: 'medium', turns: 1 }]; },
    });
    assert.equal(result.totals.tokens, 42);
    assert.equal(result.efforts[0].effort, 'medium');
    assert.deepEqual(result.quotas, []);
    assert.match(result.quotaError, /OAuth 할당량/);
    assert.doesNotMatch(JSON.stringify(result), /secret-account-path/);
});

test('token statistics failures remain failures, never fabricated empty totals', async () => {
    await assert.rejects(readUsageMetrics({
        async getUsageStats() { throw new Error('ledger unavailable'); },
        async getUsageDashboard() { return { rows: [] }; },
    }), /ledger unavailable/);
});

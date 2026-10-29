import test from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveAgentWatchdogPolicy, evaluateAgentWatchdogAbort, AgentStallAbortError,
} from '../engine/node_modules/mixdog/src/runtime/agent/orchestrator/agent-runtime/agent-progress-watchdog.mjs';
import {
    adoptSessionCompaction,
} from '../engine/node_modules/mixdog/src/session-runtime/session-compaction-sync.mjs';
import {
    withLiveCompactionConfig,
} from '../engine/node_modules/mixdog/src/runtime/agent/orchestrator/runtime-core/compaction-config-keys.mjs';
import {
    executionFallbacks, routeChain, validateRouteChainProviders,
} from '../engine/node_modules/mixdog/src/runtime/shared/model-route-chain.mjs';
import {
    cacheWarmingEnabled,
} from '../engine/node_modules/mixdog/src/runtime/agent/orchestrator/session/cache-warm.mjs';

test('global cache warming stays disabled even when a saved profile opts in', () => {
    for (const config of [undefined, {}, { promptCacheWarming: true }, { promptCacheWarming: false }])
        assert.equal(cacheWarmingEnabled(config), false);
});

// 공급자가 복구할 수 있는 시간보다 watchdog이 먼저 턴을 취소하면 안 된다.
test('custom Responses first-output budgets precede terminal watchdog cancellation', () => {
    const providerFirstByteTimeoutMs = 180000;
    const providerFirstOutputTimeoutMs = 900000;
    const policy = resolveAgentWatchdogPolicy('worker', {
        firstTransportTimeoutMs: 1000, firstSemanticTimeoutMs: 1000,
        providerFirstByteTimeoutMs, providerFirstOutputTimeoutMs,
    });
    assert.ok(policy.firstTransportMs > providerFirstByteTimeoutMs);
    assert.ok(policy.firstSemanticMs > providerFirstOutputTimeoutMs);
    const snapshot = {
        modelRequestStartedAt: 1, waitingForTransport: false, waitingForFirstSemantic: true,
    };
    assert.equal(evaluateAgentWatchdogAbort(snapshot, providerFirstOutputTimeoutMs + 1, policy), null);
    assert.ok(evaluateAgentWatchdogAbort(snapshot, policy.firstSemanticMs + 2, policy) instanceof AgentStallAbortError);
    assert.equal(evaluateAgentWatchdogAbort({ ...snapshot, awaitingUser: true },
        policy.firstSemanticMs * 2, policy), null);
});

test('Anthropic keepalives protect long generation but never keep a wedged stream alive forever', () => {
    const policy = resolveAgentWatchdogPolicy('worker', { idleTimeoutMs: 1000 });
    const snapshot = { lastProgressAt: 100, lastKeepaliveAt: 2000 };
    assert.equal(evaluateAgentWatchdogAbort(snapshot, 2100, policy), null);
    assert.ok(evaluateAgentWatchdogAbort(snapshot, 3101, policy) instanceof AgentStallAbortError);
    assert.ok(evaluateAgentWatchdogAbort({ lastProgressAt: 100 }, 2100, policy) instanceof AgentStallAbortError);
});

test('compaction removes obsolete summary routes and preserves live config across an in-flight commit', () => {
    const session = { compaction: { summaryModel: 'old/summary', mainBufferTokens: 32000,
        auto: true, lastCompactedAt: 10 } };
    adoptSessionCompaction(session, { auto: false, mainBufferRatio: 0.2 });
    assert.deepEqual(session.compaction, { auto: false, mainBufferRatio: 0.2, lastCompactedAt: 10 });
    const committed = withLiveCompactionConfig(session.compaction, {
        auto: true, summaryModel: 'old/summary', mainBufferTokens: 32000, lastCompactedAt: 20,
    });
    assert.equal(committed.auto, false);
    assert.equal(committed.mainBufferRatio, 0.2);
    assert.equal(Object.hasOwn(committed, 'summaryModel'), false);
    assert.equal(Object.hasOwn(committed, 'mainBufferTokens'), false);
    assert.equal(committed.lastCompactedAt, 20);
});

test('switching to a stored fallback provider skips duplicates without losing the saved chain', () => {
    const route = { provider: 'anthropic', model: 'main', fallbacks: [
        { provider: 'anthropic-api', model: 'saved' },
        { provider: 'openai', model: 'alternate' },
    ] };
    const saved = structuredClone(route);
    validateRouteChainProviders(routeChain(route), { allowDuplicates: true });
    assert.deepEqual(executionFallbacks(route), [route.fallbacks[1]]);
    assert.deepEqual(route, saved);
    assert.throws(() => validateRouteChainProviders(routeChain(route)), /duplicate route provider/);
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { attachHostPolicy, mapMcpServers } from './policy.mjs';
import { patch } from '../../scripts/patch-mixdog.mjs';
import { createOrchestrationBridge } from './orchestration.mjs';
import { createAuthSession } from './auth-session.mjs';

export async function loadNativeModules() {
    const runtimeUrl = import.meta.resolve('mixdog/src/mixdog-session-runtime.mjs');
    const root = resolve(dirname(fileURLToPath(runtimeUrl)), '..');
    patch(root, { check: true });
    const [{ createMixdogSessionRuntime }, cfg, pending] = await Promise.all([
        import(runtimeUrl), import('mixdog/src/runtime/agent/orchestrator/config.mjs'),
        import('mixdog/src/runtime/agent/orchestrator/session/manager/pending-messages.mjs'),
    ]);
    if (typeof createMixdogSessionRuntime !== 'function' || typeof cfg.loadConfig !== 'function') throw new Error('Mixdog native API mismatch');
    return { createMixdogSessionRuntime, loadConfig: () => cfg.loadConfig({ secrets: true }),
        pendingMessages: async (id) => {
            await pending.settlePendingMessageWrites({ throwOnTimeout: true });
            return pending._getPendingMessagesForSession(id);
        }, root };
}
export async function createNativeEngine(args, { modules, emit = () => {} } = {}) {
    const native = modules || await loadNativeModules();
    const baseConfig = await native.loadConfig();
    const config = args.config;
    const route = args.route || {};
    const orchestration = createOrchestrationBridge({ config, pendingMessages: native.pendingMessages });
    // Only the explicitly supplied MCP servers are visible in this host. Do not
    // inherit hidden servers from another app profile. Auth/model settings stay local.
    // Keep engine features native, but never auto-stage an unreviewed engine upgrade.
    const initialConfig = { ...baseConfig, mcpServers: mapMcpServers(config.mcpServers),
        update: { ...baseConfig.update, auto: false } };
    // 명시적으로 켠 Paseo Worker만 부모 모델을 사용하며 다른 모델로 폴백하지 않는다.
    if (process.env.PASEODOG_TEST_PARENT_WORKER === 'true') {
        if (!route.provider || !route.model) throw new Error('Paseo Worker requires an explicit parent model route');
        initialConfig.disabledAgents = (baseConfig.disabledAgents || []).filter((id) => id !== 'worker');
        initialConfig.agents = { ...baseConfig.agents, worker: {
            ...baseConfig.agents?.worker, provider: route.provider, model: route.model,
            effort: route.effort || 'low', fast: false, autoEffort: false, fallbacks: [],
        } };
    }
    const runtime = await native.createMixdogSessionRuntime({
        cwd: config.cwd, provider: route.provider, model: route.model,
        fast: route.fast, autoEffort: route.autoEffort,
        effort: route.effort, toolMode: config.mode === 'review' ? 'readonly' : 'full',
        approvalMode: null, disallowDelegation: false, autoWakeCompletions: false,
        agentSessionSurface: orchestration.surface,
        initialConfig,
    });
    for (const name of ['ask', 'abort', 'close', 'resume', 'compact']) {
        if (typeof runtime[name] !== 'function') {
            await runtime.close?.('paseodog-contract-failure');
            throw new Error(`Mixdog runtime missing ${name}`);
        }
    }
    let closed = false;
    const authentication = createAuthSession(runtime);
    try {
        if (args.nativeSessionId) {
            const resumed = await runtime.resume(args.nativeSessionId);
            if (runtime.session?.remoteAttached === true) throw new Error('Native session is owned by another live Mixdog process; close that writer before attaching');
            if (!resumed || resumed.id !== args.nativeSessionId) throw new Error('Native session not found; refusing a blank replacement');
            if (resolve(resumed.cwd) !== resolve(config.cwd)) throw new Error('Native session cwd differs from Paseo workspace');
            // A journal/session-file mismatch must fail BEFORE any model inference.
            // Effort may change independently through Mixdog automatic reasoning, so do not pin it.
            for (const field of ['provider', 'model']) {
                if (route[field] !== undefined && resumed[field] !== route[field]) {
                    throw new Error(`Native session ${field} differs from the saved model route`);
                }
            }
        }
    } catch (error) { await runtime.close('paseodog-resume-failed'); throw error; }
    return {
        get id() { return runtime.id || ''; },
        // 턴 시작 전 최신 프로필 설정(오케스트레이션·워크플로우·압축·자동정리)을 열린 세션에 반영한다.
        async ask(text, callbacks) {
            if (closed) throw new Error('Native engine closed');
            if (runtime.session?.remoteAttached === true) throw new Error('Refusing to forward work to an unmanaged native writer');
            try {
                const latest = await native.loadConfig?.();
                if (latest && typeof latest === 'object') {
                    if (typeof latest.orchestrationMode === 'string' && typeof runtime.setOrchestrationMode === 'function'
                        && runtime.orchestrationMode !== latest.orchestrationMode) {
                        await runtime.setOrchestrationMode(latest.orchestrationMode);
                    }
                    if (typeof latest.workflow === 'string' && typeof runtime.setWorkflow === 'function'
                        && runtime.workflow?.id !== latest.workflow) {
                        await runtime.setWorkflow(latest.workflow);
                    }
                    if (latest.compaction && typeof latest.compaction === 'object' && typeof runtime.setCompactionSettings === 'function') {
                        await runtime.setCompactionSettings(latest.compaction);
                    }
                    if (latest.autoClear && typeof latest.autoClear === 'object' && typeof runtime.setAutoClear === 'function') {
                        await runtime.setAutoClear(latest.autoClear);
                    }
                    if (typeof latest.outputStyle === 'string' && typeof runtime.setOutputStyle === 'function') {
                        await runtime.setOutputStyle(latest.outputStyle);
                    }
                    if (latest.profile && typeof latest.profile === 'object' && typeof runtime.setProfile === 'function') {
                        await runtime.setProfile(latest.profile);
                    }
                    if (typeof latest.recap === 'boolean' && typeof runtime.setRecapEnabled === 'function') {
                        await runtime.setRecapEnabled(latest.recap);
                    }
                }
            } catch {}
            orchestration.begin(callbacks);
            const options = {
                ...callbacks,
                hostManagedCompletions: true,
                beforeSessionAsk(session) {
                    orchestration.bind(session);
                    attachHostPolicy(session, { mode: config.mode || 'ask', systemPrompt: config.systemPrompt || '',
                        orchestration: true,
                        onIdentity: (id, state) => callbacks.onIdentity?.({ id, state }) });
                },
            };
            try {
                const result = await runtime.ask(text, options);
                return await orchestration.drainLead(
                    () => runtime.ask('', { ...options, continueTurn: true }), result);
            } catch (error) {
                await orchestration.abort('paseodog-turn-failed');
                throw error;
            } finally { orchestration.finish(); }
        },
        async compact() {
            const counters = () => {
                const session = runtime.session || {};
                return { deltaInput: Number(session.totalInputTokens) || 0,
                    deltaOutput: Number(session.totalOutputTokens) || 0,
                    deltaCachedRead: Number(session.totalCachedReadTokens) || 0,
                    deltaCacheWrite: Number(session.totalCacheWriteTokens) || 0 };
            };
            const before = counters();
            const result = await runtime.compact({ requireReduction: true });
            const after = counters();
            const usageDelta = Object.fromEntries(Object.keys(before).map((key) =>
                [key, Math.max(0, after[key] - before[key])]));
            return { ...result, usageDelta };
        },
        auth(request) { return authentication.request(request); },
        // 대화 원문 없이 압축 설정·컨텍스트 수치·소유 하위 작업 상태만 반환한다.
        async status() {
            const context = await runtime.contextStatus();
            const workflow = runtime.workflow?.currentSession || runtime.workflow;
            return {
                provider: runtime.provider, model: runtime.model, effort: runtime.effort,
                workflow: workflow ? { id: workflow.id, name: workflow.name } : null,
                orchestration: runtime.orchestrationMode,
                compaction: { auto: runtime.getCompactionSettings().auto },
                context: Object.fromEntries(Object.entries(context || {})
                    .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))),
                jobs: orchestration.status(),
            };
        },
        async abort(reason) {
            try { await orchestration.abort(reason); } finally { await runtime.abort(reason); }
        },
        async close(reason) {
            if (closed) return;
            closed = true;
            await authentication.close();
            try { await orchestration.abort(reason); } finally { await runtime.close(reason); }
        },
    };
}

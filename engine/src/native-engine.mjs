import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { attachHostPolicy, mapMcpServers } from './policy.mjs';
import { patch } from '../../scripts/patch-mixdog.mjs';
import { createOrchestrationBridge } from './orchestration.mjs';
import { normalizeOrchestrationMode } from './orchestration-mode.mjs';
import { createAuthSession } from './auth-session.mjs';
import { agentMessageSource, agentMessageContent, pendingAgentMessage } from '../../plugin/server/agent-message.mjs';
import { nativeSessionAction } from './session-actions.mjs';
import { migrateCompactionBuffer } from './compaction-buffer.mjs';
import { compactBeforeModelSwitch } from './model-switch.mjs';
import { turnFailureRecord } from 'mixdog/src/runtime/agent/orchestrator/session/turn-failure.mjs';
import { RETRY_CONTINUE_INSTRUCTION } from 'mixdog/src/tui/session/quota-resume.mjs';

export async function loadNativeModules() {
    const runtimeUrl = import.meta.resolve('mixdog/src/mixdog-session-runtime.mjs');
    const root = resolve(dirname(fileURLToPath(runtimeUrl)), '..');
    patch(root, { check: true });
    const [{ createMixdogSessionRuntime }, cfg, pending, autoEffort, effortConfiguration, registry] = await Promise.all([
        import(runtimeUrl), import('mixdog/src/runtime/agent/orchestrator/config.mjs'),
        import('mixdog/src/runtime/agent/orchestrator/session/manager/pending-messages.mjs'),
        import('mixdog/src/runtime/agent/orchestrator/session/manager/ask-turn-auto-effort.mjs'),
        import('mixdog/src/runtime/agent/orchestrator/providers/effort-configuration.mjs'),
        import('mixdog/src/runtime/agent/orchestrator/providers/registry.mjs'),
    ]);
    if (typeof createMixdogSessionRuntime !== 'function' || typeof cfg.loadConfig !== 'function') throw new Error('Mixdog native API mismatch');
    return { createMixdogSessionRuntime, loadConfig: () => cfg.loadConfig({ secrets: true }),
        // 네이티브의 모듈 활성화·플랫폼 지원과 현재 모델의 실제 노력도 변경 경로를 함께 확인한다.
        autoEffortAvailable(session) {
            return autoEffort.autoEffortMode() === 'on'
                && Boolean(effortConfiguration.turnEffortConfigurationMode(session, registry.getProvider(session.provider)));
        },
        // 네이티브의 영속 지시 큐를 사용하며 같은 ask 안에서 A와 B를 함께 처리한다.
        async steerSession(sessionId, content, source) {
            const depth = pending.enqueuePendingMessage(sessionId, pendingAgentMessage(content, source));
            if (!depth) throw new Error('Native steering was not accepted');
            await pending.settlePendingMessageWrites({ throwOnTimeout: true });
            return { accepted: true };
        },
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
    // 호스트가 명시한 MCP만 시작하며 저장된 서버는 사용자 연결 작업으로만 활성화한다.
    // Keep engine features native, but never auto-stage an unreviewed engine upgrade.
    const initialConfig = { ...baseConfig, orchestrationMode: normalizeOrchestrationMode(baseConfig.orchestrationMode),
        mcpServers: mapMcpServers(config.mcpServers),
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
        contextPercent: route.contextPercent, contextTokens: route.contextTokens,
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
    let configurationGeneration = 0;
    let quotaFailure = null;
    let currentEffortOptions = args.effortOptions;
    const effortSettings = { ...config.settings };
    if (config.thinkingOption) effortSettings.effort = config.thinkingOption;
    // 첫 턴 전 지연 생성 상태에서도 데몬이 조회한 현재 모델 카탈로그로 검증한다.
    function effortOptions() {
        return currentEffortOptions ?? runtime.effortOptions ?? [];
    }
    // 다음 턴 선호값과 네이티브의 현재 세션 값을 구분해 읽는다.
    function configuration() {
        return { autoEffort: effortSettings.autoEffort ?? (runtime.session
            ? runtime.session.autoEffort !== false : runtime.autoEffort !== false),
        autoEffortAvailable: effortOptions().length > 0
            && native.autoEffortAvailable?.(runtime.session || {
                provider: runtime.provider, model: runtime.model, modelParameters: runtime.modelParameters,
            }) === true,
        effort: effortSettings.effort ?? runtime.session?.effort ?? runtime.effort };
    }
    // 같은 세션에 실제로 적용된 모델 경로만 반환한다.
    function sessionRoute() {
        return {
        provider: runtime.session?.provider ?? runtime.provider,
        model: runtime.session?.model ?? runtime.model,
        fast: runtime.session?.fast ?? runtime.fast,
        contextPercent: runtime.session?.contextPercent ?? runtime.contextPercent,
        contextTokens: runtime.session?.contextTokens ?? runtime.contextTokens,
        };
    }
    let steeringOwner = null;
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
        configuration,
        // 턴 시작 전 최신 프로필 설정(오케스트레이션·워크플로우·압축·자동정리)을 열린 세션에 반영한다.
        async ask(text, callbacks, provenance, quotaRetry = false) {
            const source = agentMessageSource(provenance);
            if (closed) throw new Error('Native engine closed');
            if (steeringOwner) throw new Error('Native engine busy');
            if (runtime.session?.remoteAttached === true) throw new Error('Refusing to forward work to an unmanaged native writer');
            if (quotaRetry && !quotaFailure) throw new Error('확인된 quota 실패가 없어요. 자동 재전송하지 않습니다.');
            if (quotaRetry) text = RETRY_CONTINUE_INSTRUCTION;
            quotaFailure = null;
            const owner = { sessionId: runtime.id || null };
            steeringOwner = owner;
            let nextOrchestrationMode = normalizeOrchestrationMode(runtime.orchestrationMode);
            try {
                const latest = await native.loadConfig?.();
                if (latest && typeof latest === 'object') {
                    const orchestrationMode = normalizeOrchestrationMode(latest.orchestrationMode);
                    if (typeof orchestrationMode === 'string' && typeof runtime.setOrchestrationMode === 'function'
                        && (runtime.orchestrationMode !== orchestrationMode || latest.orchestrationMode !== orchestrationMode)) {
                        await runtime.setOrchestrationMode(orchestrationMode);
                    }
                    if (typeof orchestrationMode === 'string') nextOrchestrationMode = orchestrationMode;
                    const workflowId = typeof latest.workflow === 'string' ? latest.workflow : latest.workflow?.active;
                    if (workflowId && typeof runtime.setWorkflow === 'function') {
                        // Refresh the native prompt even when the selected ID is unchanged.
                        // Editing WORKFLOW.md or resuming an old conversation must not keep old rules.
                        const applied = await runtime.setWorkflow(workflowId, { persist: false });
                        if (applied?.appliedToCurrentSession === false)
                            throw new Error(`Workflow instructions could not be applied: ${applied.reason || 'unknown reason'}`);
                    }
                    if (latest.compaction && typeof latest.compaction === 'object' && typeof runtime.setCompactionSettings === 'function') {
                        await runtime.setCompactionSettings(migrateCompactionBuffer(latest.compaction));
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
            } catch (error) {
                if (steeringOwner === owner) steeringOwner = null;
                throw new Error('Unable to refresh engine settings before turn', { cause: error });
            }
            orchestration.begin(callbacks);
            const options = {
                ...callbacks,
                id: randomUUID(),
                transcriptMeta: {},
                hostManagedCompletions: true,
                hostSteering: true,
                ...(source ? { promptSource: 'task-notification',
                    transcriptMeta: { sender: 'agent', agentId: source.agentId } } : {}),
                beforeSessionAsk(session) {
                    owner.sessionId = session.id;
                    // 호스트 기본 경로는 쓰지 않고 실제 추론 직전 이 세션의 선호값만 적용한다.
                    if (Object.hasOwn(effortSettings, 'autoEffort')) {
                        if (effortSettings.autoEffort === false) session.autoEffort = false;
                        else delete session.autoEffort;
                    }
                    if (Object.hasOwn(effortSettings, 'effort')) session.effort = effortSettings.effort;
                    // 대화 내용은 보존하고 이번 요청의 도구 카탈로그에만 최신 협업 모드를 반영한다.
                    if (typeof nextOrchestrationMode === 'string') session.orchestrationMode = nextOrchestrationMode;
                    orchestration.bind(session);
                    attachHostPolicy(session, { mode: config.mode || 'ask', systemPrompt: config.systemPrompt || '',
                        orchestration: nextOrchestrationMode !== 'none',
                        onIdentity: (id, state) => callbacks.onIdentity?.({ id, state }) });
                },
            };
            try {
                const result = await runtime.ask(source ? agentMessageContent(text, source) : text, options);
                return await orchestration.drainLead(
                    () => runtime.ask('', { ...options, promptSource: undefined, transcriptMeta: undefined, continueTurn: true }), result);
            } catch (error) {
                quotaFailure = turnFailureRecord(error, {
                    provider: runtime.session?.provider ?? runtime.provider,
                    model: runtime.session?.model ?? runtime.model,
                }).quota;
                if (quotaFailure) error.quota = quotaFailure;
                await orchestration.abort('paseodog-turn-failed');
                throw error;
            } finally { if (steeringOwner === owner) steeringOwner = null; orchestration.finish(); }
        },
        // 활성 턴을 취소하거나 새 세션을 만들지 않고 추가 지시를 전달한다.
        async steer(content, provenance) {
            if (closed || !steeringOwner?.sessionId) throw new Error('No active native turn for steering');
            return await native.steerSession(steeringOwner.sessionId, content, agentMessageSource(provenance));
        },
        // 도구 노출 모드와 호스트 정책을 함께 갱신하고 하위 세션에도 같은 설정을 전달한다.
        async configure(changes) {
            if (closed) throw new Error('Native engine closed');
            if (steeringOwner) throw new Error('Native engine busy');
            if (!changes || typeof changes !== 'object' || Array.isArray(changes)
                || !Object.keys(changes).length
                || Object.keys(changes).some((key) => !['mode', 'effort', 'autoEffort', 'route', 'effortOptions'].includes(key)))
                throw new Error('Invalid session configuration');
            if (Object.hasOwn(changes, 'mode')) {
                if (Object.keys(changes).length !== 1 || !['ask', 'review', 'bypass'].includes(changes.mode))
                    throw new Error('Invalid host mode');
                await runtime.setToolMode(changes.mode === 'review' ? 'readonly' : 'full');
                config.mode = changes.mode;
                return { mode: config.mode };
            }
            if (changes.route) {
                const next = changes.route;
                if (!next || typeof next !== 'object' || Array.isArray(next)
                    || Object.keys(next).some((key) => !['provider', 'model', 'fast', 'contextPercent', 'contextTokens'].includes(key)))
                    throw new Error('Invalid session route');
                const modelSelection = next.provider !== undefined || next.model !== undefined;
                const selected = modelSelection ? { ...next } : { ...sessionRoute(),
                    effort: configuration().effort, autoEffort: configuration().autoEffort, ...next };
                // 비율 선택이 이전의 절대 토큰 한도에 가려지지 않도록 원본의 해제 값을 전달한다.
                if (Object.hasOwn(next, 'contextPercent') && !Object.hasOwn(next, 'contextTokens'))
                    selected.contextTokens = null;
                const generation = configurationGeneration;
                if (modelSelection) await compactBeforeModelSwitch(runtime, selected, native.loadConfig, () => {
                    if (closed || generation !== configurationGeneration)
                        throw new Error('모델 변경이 취소됐어요.');
                });
                await runtime.setRoute(selected, { applyToCurrentSession: true, sessionOnly: true, keepMainModel: true });
                if (changes.effortOptions) currentEffortOptions = changes.effortOptions;
                if (modelSelection) {
                    delete effortSettings.effort;
                    delete effortSettings.autoEffort;
                }
            }
            if (Object.hasOwn(changes, 'autoEffort') && typeof changes.autoEffort !== 'boolean')
                throw new Error('Invalid autoEffort');
            if (changes.autoEffort === true && !configuration().autoEffortAvailable)
                throw new Error('Auto effort is unavailable for the current model or native module');
            if (Object.hasOwn(changes, 'effort') && !effortOptions()
                .some((option) => (typeof option === 'string' ? option : option.id || option.value) === changes.effort))
                throw new Error('Unsupported effort for current model');
            Object.assign(effortSettings,
                Object.hasOwn(changes, 'effort') ? { effort: changes.effort } : {},
                Object.hasOwn(changes, 'autoEffort') ? { autoEffort: changes.autoEffort } : {},
                Object.hasOwn(changes, 'effort') && !Object.hasOwn(changes, 'autoEffort') ? { autoEffort: false } : {});
            return { ...configuration(), ...(changes.route ? { route: sessionRoute() } : {}) };
        },
        // 복구·계승·컨텍스트 조회를 실행 중인 동일 네이티브 세션에 한정한다.
        async action(request) {
            if (closed || steeringOwner) throw new Error('Native engine busy or closed');
            if (runtime.session?.remoteAttached === true) throw new Error('Unmanaged native writer');
            if ((['undo', 'redo'].includes(request.operation)
                || (request.operation === 'rewind' && request.scope !== 'conversation')) && config.mode === 'review')
                throw new Error('Review 모드에서는 파일을 복구할 수 없어요.');
            return nativeSessionAction(runtime, request, {
                // 선택한 전용 프로필 서버만 기존 호스트 경계에 추가하고 다른 저장 서버는 숨긴다.
                async selectMcp(name) {
                    if (Object.hasOwn(config.mcpServers || {}, name))
                        throw new Error('호스트가 지정한 MCP 서버는 이 화면에서 교체할 수 없어요.');
                    const latest = await native.loadConfig();
                    if (!Object.hasOwn(latest.mcpServers || {}, name))
                        throw new Error('전용 프로필에 등록된 MCP 서버가 아니에요.');
                    initialConfig.mcpServers = { ...initialConfig.mcpServers, [name]: latest.mcpServers[name] };
                },
            });
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
            const result = await runtime.compact({ recoverAgent: true });
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
                fast: runtime.session?.fast ?? runtime.fast,
                contextPercent: runtime.session?.contextPercent ?? runtime.contextPercent,
                quota: quotaFailure,
                autoEffort: effortSettings.autoEffort !== false && configuration().autoEffortAvailable,
                effectiveEffort: runtime.session?.paseodogRequestEffort?.effort ?? null,
                effectiveEffortAt: runtime.session?.paseodogRequestEffort?.at ?? null,
                workflow: workflow ? { id: workflow.id, name: workflow.name } : null,
                orchestration: runtime.orchestrationMode,
                compaction: { auto: runtime.getCompactionSettings().auto },
                context: Object.fromEntries(Object.entries(context || {})
                    .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))),
                jobs: orchestration.status(),
            };
        },
        async abort(reason) {
            configurationGeneration++;
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

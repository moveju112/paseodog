import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { DEFAULT_MODEL, deadline, errorText, hash, textOf, display, tokenUsage, publicUsage, contextUsage, validateConfig, promptText } from './util.mjs';
import { questionRequestInput, questionAnswers } from './question.mjs';
import { agentMessageSource } from './agent-message.mjs';
import { compactionNotice, projectCompaction } from './compaction.mjs';
import { readTurnMinutes } from './turn-duration.mjs';

export const CAPABILITIES = ['prompt.message', 'prompt.image', 'prompt.command', 'prompt.steer', 'session.configure', 'session.persistence', 'session.list',
    'session.revert.conversation', 'permission'];
const REVERT_CAPABILITIES = ['session.revert.conversation'];
// 계승 목록과 세션 도구에서 같은 첫 사용자 지시로 대상을 구분한다.
function sessionDescription(row) {
    const prompt = row.items.find(({ item }) => item.type === 'user_message'
        && typeof item.text === 'string' && item.text.trim())?.item;
    const description = prompt?.text.replace(/\s+/g, ' ').trim().slice(0, 500);
    return { title: description?.slice(0, 100) || row.cwd.split('/').pop() || row.cwd, description };
}
function catalogFrom(env) {
    let routes = [];
    if (env.PASEODOG_MODELS) {
        routes = JSON.parse(env.PASEODOG_MODELS);
        if (!Array.isArray(routes) || routes.length > 100) throw new Error('PASEODOG_MODELS must be an array of at most 100 routes');
        const seen = new Set();
        for (const row of routes) {
            if (!row || typeof row.id !== 'string' || !row.id || seen.has(row.id) || typeof row.model !== 'string' || typeof row.provider !== 'string') throw new Error('Invalid or duplicate model route');
            seen.add(row.id);
        }
    }
    return { routes, catalog: {
        models: routes.map((r) => ({ id: r.id, label: r.label || r.id })),
        modes: [{ id: 'ask', label: 'Build (approve every tool)' }, { id: 'review', label: 'Review (read tools only)' },
            { id: 'bypass', label: 'Bypass' }],
        thinkingOptions: [], ...(routes.length ? { defaultModel: routes[0].id } : {}), defaultMode: 'ask',
    } };
}
export function createProviderConnection({ capabilities = CAPABILITIES, engineFactory, store,
    loadCatalog,
    env = {}, canonicalPath = (path) => { if (!isAbsolute(path)) throw new Error('cwd must be absolute'); return realpathSync(path); },
    bootMs = 60000, stopMs = 8000, permissionMs = 120000, maxTurnMs = undefined, flushMs = 250 }) {
    if (!store) throw new Error('JournalStore is required');
    const selected = [...new Set(capabilities.filter((c) => CAPABILITIES.includes(c)))];
    const { routes, catalog } = catalogFrom(env);
    const configuredRoutes = [...routes];
    let profileRoute;
    // Mixdog 카탈로그를 새 세션의 선택 목록으로 투영하고 기존 세션 경로는 유지한다.
    async function refreshCatalog() {
        if (!loadCatalog) return;
        const snapshot = await loadCatalog();
        profileRoute = snapshot.route;
        const nativeRoutes = snapshot.models.map((row) => ({
            id: `${row.provider}/${row.id}`, provider: row.provider, model: row.id,
            label: `${row.label} · ${row.provider}`, effortOptions: row.effortOptions, fastCapable: row.fastCapable,
        }));
        routes.splice(0, routes.length, ...nativeRoutes,
            ...configuredRoutes.filter((row) => !nativeRoutes.some((native) => native.id === row.id)));
        catalog.models = routes.map((row) => ({ id: row.id, label: row.label || row.id, thinkingOptions: row.effortOptions || [] }));
        catalog.defaultModel = routes.find((row) => row.provider === profileRoute?.provider && row.model === profileRoute?.model)?.id
            || routes[0]?.id;
    }
    const sessions = new Map(), listeners = new Set(), tasks = new Set();
    let closing = false, closed = false, closingPromise;
    function emit(event) {
        if (closed) return;
        for (const listener of listeners) { try { listener(event); } catch {} }
    }
    function track(promise) { tasks.add(promise); void promise.finally(() => tasks.delete(promise)).catch(() => {}); return promise; }
    function failSession(session, reason) {
        if (session.closed || session.closing || session.failureReported) return;
        session.failureReported = true;
        session.broken = true;
        releaseApprovals(session, 'Engine failed');
        emit({ type: 'session.runtime_failed', sessionId: session.id,
            error: { message: `${reason}; review any partial file changes before retrying` } });
    }
    function reportContainmentFailure(session, reason) {
        session.broken = true;
        session.containmentFailure = errorText(reason);
        // A scope may still contain running commands. Never imply that an
        // interrupted/failed turn was rolled back or the scope was stopped.
        notice(session, 'containment-unconfirmed',
            `Unable to confirm PaseoDog process termination: ${session.containmentFailure}. `
            + 'Inspect the user systemd scope and any outstanding file changes before reopening.', 'error');
    }
    function containAfterJournalFailure(session, cause) {
        failSession(session, `Journal write failed: ${errorText(cause)}`);
        if (session.active) {
            // The accepted prompt may already have modified files. Leave its
            // durable receipt running so the next open marks it uncertain.
            session.active.canceled = true;
            session.active.finished = true;
            clearTimeout(session.active.timer);
            emit({ type: 'session.turn', sessionId: session.id, turnId: session.active.id,
                state: 'failed', error: { message: 'Journal persistence failed; execution outcome is uncertain' } });
        }
        if (session.containmentPromise) return;
        const engine = session.active?.engine || session.engine;
        session.containmentPromise = Promise.resolve().then(() => {
            if (typeof engine?.kill !== 'function') throw new Error('No engine containment operation available');
            return deadline(Promise.resolve().then(() => engine.kill()), stopMs,
                'Engine containment confirmation timed out');
        }).then(() => {
            if (!session.closed && !session.closing)
                notice(session, 'containment-confirmed', 'PaseoDog process scope stopped after journal failure', 'warning');
        }).catch((error) => reportContainmentFailure(session, error));
        // The entire promise is observed; a failed systemd kill, synchronous
        // exception or timeout cannot crash the provider process.
    }
    // 구조화된 내부 송신자는 감사 기록에만 남기고 사용자 타임라인으로 내보내지 않는다.
    function publishItem(session, row) {
        if (row.item.source?.kind === 'agent') return;
        const revertToken = revertTokenFor(session, row.item);
        emit({ type: 'timeline.item', sessionId: session.id, ...row, ...(revertToken ? { item: { ...row.item, revertToken } } : {}) });
    }
    // 사람이 보낸 텍스트 전용 턴 시작 메시지만 되돌리기 대상으로 노출한다.
    function revertTokenFor(session, item) {
        if (item.type !== 'user_message' || !item.id.startsWith('user:')
            || !REVERT_CAPABILITIES.some((capability) => selected.includes(capability))) return null;
        return session.record.receipts[item.id.slice('user:'.length)]?.rewindable === true ? { messageId: item.id } : null;
    }
    function recordItem(session, item, timestamp = new Date().toISOString()) {
        if (session.closed) return;
        const index = session.record.items.findIndex((row) => row.item.id === item.id);
        const row = { item: structuredClone(item), timestamp };
        if (index < 0) session.record.items.push(row); else session.record.items[index] = row;
        publishItem(session, row);
        if (!session.flushTimer) session.flushTimer = setTimeout(() => {
            session.flushTimer = null;
            try { store.save(session.record); }
            catch (error) { containAfterJournalFailure(session, error); }
        }, flushMs);
    }
    function flush(session) { clearTimeout(session.flushTimer); session.flushTimer = null; store.save(session.record); }
    function notice(session, id, title, severity = 'warning') {
        emit({ type: 'session.notice', sessionId: session.id, notice: { id, title, severity } });
    }
    function ack(session, prompt, result) {
        if (session.acked.has(prompt.clientMessageId)) return;
        session.acked.add(prompt.clientMessageId);
        emit({ type: 'session.prompt_result', sessionId: session.id, clientMessageId: prompt.clientMessageId, result });
    }
    // 실제 컨텍스트만 전달하며 종료·취소된 턴의 늦은 조회 결과는 버린다.
    async function publishContext(session, turn) {
        const live = () => !session.closed && !session.closing && !session.broken
            && (!turn || (session.active === turn && !turn.finished && !turn.canceled));
        if (!live() || typeof session.engine?.status !== 'function') return;
        try {
            const status = await session.engine.status();
            if (!live()) return;
            const usage = contextUsage(status.context);
            if (!Object.keys(usage).length) return;
            session.contextUsage = usage;
            emit({ type: 'session.usage', sessionId: session.id,
                ...(turn ? { turnId: turn.id } : {}),
                usage: { ...(turn ? publicUsage(turn.usage) : {}), ...usage } });
        } catch {
            // 표시 정보 조회 실패가 실행 결과나 승인 상태를 바꾸면 안 된다.
        }
    }
    function rejectRequest(input, error) {
        if (input.type === 'session.prompt') {
            const session = sessions.get(input.sessionId);
            const result = { type: 'failed', error: { message: errorText(error) } };
            if (session) ack(session, input.prompt, result);
            else emit({ type: 'session.prompt_result', sessionId: input.sessionId, clientMessageId: input.prompt?.clientMessageId || 'invalid', result });
        } else if (input.requestId) emit({ type: 'request.failed', requestId: input.requestId, error: { message: errorText(error) } });
        else if (input.type === 'session.permission') {
            const session = sessions.get(input.sessionId);
            if (session) notice(session, `permission-rejected:${input.permissionId}`, errorText(error));
        }
    }
    function persistence(session) { return { version: 2, data: { bridgeId: session.record.id } }; }
    function releaseApprovals(session, reason) {
        for (const [id, request] of session.permissions) {
            clearTimeout(request.timer); request.resolve({ approved: false, reason });
            emit({ type: 'session.permission_resolved', sessionId: session.id, permissionId: id });
        }
        session.permissions.clear();
    }
    // 같은 세션의 다음 턴 선호값을 SDK 설정 목록과 노력도 선택값으로 투영한다.
    function sessionConfig(session) {
        const currentRoute = session.record.nativeRoute || session.route;
        const route = routes.find((row) => row.provider === currentRoute?.provider && row.model === currentRoute?.model);
        const model = currentRoute?.model
            ? catalog.models.find((row) => row.id === route?.id)
            : catalog.models.find((row) => row.id === (session.config.model === DEFAULT_MODEL
                ? catalog.defaultModel : session.config.model));
        return { model: model?.id || session.config.model || DEFAULT_MODEL, mode: session.config.mode || 'ask',
            ...(session.config.thinkingOption ? { thinkingOption: session.config.thinkingOption } : {}),
            models: catalog.models, modes: catalog.modes, thinkingOptions: model?.thinkingOptions || [],
            settings: [...(session.autoEffortAvailable && model?.thinkingOptions?.length ? [{ type: 'toggle', id: 'autoEffort', label: 'Auto effort',
                description: 'Applies to the next turn in this session',
                value: session.config.settings.autoEffort }] : []),
                ...(route?.fastCapable === true ? [{ type: 'toggle', id: 'fast', label: 'Fast',
                    description: 'Applies to the next turn in this session; additional charges may apply',
                    value: currentRoute.fast === true }] : [])] };
    }
    function identity(session, info) {
        if (session.closed || session.active?.canceled) return;
        if (typeof info.id !== 'string' || !info.id || info.id.length > 200) throw new Error('Invalid native session ID');
        if (session.record.nativeSessionId && session.record.nativeSessionId !== info.id) throw new Error('Native session changed unexpectedly');
        session.record.nativeSessionId = info.id;
        if (info.state?.model) session.record.nativeRoute = {
            ...session.record.nativeRoute,
            model: info.state.model, provider: info.state.provider,
            effort: session.config.thinkingOption ?? info.state.effort ?? session.record.nativeRoute?.effort,
            fast: info.state.fast ?? session.record.nativeRoute?.fast ?? session.route?.fast,
        };
        flush(session);
        if (info.state?.model) {
            const model = catalog.models.find((row) => row.id === `${info.state.provider}/${info.state.model}`)
                || catalog.models.find((row) => row.id === session.config.model);
            emit({ type: 'session.config', sessionId: session.id, config: { ...sessionConfig(session),
                model: model?.id || info.state.model,
                models: model ? catalog.models : [{ id: info.state.model, label: info.state.model }, ...catalog.models] } });
        }
    }
    async function openSession(input) {
        await refreshCatalog();
        if (sessions.has(input.sessionId)) throw new Error('Session already exists');
        if (!selected.includes('prompt.message')) throw new Error('prompt.message was not negotiated');
        if (input.persistence && !selected.includes('session.persistence')) throw new Error('Persistence was not negotiated');
        const config = validateConfig(structuredClone(input.config));
        if (!config.persist) throw new Error('PaseoDog requires durable sessions: persist:true');
        config.cwd = canonicalPath(config.cwd);
        let bridgeId;
        if (input.persistence) {
            if (input.persistence.version !== 2 || typeof input.persistence.data?.bridgeId !== 'string') throw new Error('Unsupported persistence record. Starter v0.1 records require a new PaseoDog session.');
            bridgeId = input.persistence.data.bridgeId;
        } else bridgeId = randomUUID();
        const release = store.acquire(bridgeId);
        const promptHash = hash(config.systemPrompt || '');
        let record;
        try {
            record = input.persistence ? store.load(bridgeId) : store.create(bridgeId, config.cwd, promptHash);
            if (record.cwd !== config.cwd) throw new Error('Restored journal belongs to another working directory');
            if (record.promptHash !== promptHash) throw new Error('System prompt changed; start a new session instead of reusing old context');
            if (record.pendingRevert)
                throw new Error('이전 되돌리기 결과가 불확실해요. 자동 재실행하지 않았어요. 기록 확인 전에는 이 세션을 재개할 수 없어요.');
            if (record.effortSettings) {
                config.settings.autoEffort = record.effortSettings.autoEffort;
                if (record.effortSettings.effort) config.thinkingOption = record.effortSettings.effort;
                validateConfig(config);
            }
        } catch (error) { release(); throw error; }
        const model = config.model || DEFAULT_MODEL;
        const route = model === DEFAULT_MODEL && profileRoute ? profileRoute : routes.find((row) => row.id === model);
        if (!record.nativeSessionId && model !== DEFAULT_MODEL && !route && model !== record.nativeRoute?.model && !config.providerOptions?.model) { release(); throw new Error('Unknown model route; configure PASEODOG_MODELS or providerOptions'); }
        const session = { id: input.sessionId, config, record, release, acked: new Set(), permissions: new Map(),
            engine: null, enginePromise: null, active: null, closed: false, closing: false, broken: false,
            bootController: new AbortController(), flushTimer: null, closePromise: null, failureReported: false,
            unsubscribeCrash: null, containmentPromise: null, containmentFailure: null };
        sessions.set(input.sessionId, session);
        let uncertain = null;
        try {
            // A crash-recovery write can fail too (ENOSPC, EIO). Keep that
            // operation inside the ownership cleanup boundary, not outside it.
            if (record.active) {
                uncertain = record.active;
                for (const receipt of Object.values(record.receipts))
                    if (receipt.turnId === uncertain.turnId && receipt.state === 'running') receipt.state = 'uncertain';
                record.active = null; flush(session);
            }
            if (record.quotaResume) {
                record.quotaResume = null;
                flush(session);
                notice(session, 'quota-resume-canceled', '연결이 종료된 재개 예약은 자동 실행하지 않았어요. 필요한 경우 다시 예약하세요.');
            }
            const requestedRoute = { provider: config.providerOptions?.provider || route?.provider || env.PASEODOG_PROVIDER || undefined,
                    model: config.providerOptions?.model || route?.model || env.PASEODOG_MODEL || undefined,
                    effort: record.effortSettings?.effort || config.providerOptions?.effort || config.thinkingOption || route?.effort || (!profileRoute ? env.PASEODOG_EFFORT : undefined),
                    ...(profileRoute ? { autoEffort: profileRoute.autoEffort, fast: profileRoute.fast } : {
                        ...(env.PASEODOG_AUTO_EFFORT === 'false' ? { autoEffort: false } : {}),
                        ...(env.PASEODOG_FAST === 'false' ? { fast: false } : {}) }) };
            if (profileRoute) {
                requestedRoute.contextPercent = profileRoute.contextPercent;
                requestedRoute.contextTokens = profileRoute.contextTokens;
            }
            if (Object.hasOwn(config.settings, 'autoEffort')) requestedRoute.autoEffort = config.settings.autoEffort;
            else if (config.thinkingOption && !input.persistence) requestedRoute.autoEffort = false;
            // 분기에서 복사한 명시적 Fast 값을 Main 기본값보다 우선한다. 복원은 아래 저장 경로를 따른다.
            if (Object.hasOwn(config.settings, 'fast')) requestedRoute.fast = config.settings.fast;
            let effortRoute = routes.find((row) => row.provider === requestedRoute.provider && row.model === requestedRoute.model);
            if (!input.persistence && config.settings.fast === true && effortRoute?.fastCapable !== true)
                throw new Error('Fast is unavailable for the current model');
            if (!input.persistence && input.config.thinkingOption && !(effortRoute?.effortOptions || [])
                .some((option) => (typeof option === 'string' ? option : option.id) === requestedRoute.effort))
                throw new Error('Unsupported effort for current model');
            if (record.nativeSessionId && record.nativeRoute) {
                // provider·model은 네이티브 세션 정체성이다. effort는 세션 중 바뀌는 설정이라
                // 생성 시 providerOptions 값이 낡을 수 있으므로 저장된 nativeRoute 값을 그대로 쓴다.
                for (const key of ['provider', 'model']) {
                    if (config.providerOptions?.[key] !== undefined && config.providerOptions[key] !== record.nativeRoute[key])
                        throw new Error(`Cannot change native ${key} while restoring; create a new session`);
                }
                // 승인·저장된 현재 경로를 복원하며 과거 Main 기본값으로 되돌리지 않는다.
                Object.assign(requestedRoute, record.nativeRoute);
                effortRoute = routes.find((row) => row.provider === requestedRoute.provider && row.model === requestedRoute.model);
                config.model = effortRoute?.id || record.nativeRoute.model;
            }
            const args = { config, nativeSessionId: record.nativeSessionId,
                effortOptions: effortRoute?.effortOptions || [],
                route: record.nativeSessionId && record.nativeRoute ? record.nativeRoute : requestedRoute };
            session.route = args.route;
            if (args.route.effort && !config.thinkingOption) config.thinkingOption = args.route.effort;
            const created = Promise.resolve().then(() => engineFactory.create(args, { signal: session.bootController.signal }));
            // Late boot results are disposed even if the caller has timed out or closed.
            void created.then((engine) => { if (session.closed || session.broken) return engine.close('late-open'); }).catch(() => {});
            session.enginePromise = deadline(created, bootMs, 'Engine startup timed out');
            session.engine = await session.enginePromise;
            const actual = session.engine.configuration?.();
            session.autoEffortAvailable = actual?.autoEffortAvailable === true;
            if (!input.persistence && input.config.settings.autoEffort === true
                && (!session.autoEffortAvailable || !effortRoute?.effortOptions?.length))
                throw new Error('Auto effort is unavailable for the current model or native module');
            config.settings.autoEffort = actual?.autoEffort ?? requestedRoute.autoEffort !== false;
            if (actual?.effort) config.thinkingOption = actual.effort;
            record.effortSettings = { autoEffort: config.settings.autoEffort,
                ...(config.thinkingOption ? { effort: config.thinkingOption } : {}) };
            flush(session);
            // A child that dies after opening is not an ordinary model error.
            // Do not queue another turn against its dead IPC transport.
            session.unsubscribeCrash = session.engine.onCrash?.((error) => {
                failSession(session, `PaseoDog worker exited: ${errorText(error)}`);
            }) || null;
            if (session.broken) throw new Error('PaseoDog engine exited during session open');
            if (session.closed || session.closing || closing) { await closeSession(session); return; }
            emit({ type: 'session.opened', requestId: input.requestId, sessionId: session.id,
                capabilities: selected, restoration: 'core', persistence: persistence(session), cwd: config.cwd, title: config.title });
            emit({ type: 'session.config', sessionId: session.id, config: sessionConfig(session) });
            if (selected.includes('prompt.command')) emit({ type: 'session.commands', sessionId: session.id,
                commands: [{ name: 'compact', description: '새 세션을 시작하지 않고 대화 컨텍스트 압축' }] });
            if (input.history === 'replay') {
                for (const row of record.items) publishItem(session, row);
                if (record.historyTruncated) notice(session, 'history-tail', '최근 대화 일부를 표시합니다. 전체 기록은 PaseoDog에 보존되어 있습니다.');
            }
            if (uncertain) notice(session, 'recovered-uncertain-turn', 'The previous process stopped during a turn. It was NOT replayed. Inspect files before sending a new instruction.');
            await publishContext(session);
            emit({ type: 'session.ready', requestId: input.requestId, sessionId: session.id });
        } catch (error) {
            session.broken = true;
            try { await closeSession(session); } catch { /* preserve the originating error */ }
            sessions.delete(session.id);
            throw error;
        }
    }
    // 본문 경계까지 보류한 도구의 최신 상태만 타임라인에 전달한다.
    function flushToolItems(session, turn) {
        for (const key of turn.pendingTools) recordItem(session, turn.tools.get(key));
        turn.pendingTools.clear();
    }
    function finishTurn(session, turn, state, error) {
        if (turn.finished) return;
        if (turn.compacting) {
            recordItem(session, { type: 'compaction', id: `native-compact:${turn.id}`, status: 'completed' });
            const message = compactionNotice({ status: state === 'canceled' ? 'canceled' : 'failed' });
            notice(session, `native-compact-summary:${turn.id}`, message.message, message.level);
            turn.compacting = false;
        }
        turn.finished = true; clearTimeout(turn.timer);
        releaseApprovals(session, `Turn ${state}`);
        for (const [callId, tool] of turn.tools) {
            if (tool.status === 'running') {
                turn.tools.set(callId, { ...tool, status: state === 'completed' ? 'failed' : 'canceled',
                    error: state === 'completed' ? 'Missing final tool result' : null });
                turn.pendingTools.add(callId);
            }
        }
        flushToolItems(session, turn);
        const receipt = session.record.receipts[turn.receiptKey];
        if (receipt) { receipt.state = state; receipt.usage = turn.usage; }
        for (const key of turn.steeringReceipts || []) {
            const steering = session.record.receipts[key];
            if (steering?.state === 'running') steering.state = state;
        }
        session.record.active = null;
        session.record.usage[turn.id] = turn.usage;
        let saveError;
        try { flush(session); } catch (e) { saveError = e; session.broken = true; }
        emit({ type: 'session.turn', sessionId: session.id, turnId: turn.id,
            state: saveError ? 'failed' : state,
            ...((error || saveError) ? { error: { message: errorText(saveError || error) } } : {}) });
    }
    function requestPermission(session, turn, info) {
        if (turn.canceled || turn.finished || session.closing || session.closed) return Promise.resolve({ approved: false, reason: 'Turn no longer active' });
        if (!selected.includes('permission')) return Promise.resolve({ approved: false, reason: 'Permission capability not negotiated' });
        if (info?.sessionId && session.record.nativeSessionId && info.sessionId !== session.record.nativeSessionId) return Promise.resolve({ approved: false, reason: 'Permission session mismatch' });
        let input;
        try { input = JSON.parse(JSON.stringify(info?.args || {})); }
        catch { return Promise.resolve({ approved: false, reason: 'Unserializable approval arguments' }); }
        if (Buffer.byteLength(JSON.stringify(input)) > 128 * 1024) return Promise.resolve({ approved: false, reason: 'Approval too large to inspect safely' });
        // 네이티브 ask_user만 공용 질문 UI로 보낸다. 변환 불가(헤더 중복 등)는 카드 없이 거부한다.
        const question = info?.kind === 'question' && info?.name === 'ask_user';
        let questionInput;
        if (question) {
            try { questionInput = questionRequestInput(input); }
            catch (error) { return Promise.resolve({ approved: false, reason: errorText(error) }); }
        }
        const id = randomUUID();
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                session.permissions.delete(id);
                emit({ type: 'session.permission_resolved', sessionId: session.id, permissionId: id });
                resolve({ approved: false, reason: 'Approval timed out; no action was authorized' });
            }, permissionMs);
            session.permissions.set(id, { resolve, timer, turnId: turn.id,
                childSessionId: info?.childSessionId || null, tool: String(info?.name || 'tool'),
                questions: question ? input.questions : null });
            if (question) {
                emit({ type: 'session.permission', sessionId: session.id, request: {
                    id, name: 'ask_user', kind: 'question', title: 'Question', input: questionInput } });
                return;
            }
            emit({ type: 'session.permission', sessionId: session.id, request: {
                id, name: String(info?.name || 'tool'), kind: 'tool', title: `Allow ${String(info?.name || 'tool')} once?`,
                description: String(info?.reason || 'PaseoDog requires explicit approval'), input,
                actions: [{ id: 'allow-once', label: 'Allow once', behavior: 'allow', variant: 'primary' },
                    { id: 'deny', label: 'Deny', behavior: 'deny', variant: 'danger' }],
            } });
        });
    }
    function acceptPermission(input) {
        const session = sessions.get(input.sessionId), pending = session?.permissions.get(input.permissionId);
        if (!pending || pending.turnId !== session.active?.id || session.active?.canceled) throw new Error('Stale permission cannot authorize a tool');
        const response = input.response || {};
        if (pending.questions) {
            // 질문 응답: 잘못된 답은 질문을 유지한 채 거부하고, 닫기(deny)는 미응답으로 전달한다.
            let answer = { approved: false, reason: response.message || 'Question dismissed' };
            if (response.behavior === 'allow') {
                if (response.selectedActionId || response.updatedPermissions) throw new Error('Unsupported question response');
                answer = { approved: true, answers: questionAnswers(pending.questions, response.updatedInput) };
            }
            clearTimeout(pending.timer); session.permissions.delete(input.permissionId);
            pending.resolve(answer);
            emit({ type: 'session.permission_resolved', sessionId: session.id, permissionId: input.permissionId });
            if (response.interrupt) void interrupt(session);
            return;
        }
        const validAllow = response.behavior === 'allow' && (!response.selectedActionId || response.selectedActionId === 'allow-once') && !response.updatedInput && !response.updatedPermissions;
        clearTimeout(pending.timer); session.permissions.delete(input.permissionId);
        pending.resolve(validAllow ? { approved: true } : { approved: false, reason: response.message || 'Denied or unsupported permission change' });
        emit({ type: 'session.permission_resolved', sessionId: session.id, permissionId: input.permissionId });
        if (response.interrupt) void interrupt(session);
    }
    function callbacksFor(session, turn) {
        const live = () => !closed && !session.closed && !session.closing && !session.broken && !turn.canceled && !turn.finished;
        let segment = 0, text = '', segmentClosed = false, lastCommitted = '', committedText = '';
        let phase, nativeMessageId, phaseStart = 0;
        let reasoning = '';
        const push = () => recordItem(session, { type: 'assistant_message', id: `assistant:${turn.id}:${segment}`,
            text: text.slice(phaseStart), ...(phase ? { phase } : {}) });
        function setText(value, append = false) {
            if (!live()) return;
            if (!value) return;
            if (segmentClosed) { segment++; text = ''; phaseStart = 0; segmentClosed = false; }
            const next = append ? text + value : value;
            if (next.length > 1024 * 1024) throw new Error('Assistant output exceeds bridge safety limit');
            if (!append && text && !next.startsWith(text)) {
                // 짧아진 스냅샷은 이미 표시한 내용을 보존하고, 수정된 응답은 새 항목으로 전달한다.
                // 같은 ID는 append-only이므로 기존 문장을 덮어쓰지 않는다.
                if (text.startsWith(next)) return;
                segment++;
                phaseStart = 0;
            }
            if (next === text) return;
            text = next; push();
        }
        function toolStart(call) {
            if (!live() || !call?.id) return;
            const key = String(call.id); if (turn.tools.has(key)) return;
            const tool = { type: 'tool_call', id: `tool:${turn.id}:${key}`, callId: key,
                name: String(call.name || call.toolName || 'tool'), status: 'running', error: null,
                detail: { type: 'plain_text', text: display(call.arguments || call.args) } };
            turn.tools.set(key, tool); turn.pendingTools.add(key);
            if (!text || segmentClosed) flushToolItems(session, turn);
        }
        return {
            onIdentity: (info) => identity(session, info),
            // 본문 합계는 기존 확정 콜백과 대조하고, 표시 항목만 명시된 단계 경계에서 나눈다.
            onStreamItemStart: (detail) => {
                if (!live() || detail?.kind !== 'text') return;
                const nextPhase = ['commentary', 'final_answer'].includes(detail.phase) ? detail.phase : undefined;
                const nextId = typeof detail.messageId === 'string' ? detail.messageId : undefined;
                const newMessage = nextId && nextId !== nativeMessageId;
                if (!newMessage && (!nextPhase || phase === nextPhase)) return;
                if ((newMessage || (phase && nextPhase !== phase)) && text.length > phaseStart && !segmentClosed) {
                    segment++;
                    phaseStart = text.length;
                }
                if (newMessage) phase = nextPhase;
                else if (nextPhase) phase = nextPhase;
                nativeMessageId = nextId ?? nativeMessageId;
                // 단계가 item-done에만 실리는 공급자도 같은 ID의 메타데이터로 보존한다.
                if (text.length > phaseStart && !segmentClosed) push();
            },
            onTextDelta: (chunk) => setText(String(chunk || ''), true),
            // The upstream snapshot-to-delta adapter cannot express text deletion.
            // Never acknowledge a reset that clients cannot actually apply.
            onTextReset: () => false,
            onAssistantText: (full) => {
                if (!live() || typeof full !== 'string' || !full) return;
                if (full === lastCommitted && (segmentClosed || text === committedText)) return;
                // 네이티브 콜백은 개별 메시지, 최종 반환은 도구 경계 이후 메시지들의 합계다.
                setText(committedText + full);
                committedText = text; lastCommitted = full;
            },
            onReasoningDelta: (chunk) => { if (!live()) return; reasoning += String(chunk || '');
                reasoning = reasoning.slice(-128 * 1024);
                recordItem(session, { type: 'reasoning', id: `reasoning:${turn.id}`, text: reasoning }); },
            onToolCall: (_iter, calls) => {
                if (!live()) return;
                // 조기 감지·하위 도구는 본문을 닫지 않고, 부모의 확정 도구 배치만 경계로 삼는다.
                if ((calls || []).some((call) => !call?.childSessionId)) {
                    segmentClosed = true; lastCommitted = text; committedText = '';
                    flushToolItems(session, turn);
                    phase = undefined;
                    nativeMessageId = undefined;
                }
                for (const call of calls || []) toolStart(call);
            },
            onAssistantToolCallObserved: toolStart,
            onToolResult: (result) => {
                if (!live() || result?.__earlyNotify === true) return;
                const key = String(result?.toolCallId || ''); if (!key) throw new Error('Tool result is missing its call ID');
                if (!turn.tools.has(key)) toolStart({ id: key, name: result.toolName });
                const current = turn.tools.get(key);
                const failed = result.isError === true || result.toolKind === 'error';
                const tool = { ...current, detail: { type: 'plain_text', text: display(result.content) },
                    status: failed ? 'failed' : result.toolKind === 'skipped' ? 'canceled' : 'completed',
                    error: failed ? 'Native tool reported an error' : null };
                turn.tools.set(key, tool); turn.pendingTools.add(key);
                if (!text || segmentClosed) flushToolItems(session, turn);
            },
            onToolApproval: (info) => requestPermission(session, turn, info),
            onUsageDelta: (delta) => {
                if (!live()) return; turn.usage = tokenUsage(delta, turn.usage);
                emit({ type: 'session.usage', sessionId: session.id, turnId: turn.id,
                    usage: { ...publicUsage(turn.usage), ...session.contextUsage } });
                turn.contextPromise = (turn.contextPromise || Promise.resolve()).then(() => publishContext(session, turn));
            },
            onCompactEvent: (event) => {
                if (!live()) return;
                const summary = projectCompaction(event);
                turn.compacting = summary.status === 'compacting';
                recordItem(session, { type: 'compaction', id: `native-compact:${turn.id}`,
                    status: turn.compacting ? 'loading' : 'completed',
                    ...(summary.trigger ? { trigger: summary.trigger } : {}),
                    ...(summary.beforeTokens !== undefined ? { preTokens: summary.beforeTokens } : {}) });
                const message = compactionNotice(summary);
                notice(session, `native-compact-summary:${turn.id}`, message.message, message.level);
            },
            final(value) { const full = textOf(value); if (full && full !== text && full !== lastCommitted) setText(full); },
        };
    }
    // 유휴 세션만 변경하고 다음 턴 선호값을 영속화한 뒤 완료를 알린다.
    async function configureSession(input) {
        if (!selected.includes('session.configure')) throw new Error('Session configuration not negotiated');
        const session = sessions.get(input.sessionId);
        if (!session || session.closed || session.closing || session.broken || !session.engine)
            throw new Error('Session is not ready');
        // 진행 중 변경은 거절만 하고 재전송하지 않는다. 메시지는 모든 클라이언트 오류 토스트에 그대로 표시된다.
        if (session.active)
            throw new Error('응답 중에는 모델·추론 수준·설정을 바꿀 수 없어요. 응답이 끝날 때까지 기다리거나 응답을 중지한 뒤 다시 선택해 주세요.');
        if (session.configuring)
            throw new Error('이전 설정 변경을 저장하는 중이에요. 저장이 끝난 뒤 다시 선택해 주세요.');
        const changes = input.changes;
        if (!changes || typeof changes !== 'object' || Array.isArray(changes)
            || !Object.keys(changes).length
            || Object.keys(changes).some((key) => !['model', 'mode', 'thinkingOption', 'settings', 'route'].includes(key)))
            throw new Error('Unsupported session configuration');
        const modeChange = Object.hasOwn(changes, 'mode');
        if ((Object.hasOwn(changes, 'model') || Object.hasOwn(changes, 'route'))
            && Object.keys(changes).some((key) => !['model', 'route'].includes(key)))
            throw new Error('모델·Fast·컨텍스트 설정은 추론 수준과 따로 변경해 주세요.');
        if (modeChange && Object.keys(changes).length !== 1) throw new Error('Change mode separately from effort');
        const nextConfig = { ...session.config, settings: { ...session.config.settings } };
        const nativeChanges = {};
        if (Object.hasOwn(changes, 'model')) {
            const nextRoute = routes.find((row) => row.id === changes.model);
            if (!nextRoute) throw new Error('Select a model from the current Mixdog catalog');
            nativeChanges.route = { provider: nextRoute.provider, model: nextRoute.model };
            nativeChanges.effortOptions = nextRoute.effortOptions || [];
            nextConfig.model = nextRoute.id;
            delete nextConfig.thinkingOption;
        }
        if (Object.hasOwn(changes, 'route')) {
            const tuning = changes.route;
            if (!tuning || typeof tuning !== 'object' || Array.isArray(tuning)
                || Object.keys(tuning).some((key) => !['fast', 'contextPercent', 'contextTokens'].includes(key))
                || (tuning.fast !== undefined && typeof tuning.fast !== 'boolean')
                || (tuning.contextPercent !== undefined && (!Number.isFinite(tuning.contextPercent) || tuning.contextPercent < 10 || tuning.contextPercent > 100))
                || (tuning.contextTokens !== undefined && (!Number.isFinite(tuning.contextTokens) || tuning.contextTokens < 1000 || tuning.contextTokens > 2000000)))
                throw new Error('Invalid session tuning');
            nativeChanges.route = { ...nativeChanges.route, ...tuning };
        }
        if (modeChange) { nextConfig.mode = changes.mode ?? 'ask'; nativeChanges.mode = nextConfig.mode; }
        if (Object.hasOwn(changes.settings || {}, 'fast')) {
            if (Object.keys(changes).length !== 1 || Object.keys(changes.settings).length !== 1
                || typeof changes.settings.fast !== 'boolean')
                throw new Error('Change boolean Fast separately from other settings');
            if (!sessionConfig(session).settings.some((setting) => setting.id === 'fast'))
                throw new Error('Fast is unavailable for the current model');
            nativeChanges.route = { fast: changes.settings.fast };
        } else if (Object.hasOwn(changes, 'settings')) {
            if (!changes.settings || typeof changes.settings !== 'object' || Array.isArray(changes.settings)
                || Object.keys(changes.settings).length !== 1 || typeof changes.settings.autoEffort !== 'boolean')
                throw new Error('Only boolean autoEffort session setting is supported');
            nextConfig.settings.autoEffort = changes.settings.autoEffort;
            nativeChanges.autoEffort = changes.settings.autoEffort;
            if (changes.settings.autoEffort === true
                && !sessionConfig(session).settings.some((setting) => setting.id === 'autoEffort'))
                throw new Error('Auto effort is unavailable for the current model or native module');
        }
        if (Object.hasOwn(changes, 'thinkingOption')) {
            if (!sessionConfig(session).thinkingOptions.some((option) =>
                (typeof option === 'string' ? option : option.id) === changes.thinkingOption))
                throw new Error('Unsupported effort for current model');
            nextConfig.thinkingOption = changes.thinkingOption;
            nextConfig.settings.autoEffort = changes.settings?.autoEffort ?? false;
            nativeChanges.effort = changes.thinkingOption;
            nativeChanges.autoEffort = nextConfig.settings.autoEffort;
        }
        validateConfig(nextConfig);
        session.configuring = true;
        try {
            const actual = await session.engine.configure(nativeChanges);
            if (!modeChange) {
                if (nativeChanges.route) {
                    session.record.nativeRoute = { ...session.record.nativeRoute, ...session.route,
                        ...nativeChanges.route, ...actual?.route };
                    session.route = session.record.nativeRoute;
                    session.autoEffortAvailable = actual?.autoEffortAvailable === true;
                    nextConfig.settings.autoEffort = actual?.autoEffort ?? nextConfig.settings.autoEffort;
                    if (actual?.effort) nextConfig.thinkingOption = actual.effort;
                }
                session.record.effortSettings = { autoEffort: nextConfig.settings.autoEffort,
                    ...(nextConfig.thinkingOption ? { effort: nextConfig.thinkingOption } : {}) };
                if (session.record.nativeRoute && nextConfig.thinkingOption)
                    session.record.nativeRoute.effort = nextConfig.thinkingOption;
                try { flush(session); }
                catch (error) { containAfterJournalFailure(session, error); throw error; }
            }
            session.config = nextConfig;
            emit({ type: 'session.config', sessionId: session.id, config: sessionConfig(session) });
            emit({ type: 'request.completed', requestId: input.requestId });
        } finally { session.configuring = false; }
    }
    async function promptSession(input, quotaRetry = false) {
        const session = sessions.get(input.sessionId);
        if (!session || session.closed || session.closing) throw new Error('Session not found or closing');
        if (session.broken) throw new Error('Session engine failed; reopen the session before sending another instruction');
        if (session.configuring) throw new Error('Session configuration is in progress');
        const parsed = promptText(input.prompt);
        const source = agentMessageSource(input.prompt.source);
        if (source && (parsed.command || input.prompt.clearPendingPermissions))
            throw new Error('Agent messages cannot execute commands or clear human permissions');
        if (parsed.content && !selected.includes('prompt.image')) throw new Error('Images not negotiated');
        if (parsed.command && !selected.includes('prompt.command')) throw new Error('Commands not negotiated');
        const receiptKey = hash(input.prompt.clientMessageId), requestHash = hash(source ? { ...parsed, source } : parsed);
        const previous = session.record.receipts[receiptKey];
        if (previous) {
            if (session.acked.has(input.prompt.clientMessageId)) {
                if (previous.hash !== requestHash) notice(session, `message-id-conflict:${receiptKey}`, 'Message ID conflict; no work was replayed');
                return;
            }
            if (previous.hash !== requestHash) {
                if (session.acked.has(input.prompt.clientMessageId)) notice(session, `message-id-conflict:${receiptKey}`, 'A reused message ID carried different content; no new work was executed');
                else ack(session, input.prompt, { type: 'failed', error: { message: 'Message ID reused with different content' } });
            } else if (previous.state === 'uncertain') ack(session, input.prompt, { type: 'failed', error: { message: 'Prior execution outcome uncertain; automatic replay refused. Send a new instruction after checking files.' } });
            else {
                ack(session, input.prompt, previous.result);
                if (previous.state !== 'running' && previous.result?.type !== 'steer') emit({ type: 'session.turn', sessionId: session.id, turnId: previous.turnId, state: previous.state });
            }
            return;
        }
        if (session.acked.has(input.prompt.clientMessageId)) return;
        if (input.prompt.delivery === 'steer') {
            if (!selected.includes('prompt.steer')) throw new Error('Steering not negotiated');
            if (parsed.command) throw new Error('Commands must run in a separate turn');
            const turn = session.active;
            if (!turn?.accepted || turn.finished || turn.canceled) throw new Error('The active turn ended before steering; send a new instruction');
            const result = { type: 'steer', turnId: turn.id };
            const receipt = { hash: requestHash, turnId: turn.id, state: 'running', result, ...(source ? { source } : {}) };
            session.record.receipts[receiptKey] = receipt;
            (turn.steeringReceipts ||= new Set()).add(receiptKey);
            flush(session);
            try {
                await turn.engine.steer(parsed.content || parsed.text, source);
                recordItem(session, source
                    ? { type: 'notification', id: `agent:${receiptKey}`, level: 'info', source,
                        message: `Agent ${source.agentId} (not human approval): ${parsed.text}` }
                    : { type: 'user_message', id: `user:${receiptKey}`,
                        clientMessageId: input.prompt.clientMessageId, text: parsed.text });
                ack(session, input.prompt, result);
            } catch (error) {
                receipt.state = 'uncertain';
                receipt.result = { type: 'failed', error: { message: `Steering outcome uncertain; do not automatically replay. ${errorText(error)}` } };
                ack(session, input.prompt, receipt.result);
            }
            flush(session);
            return;
        }
        if (session.active) throw new Error('Another turn is running; interrupt or wait before sending another message');
        if (quotaRetry && !session.lastQuota) throw new Error('확인된 quota 실패가 없어요.');
        clearTimeout(session.resumeTimer);
        session.lastQuota = null;
        session.record.quotaResume = null;
        const turn = { id: randomUUID(), receiptKey, canceled: false, finished: false, accepted: false, engine: null, tools: new Map(), pendingTools: new Set(), usage: tokenUsage({}), timer: null, work: null };
        session.active = turn;
        try {
            turn.engine = await session.enginePromise;
            if (session.closing || session.closed || turn.canceled) throw new Error('Session closed or interrupted during startup');
            const turnDurationMs = maxTurnMs ?? readTurnMinutes(env) * 60000;
            const result = { type: 'turn', turnId: turn.id };
            session.record.receipts[receiptKey] = { hash: requestHash, turnId: turn.id, state: 'running', result, ...(source ? { source } : {}),
                // 원본 대화 절단은 텍스트로 대상을 찾으므로 이미지·명령·에이전트 전달은 제외한다.
                ...(!source && !parsed.command && !parsed.content ? { rewindable: true } : {}) };
            session.record.active = { turnId: turn.id, receiptKey };
            flush(session); // Durable receipt BEFORE inference; never automatically replay an uncertain write.
            turn.accepted = true;
            ack(session, input.prompt, result);
            emit({ type: 'session.turn', sessionId: session.id, turnId: turn.id, state: 'started' });
            recordItem(session, source
                ? { type: 'notification', id: `agent:${receiptKey}`, level: 'info', source,
                    message: `Agent ${source.agentId} (not human approval): ${parsed.text}` }
                : { type: 'user_message', id: `user:${receiptKey}`, clientMessageId: input.prompt.clientMessageId, text: parsed.command ? '/compact' : parsed.text });
            const callbacks = callbacksFor(session, turn);
            turn.timer = setTimeout(() => { void interrupt(session, 'Maximum turn duration reached'); }, turnDurationMs);
            turn.work = parsed.command ? turn.engine.compact(callbacks) : turn.engine.ask(parsed.content || parsed.text, callbacks, source, quotaRetry);
            const answer = await turn.work;
            if (turn.finished) return;
            clearTimeout(turn.timer);
            await turn.contextPromise;
            await publishContext(session, turn);
            if (turn.finished) return;
            if (turn.engine.id && !turn.canceled) identity(session, { id: turn.engine.id });
            if (!turn.canceled) {
                if (parsed.command) {
                    const usageDelta = (answer?.result || answer)?.usageDelta;
                    if (usageDelta) {
                        turn.usage = tokenUsage(usageDelta, turn.usage);
                        emit({ type: 'session.usage', sessionId: session.id, turnId: turn.id,
                            usage: publicUsage(turn.usage) });
                    }
                    const message = compactionNotice(answer?.result || answer);
                    notice(session, `compact:${turn.id}`, message.message, message.level);
                } else callbacks.final(answer?.result?.content ?? answer?.content ?? '');
            }
            finishTurn(session, turn, turn.canceled ? 'canceled' : 'completed');
            return { state: turn.canceled ? 'canceled' : 'completed', turnId: turn.id };
        } catch (error) {
            if (turn.accepted && !turn.canceled && error?.quota
                && typeof error.quota.provider === 'string') {
                session.lastQuota = { ...error.quota, turnId: turn.id };
            }
            if (!turn.accepted) {
                session.record.active = null;
                if (session.record.receipts[receiptKey]) {
                    session.record.receipts[receiptKey].state = 'failed';
                    session.broken = true;
                }
                ack(session, input.prompt, { type: 'failed', error: { message: errorText(error) } });
            } else {
                if (!turn.finished && !turn.canceled) recordItem(session, { type: 'error', id: `error:${turn.id}`, message: errorText(error) });
                finishTurn(session, turn, turn.canceled ? 'canceled' : 'failed', turn.canceled ? undefined : error);
            }
            return { state: turn.canceled ? 'canceled' : 'failed', turnId: turn.id };
        } finally {
            clearTimeout(turn.timer);
            if (session.active === turn) session.active = null;
        }
    }
    // 명시한 연결의 소유 세션만 조작하며 모든 변경을 새 턴과 직렬화한다.
    async function sessionAction(input) {
        if (closing || closed) throw new Error('Provider connection closed');
        const session = sessions.get(input.sessionId);
        if (!session || session.closed || session.closing || session.broken || !session.engine)
            throw new Error('Session is not ready');
        if (session.active || session.configuring) throw new Error('응답·설정 변경이 끝난 뒤 다시 시도해 주세요.');
        // 되돌리기는 저널 절단과 함께 session.revert로만 실행한다.
        if (input.operation === 'rewind') throw new Error('Use session.revert to rewind');
        if (input.operation === 'configure') {
            await configureSession({ sessionId: session.id, requestId: randomUUID(), changes: input.changes });
            return { config: sessionConfig(session) };
        }
        if (input.operation === 'quotaCancel') {
            clearTimeout(session.resumeTimer);
            session.record.quotaResume = null;
            flush(session);
            return { canceled: true };
        }
        if (input.operation === 'quotaSchedule') {
            const quota = session.lastQuota;
            if (input.confirmed !== true || !quota || !Number.isFinite(quota.resetAt)
                || quota.resetAt <= Date.now() || quota.resetAt - Date.now() > 2147483647)
                throw new Error('재개 시간이 확인된 최신 quota 실패가 필요해요.');
            clearTimeout(session.resumeTimer);
            const reservation = { turnId: quota.turnId, resetAt: quota.resetAt, state: 'scheduled' };
            session.record.quotaResume = reservation;
            flush(session);
            session.resumeTimer = setTimeout(() => {
                session.resumeTimer = null;
                if (session.closed || session.closing || session.broken || session.active || session.configuring
                    || session.lastQuota?.turnId !== reservation.turnId) return;
                // 실행권을 먼저 영속 소비한다. 충돌·재시작 때 예약을 자동 재생하지 않는다.
                reservation.state = 'consumed';
                try { flush(session); }
                catch (error) { void containAfterJournalFailure(session, error); return; }
                void sessionAction({ sessionId: session.id, operation: 'quotaRetry', confirmed: true })
                    .catch((error) => notice(session, `quota-resume:${reservation.turnId}`, errorText(error), 'error'));
            }, quota.resetAt - Date.now());
            session.resumeTimer.unref?.();
            return { scheduled: true, resetAt: quota.resetAt };
        }
        if (input.operation === 'quotaRetry') {
            if (input.confirmed !== true || !session.lastQuota) throw new Error('quota 재개 확인이 필요해요.');
            return promptSession({ sessionId: session.id, prompt: {
                clientMessageId: randomUUID(), input: { type: 'message', content: [
                    { type: 'text', text: 'Continue from where you left off.' },
                ] },
            } }, true);
        }
        session.configuring = true;
        try {
            const result = await session.engine.action(input);
            if (input.operation !== 'fork') return result;
            const bridgeId = randomUUID();
            const release = store.acquire(bridgeId);
            try {
                const heir = { ...structuredClone(session.record), id: bridgeId,
                    nativeSessionId: result.nativeSessionId,
                    nativeRoute: structuredClone(session.record.nativeRoute || session.route),
                    createdAt: Date.now(), receipts: {}, active: null, usage: {}, quotaResume: null };
                store.save(heir);
            } finally { release(); }
            return { persistence: { version: 2, data: { bridgeId } }, compacted: result.compacted };
        } finally { session.configuring = false; }
    }
    // 메시지 시점으로 되돌리기 (대상·위치 확인 -> 네이티브 복구 -> 대화 범위면 저널 절단)
    async function revertSession(input) {
        if (!selected.includes(`session.revert.${input.scope}`)) throw new Error('Revert scope not negotiated');
        const session = sessions.get(input.sessionId);
        if (!session || session.closed || session.closing || session.broken || !session.engine)
            throw new Error('Session is not ready');
        if (session.active || session.configuring) throw new Error('응답·설정 변경이 끝난 뒤 다시 시도해 주세요.');
        const messageId = input.token?.messageId;
        const index = session.record.items.findIndex(({ item }) => item.id === messageId);
        const row = session.record.items[index];
        if (index < 0 || !revertTokenFor(session, row.item)) throw new Error('이 메시지는 되돌릴 수 없어요.');
        const receipt = session.record.receipts[messageId.slice('user:'.length)];
        if (receipt.state !== 'completed') throw new Error('정상 완료된 메시지만 되돌릴 수 있어요.');
        if (session.record.historyTruncated) throw new Error('일부 기록이 없는 세션은 안전하게 되돌릴 수 없어요.');
        // 이전 정상 턴·실패 턴과 중복된 본문도 네이티브 메시지 위치를 증명하지 못한다.
        if (session.record.items.some(({ item }) => item.id !== messageId
            && item.type === 'user_message' && item.text.trim() === row.item.text.trim()))
            throw new Error('같은 내용의 메시지가 있어 되돌릴 위치를 확정할 수 없어요.');
        session.configuring = true;
        try {
            // 압축·누락처럼 변경 전 확인 가능한 거부는 세션을 불확실 상태로 만들지 않는다.
            await session.engine.action({ operation: 'rewind', scope: input.scope, text: row.item.text,
                confirmed: true, validateOnly: true });
            // 네이티브 저장과 저널 저장 사이의 종료를 감지하고 불확실한 변경은 재생하지 않는다.
            session.record.pendingRevert = { messageId, scope: input.scope };
            flush(session);
            await session.engine.action({ operation: 'rewind', scope: input.scope, text: row.item.text,
                confirmed: true });
            session.record.items.splice(index);
            // 잘린 턴의 quota 재개는 더 이상 이어갈 대화가 없다.
            clearTimeout(session.resumeTimer);
            session.lastQuota = null;
            session.record.quotaResume = null;
            delete session.record.pendingRevert;
            try { flush(session); }
            catch (error) {
                session.record.pendingRevert = { messageId, scope: input.scope };
                containAfterJournalFailure(session, error); throw error;
            }
        } catch (error) {
            if (!session.record.pendingRevert) throw error;
            session.broken = true;
            throw new Error(`되돌리기 결과 확인이 필요해요. 자동 재시도하지 않았어요: ${errorText(error)}`);
        } finally { session.configuring = false; }
        emit({ type: 'request.completed', requestId: input.requestId });
    }
    async function interrupt(session, reason = 'User interrupted') {
        if (!session) throw new Error('Session not found');
        const turn = session.active;
        if (!turn) return;
        turn.canceled = true; releaseApprovals(session, reason);
        try {
            await deadline(Promise.resolve(turn.engine?.abort(reason)), stopMs, 'Engine abort timed out');
            if (turn.work) await deadline(Promise.resolve(turn.work).catch(() => {}), stopMs, 'Engine did not stop');
        } catch (error) {
            failSession(session, 'Engine force-stopped; external side effects are not rolled back');
            try { await turn.engine?.kill?.(); } catch (killError) {
                notice(session, 'engine-kill-failed', `Failed to terminate worker group: ${errorText(killError)}`);
            }
        }
        if (session.record.receipts[turn.receiptKey]) finishTurn(session, turn, 'canceled');
    }
    async function closeSession(session) {
        clearTimeout(session?.resumeTimer);
        if (session.closePromise) return session.closePromise;
        session.closing = true; session.bootController.abort(new Error('Session closing'));
        session.closePromise = (async () => {
            try {
                await interrupt(session, 'Session closing');
                let engine = session.engine;
                if (!engine && session.enginePromise) engine = await deadline(session.enginePromise.catch(() => null), stopMs).catch(() => null);
                if (engine) await deadline(Promise.resolve(engine.close('paseodog-session-close')), stopMs).catch(() => engine.kill?.());
                releaseApprovals(session, 'Session closed');
                flush(session);
            } finally {
                clearTimeout(session.flushTimer);
                session.closed = true;
                session.unsubscribeCrash?.();
                session.release();
            }
        })();
        return session.closePromise;
    }
    async function route(input) {
        switch (input.type) {
            case 'catalog': await refreshCatalog(); emit({ type: 'catalog', requestId: input.requestId, catalog }); return;
            case 'sessions': {
                if (!selected.includes('session.list')) throw new Error('Session listing not negotiated');
                const limit = Math.max(1, Math.min(100, Number(input.limit) || 50));
                const query = String(input.query || '').toLowerCase();
                // 대화가 한 번도 저장되지 않은 빈 저널은 불러올 내용이 없으므로 목록에서 뺀다.
                const rows = store.list().filter((row) => row.items.length && (!input.cwd || row.cwd === input.cwd)).map((row) => {
                    return { ...row, ...sessionDescription(row) };
                }).filter((row) => !query || [row.cwd, row.title, row.description].some((value) => value?.toLowerCase().includes(query)))
                    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, limit);
                emit({ type: 'sessions', requestId: input.requestId, sessions: rows.map((r) => ({
                    persistence: { version: 2, data: { bridgeId: r.id } }, cwd: r.cwd, title: r.title, description: r.description,
                    updatedAt: new Date(r.updatedAt || r.createdAt || Date.now()).toISOString(),
                })) }); return;
            }
            case 'session.open': return openSession(input);
            case 'session.configure': return configureSession(input);
            case 'session.prompt': return promptSession(input);
            case 'session.permission': return acceptPermission(input);
            case 'session.revert': return revertSession(input);
            case 'session.interrupt': await interrupt(sessions.get(input.sessionId)); emit({ type: 'request.completed', requestId: input.requestId }); return;
            case 'session.close': {
                const session = sessions.get(input.sessionId);
                if (session) await closeSession(session);
                sessions.delete(input.sessionId);
                emit({ type: 'session.closed', sessionId: input.sessionId });
                emit({ type: 'request.completed', requestId: input.requestId }); return;
            }
            default: throw new Error(`Unsupported provider input: ${input.type}`);
        }
    }
    return {
        version: 1, capabilities: selected,
        hasSession(id) { return sessions.has(id); },
        sessionAction,
        // 현재 연결이 소유한 세션만 조회하고 종료된 프로세스는 오류 상태로 구분한다.
        async engineStatus() {
            return Promise.all([...sessions.values()].map(async (session) => {
                try {
                    const native = session.engine ? await session.engine.status() : {};
                    const approvals = [...session.permissions.values()];
                    return { id: session.id, bridgeId: session.record.id, running: Boolean(session.active),
                        title: session.config.title || sessionDescription(session.record).title,
                        createdAt: session.record.createdAt,
                        ...native,
                        quota: session.lastQuota || null, quotaResume: session.record.quotaResume || null,
                        state: !session.engine ? 'opening' : session.broken ? 'failed'
                            : approvals.length ? 'waiting-approval' : session.active ? 'running' : 'idle',
                        approvalCount: approvals.length,
                        jobs: (native.jobs || []).map((job) => ({
                            ...job, waitingApproval: approvals.some((approval) => approval.childSessionId === job.sessionId),
                        })),
                    };
                }
                catch { return { id: session.id, bridgeId: session.record.id, state: 'unavailable', jobs: [] }; }
            }));
        },
        async send(input) {
            if (closing || closed) throw new Error('Provider connection closed');
            if (!input || typeof input.type !== 'string') throw new Error('Invalid provider input');
            track(Promise.resolve().then(() => { if (closing) throw new Error('Provider closing'); return route(input); }).catch((error) => rejectRequest(input, error)));
        },
        onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        close() {
            if (closingPromise) return closingPromise;
            closing = true;
            closingPromise = (async () => {
                for (const session of sessions.values()) clearTimeout(session.resumeTimer);
                await Promise.allSettled([...sessions.values()].map(closeSession));
                sessions.clear(); closed = true; listeners.clear();
            })(); return closingPromise;
        },
    };
}

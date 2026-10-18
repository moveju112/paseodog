import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { DEFAULT_MODEL, deadline, errorText, hash, textOf, display, tokenUsage, publicUsage, validateConfig, promptText } from './util.mjs';

export const CAPABILITIES = ['prompt.message', 'prompt.command', 'session.persistence', 'session.list', 'permission'];
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
        models: [{ id: DEFAULT_MODEL, label: 'Mixdog profile default' }, ...routes.map((r) => ({ id: r.id, label: r.label || r.id }))],
        modes: [{ id: 'ask', label: 'Build (approve every tool)' }, { id: 'review', label: 'Review (read tools only)' }],
        thinkingOptions: [], defaultModel: DEFAULT_MODEL, defaultMode: 'ask',
    } };
}
export function createProviderConnection({ capabilities = CAPABILITIES, engineFactory, store,
    loadCatalog,
    env = {}, canonicalPath = (path) => { if (!isAbsolute(path)) throw new Error('cwd must be absolute'); return realpathSync(path); },
    bootMs = 60000, stopMs = 8000, permissionMs = 120000, maxTurnMs = 3600000, flushMs = 250 }) {
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
            label: `${row.label} · ${row.provider}`, effortOptions: row.effortOptions,
        }));
        routes.splice(0, routes.length, ...nativeRoutes,
            ...configuredRoutes.filter((row) => !nativeRoutes.some((native) => native.id === row.id)));
        catalog.models = [{ id: DEFAULT_MODEL, label: 'Mixdog profile default' },
            ...routes.map((row) => ({ id: row.id, label: row.label || row.id, thinkingOptions: row.effortOptions || [] }))];
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
            `Unable to confirm Mixdog process termination: ${session.containmentFailure}. `
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
                notice(session, 'containment-confirmed', 'Mixdog process scope stopped after journal failure', 'warning');
        }).catch((error) => reportContainmentFailure(session, error));
        // The entire promise is observed; a failed systemd kill, synchronous
        // exception or timeout cannot crash the provider process.
    }
    function recordItem(session, item, timestamp = new Date().toISOString()) {
        if (session.closed) return;
        const index = session.record.items.findIndex((row) => row.item.id === item.id);
        const row = { item: structuredClone(item), timestamp };
        if (index < 0) session.record.items.push(row); else session.record.items[index] = row;
        emit({ type: 'timeline.item', sessionId: session.id, ...row });
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
    function identity(session, info) {
        if (session.closed || session.active?.canceled) return;
        if (typeof info.id !== 'string' || !info.id || info.id.length > 200) throw new Error('Invalid native session ID');
        if (session.record.nativeSessionId && session.record.nativeSessionId !== info.id) throw new Error('Native session changed unexpectedly');
        session.record.nativeSessionId = info.id;
        if (info.state?.model) session.record.nativeRoute = {
            model: info.state.model, provider: info.state.provider, effort: info.state.effort,
        };
        flush(session);
        if (info.state?.model) {
            emit({ type: 'session.config', sessionId: session.id, config: {
                model: info.state.model, mode: session.config.mode || 'ask',
                models: [{ id: info.state.model, label: info.state.model }], modes: catalog.modes, thinkingOptions: [], settings: [],
            } });
        }
    }
    async function openSession(input) {
        await refreshCatalog();
        if (sessions.has(input.sessionId)) throw new Error('Session already exists');
        if (!selected.includes('prompt.message')) throw new Error('prompt.message was not negotiated');
        if (input.persistence && !selected.includes('session.persistence')) throw new Error('Persistence was not negotiated');
        const config = validateConfig(structuredClone(input.config));
        if (!config.persist) throw new Error('Mixdog uses durable sessions; PaseoDog requires persist:true');
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
        } catch (error) { release(); throw error; }
        const model = config.model || DEFAULT_MODEL;
        const route = model === DEFAULT_MODEL && profileRoute ? profileRoute : routes.find((row) => row.id === model);
        if (model !== DEFAULT_MODEL && !route && model !== record.nativeRoute?.model && !config.providerOptions?.model) { release(); throw new Error('Unknown model route; configure PASEODOG_MODELS or providerOptions'); }
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
                const receipt = record.receipts[uncertain.receiptKey];
                if (receipt) receipt.state = 'uncertain';
                record.active = null; flush(session);
            }
            const requestedRoute = { provider: config.providerOptions?.provider || route?.provider || env.PASEODOG_PROVIDER || undefined,
                    model: config.providerOptions?.model || route?.model || env.PASEODOG_MODEL || undefined,
                    effort: config.providerOptions?.effort || config.thinkingOption || route?.effort || (!profileRoute ? env.PASEODOG_EFFORT : undefined),
                    ...(profileRoute ? { autoEffort: profileRoute.autoEffort, fast: profileRoute.fast } : {
                        ...(env.PASEODOG_AUTO_EFFORT === 'false' ? { autoEffort: false } : {}),
                        ...(env.PASEODOG_FAST === 'false' ? { fast: false } : {}) }) };
            if (record.nativeSessionId && record.nativeRoute) {
                if (loadCatalog && !Object.keys(config.providerOptions || {}).length && (model === DEFAULT_MODEL || model === record.nativeRoute.model)
                    && !config.thinkingOption) Object.assign(requestedRoute, record.nativeRoute);
                for (const key of ['provider', 'model', 'effort']) {
                    if (requestedRoute[key] !== undefined && requestedRoute[key] !== record.nativeRoute[key])
                        throw new Error(`Cannot change native ${key} while restoring; create a new session`);
                }
            }
            const args = { config, nativeSessionId: record.nativeSessionId, route: record.nativeSessionId && record.nativeRoute ? record.nativeRoute : requestedRoute };
            const created = Promise.resolve().then(() => engineFactory.create(args, { signal: session.bootController.signal }));
            // Late boot results are disposed even if the caller has timed out or closed.
            void created.then((engine) => { if (session.closed || session.broken) return engine.close('late-open'); }).catch(() => {});
            session.enginePromise = deadline(created, bootMs, 'Engine startup timed out');
            session.engine = await session.enginePromise;
            // A child that dies after opening is not an ordinary model error.
            // Do not queue another turn against its dead IPC transport.
            session.unsubscribeCrash = session.engine.onCrash?.((error) => {
                failSession(session, `Mixdog worker exited: ${errorText(error)}`);
            }) || null;
            if (session.broken) throw new Error('Mixdog engine exited during session open');
            if (session.closed || session.closing || closing) { await closeSession(session); return; }
            emit({ type: 'session.opened', requestId: input.requestId, sessionId: session.id,
                capabilities: selected, restoration: 'core', persistence: persistence(session), cwd: config.cwd, title: config.title });
            emit({ type: 'session.config', sessionId: session.id, config: { model, mode: config.mode || 'ask',
                models: catalog.models, modes: catalog.modes, thinkingOptions: [], settings: [] } });
            if (selected.includes('prompt.command')) emit({ type: 'session.commands', sessionId: session.id,
                commands: [{ name: 'compact', description: 'Compact idle Mixdog context without starting a new session' }] });
            if (input.history === 'replay') {
                for (const row of record.items) emit({ type: 'timeline.item', sessionId: session.id, ...row });
                if (record.historyTruncated) notice(session, 'history-tail', 'Bridge replay contains the latest bounded history. Paseo and Mixdog retain their own history.');
            }
            if (uncertain) notice(session, 'recovered-uncertain-turn', 'The previous process stopped during a turn. It was NOT replayed. Inspect files before sending a new instruction.');
            emit({ type: 'session.ready', requestId: input.requestId, sessionId: session.id });
        } catch (error) {
            session.broken = true;
            try { await closeSession(session); } catch { /* preserve the originating error */ }
            sessions.delete(session.id);
            throw error;
        }
    }
    function finishTurn(session, turn, state, error) {
        if (turn.finished) return;
        turn.finished = true; clearTimeout(turn.timer);
        releaseApprovals(session, `Turn ${state}`);
        for (const [callId, tool] of turn.tools) {
            if (tool.status === 'running') recordItem(session, { ...tool, status: state === 'completed' ? 'failed' : 'canceled',
                error: state === 'completed' ? 'Missing final tool result' : null });
        }
        const receipt = session.record.receipts[turn.receiptKey];
        if (receipt) { receipt.state = state; receipt.usage = turn.usage; }
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
        const id = randomUUID();
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                session.permissions.delete(id);
                emit({ type: 'session.permission_resolved', sessionId: session.id, permissionId: id });
                resolve({ approved: false, reason: 'Approval timed out; no action was authorized' });
            }, permissionMs);
            session.permissions.set(id, { resolve, timer, turnId: turn.id,
                childSessionId: info?.childSessionId || null, tool: String(info?.name || 'tool') });
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
        const validAllow = response.behavior === 'allow' && (!response.selectedActionId || response.selectedActionId === 'allow-once') && !response.updatedInput && !response.updatedPermissions;
        clearTimeout(pending.timer); session.permissions.delete(input.permissionId);
        pending.resolve(validAllow ? { approved: true } : { approved: false, reason: response.message || 'Denied or unsupported permission change' });
        emit({ type: 'session.permission_resolved', sessionId: session.id, permissionId: input.permissionId });
        if (response.interrupt) void interrupt(session);
    }
    function callbacksFor(session, turn) {
        const live = () => !closed && !session.closed && !session.closing && !session.broken && !turn.canceled && !turn.finished;
        let segment = 0, text = '', segmentClosed = false, lastCommitted = '';
        let reasoning = '';
        const push = () => recordItem(session, { type: 'assistant_message', id: `assistant:${turn.id}:${segment}`, text });
        function setText(value, append = false) {
            if (!live()) return;
            if (segmentClosed) { segment++; text = ''; segmentClosed = false; }
            const next = append ? text + value : value;
            if (!append && text && !next.startsWith(text)) {
                // Paseo maps same-ID text snapshots to append-only deltas. Replacing
                // an already visible prefix would duplicate text on mobile/CLI.
                notice(session, `assistant-prefix-mismatch:${turn.id}:${segment}`,
                    'Mixdog final output did not extend the streamed reply; visible text was preserved. Inspect the native transcript.');
                return;
            }
            if (next.length > 1024 * 1024) throw new Error('Assistant output exceeds bridge safety limit');
            if (next === text) return;
            text = next; push();
        }
        function toolStart(call) {
            if (!live() || !call?.id) return;
            const key = String(call.id); if (turn.tools.has(key)) return;
            segmentClosed = true; lastCommitted = text;
            const tool = { type: 'tool_call', id: `tool:${turn.id}:${key}`, callId: key,
                name: String(call.name || call.toolName || 'tool'), status: 'running', error: null,
                detail: { type: 'plain_text', text: display(call.arguments || call.args) } };
            turn.tools.set(key, tool); recordItem(session, tool);
        }
        return {
            onIdentity: (info) => identity(session, info),
            onTextDelta: (chunk) => setText(String(chunk || ''), true),
            // The upstream snapshot-to-delta adapter cannot express text deletion.
            // Never acknowledge a reset that clients cannot actually apply.
            onTextReset: () => false,
            onAssistantText: (full) => {
                if (!live() || typeof full !== 'string') return;
                if (segmentClosed && full === lastCommitted) return;
                setText(full); lastCommitted = full;
            },
            onReasoningDelta: (chunk) => { if (!live()) return; reasoning += String(chunk || '');
                reasoning = reasoning.slice(-128 * 1024);
                recordItem(session, { type: 'reasoning', id: `reasoning:${turn.id}`, text: reasoning }); },
            onToolCall: (_iter, calls) => { for (const call of calls || []) toolStart(call); },
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
                turn.tools.set(key, tool); recordItem(session, tool);
            },
            onToolApproval: (info) => requestPermission(session, turn, info),
            onUsageDelta: (delta) => {
                if (!live()) return; turn.usage = tokenUsage(delta, turn.usage);
                emit({ type: 'session.usage', sessionId: session.id, turnId: turn.id, usage: publicUsage(turn.usage) });
            },
            onCompactEvent: (event) => {
                if (!live()) return;
                // Preserve unknown native event variants as notices, never invent counters.
                notice(session, `native-compact:${turn.id}`, `Mixdog compaction: ${display(event, 1000)}`, 'info');
            },
            final(value) { const full = textOf(value); if (full && full !== text && full !== lastCommitted) setText(full); },
        };
    }
    async function promptSession(input) {
        const session = sessions.get(input.sessionId);
        if (!session || session.closed || session.closing) throw new Error('Session not found or closing');
        if (session.broken) throw new Error('Session engine failed; reopen the session before sending another instruction');
        const parsed = promptText(input.prompt);
        if (parsed.command && !selected.includes('prompt.command')) throw new Error('Commands not negotiated');
        const receiptKey = hash(input.prompt.clientMessageId), requestHash = hash(parsed);
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
                if (previous.state !== 'running') emit({ type: 'session.turn', sessionId: session.id, turnId: previous.turnId, state: previous.state });
            }
            return;
        }
        if (session.acked.has(input.prompt.clientMessageId)) return;
        if (session.active) throw new Error('Another turn is running; interrupt or wait before sending another message');
        const turn = { id: randomUUID(), receiptKey, canceled: false, finished: false, accepted: false, engine: null, tools: new Map(), usage: tokenUsage({}), timer: null, work: null };
        session.active = turn;
        try {
            turn.engine = await session.enginePromise;
            if (session.closing || session.closed || turn.canceled) throw new Error('Session closed or interrupted during startup');
            const result = { type: 'turn', turnId: turn.id };
            session.record.receipts[receiptKey] = { hash: requestHash, turnId: turn.id, state: 'running', result };
            session.record.active = { turnId: turn.id, receiptKey };
            flush(session); // Durable receipt BEFORE inference; never automatically replay an uncertain write.
            turn.accepted = true;
            ack(session, input.prompt, result);
            emit({ type: 'session.turn', sessionId: session.id, turnId: turn.id, state: 'started' });
            recordItem(session, { type: 'user_message', id: `user:${receiptKey}`, clientMessageId: input.prompt.clientMessageId, text: parsed.command ? '/compact' : parsed.text });
            const callbacks = callbacksFor(session, turn);
            turn.timer = setTimeout(() => { void interrupt(session, 'Maximum turn duration reached'); }, maxTurnMs);
            turn.work = parsed.command ? turn.engine.compact(callbacks) : turn.engine.ask(parsed.text, callbacks);
            const answer = await turn.work;
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
                    notice(session, `compact:${turn.id}`, `Compaction result: ${display(answer?.result || answer, 1000)}`, 'info');
                } else callbacks.final(answer?.result?.content ?? answer?.content ?? '');
            }
            finishTurn(session, turn, turn.canceled ? 'canceled' : 'completed');
        } catch (error) {
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
        } finally {
            clearTimeout(turn.timer);
            if (session.active === turn) session.active = null;
        }
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
                const rows = store.list().filter((row) => (!input.cwd || row.cwd === input.cwd) && (!query || row.cwd.toLowerCase().includes(query)))
                    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, limit);
                emit({ type: 'sessions', requestId: input.requestId, sessions: rows.map((r) => ({
                    persistence: { version: 2, data: { bridgeId: r.id } }, cwd: r.cwd, title: r.cwd.split('/').pop() || r.cwd,
                    updatedAt: new Date(r.updatedAt || r.createdAt || Date.now()).toISOString(),
                })) }); return;
            }
            case 'session.open': return openSession(input);
            case 'session.prompt': return promptSession(input);
            case 'session.permission': return acceptPermission(input);
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
        // 현재 연결이 소유한 세션만 조회하고 종료된 프로세스는 오류 상태로 구분한다.
        async engineStatus() {
            return Promise.all([...sessions.values()].map(async (session) => {
                try {
                    const native = session.engine ? await session.engine.status() : {};
                    const approvals = [...session.permissions.values()];
                    return { id: session.id, running: Boolean(session.active),
                        ...native,
                        state: !session.engine ? 'opening' : session.broken ? 'failed'
                            : approvals.length ? 'waiting-approval' : session.active ? 'running' : 'idle',
                        approvalCount: approvals.length,
                        jobs: (native.jobs || []).map((job) => ({
                            ...job, waitingApproval: approvals.some((approval) => approval.childSessionId === job.sessionId),
                        })),
                    };
                }
                catch { return { id: session.id, state: 'unavailable' }; }
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
                await Promise.allSettled([...sessions.values()].map(closeSession));
                sessions.clear(); closed = true; listeners.clear();
            })(); return closingPromise;
        },
    };
}

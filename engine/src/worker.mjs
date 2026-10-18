import { createNativeEngine } from './native-engine.mjs';
import { createJsonLineDecoder, encodeFrame } from '../../plugin/server/json-lines.mjs';
import { deferred, deadline, errorText, plainObject, display } from '../../plugin/server/util.mjs';

// Only UI-safe projections cross the wire. The original result stays inside
// Mixdog's agent loop and is never modified by this presentation boundary.
const PREVIEW_CHARS = 16 * 1024;
const CHUNK_CHARS = 32 * 1024;
const ANSWER_PREVIEW_CHARS = 256 * 1024;
function projectedCall(call) {
    return { id: String(call?.id || '').slice(0, 200),
        name: String(call?.name || call?.toolName || 'tool').slice(0, 200),
        // The Paseo timeline needs a preview, not megabytes of tool arguments.
        args: display(call?.args ?? call?.arguments, PREVIEW_CHARS) };
}
export function projectToolResult(result) {
    return { toolCallId: String(result?.toolCallId || '').slice(0, 200),
        toolName: String(result?.toolName || '').slice(0, 200),
        toolKind: String(result?.toolKind || '').slice(0, 100),
        isError: result?.isError === true,
        __earlyNotify: result?.__earlyNotify === true,
        content: display(result?.content, PREVIEW_CHARS) };
}
export function compactSummary(value) {
    const summary = {};
    for (const key of ['changed', 'skipped']) {
        if (typeof value?.[key] === 'boolean') summary[key] = value[key];
    }
    for (const key of ['beforeTokens', 'afterTokens', 'preTokens', 'postTokens']) {
        if (Number.isFinite(value?.[key]) && value[key] >= 0) summary[key] = value[key];
    }
    const delta = value?.usageDelta;
    if (delta && typeof delta === 'object') {
        summary.usageDelta = {};
        for (const key of ['deltaInput', 'deltaOutput', 'deltaCachedRead', 'deltaCacheWrite']) {
            if (Number.isFinite(delta[key]) && delta[key] >= 0) summary.usageDelta[key] = delta[key];
        }
    }
    if (typeof value?.reason === 'string') summary.reason = value.reason.slice(0, 1000);
    return summary;
}
export function serveWorker({ input, output, engineFactory = createNativeEngine, onExit = () => {}, closeMs = 8000 }) {
    let engine, opened = false, opening = false, closing = false, active = null, nextPermission = 0;
    let terminalWrite = Promise.resolve(), queueBytes = 0;
    const permissions = new Map();
    function write(value) {
        const data = encodeFrame(value); queueBytes += Buffer.byteLength(data);
        if (queueBytes > 8 * 1024 * 1024) throw new Error('IPC consumer is too slow');
        const done = terminalWrite.then(() => new Promise((resolve, reject) => {
            output.write(data, (error) => error ? reject(error) : resolve());
        })).finally(() => { queueBytes -= Buffer.byteLength(data); });
        terminalWrite = done.catch(() => {});
        void done.catch(() => stop('IPC write failure'));
    }
    const reply = (id, value) => write({ v: 1, id, ok: true, value });
    const failed = (id, error) => write({ v: 1, id, ok: false, error: errorText(error) });
    const live = (turn) => !closing && active === turn && !turn.finished && !turn.canceled;
    // Never derive an event's owner from a mutable global token on callback.
    const turnEvent = (turn, kind, payload) => {
        if (live(turn)) write({ v: 1, event: kind, token: turn.token, payload });
    };
    function rejectPermissions(reason, turn = null) {
        for (const [id, p] of permissions) {
            if (turn && p.turn !== turn) continue;
            p.resolve({ approved: false, reason });
            permissions.delete(id);
        }
    }
    async function stop(reason) {
        if (closing) return;
        closing = true;
        if (active) active.canceled = true;
        rejectPermissions(reason);
        try { await deadline(Promise.resolve(engine?.abort(reason)), closeMs, 'Worker abort timed out'); } catch {}
        try { await deadline(Promise.resolve(engine?.close(reason)), closeMs, 'Worker close timed out'); } catch {}
        await deadline(terminalWrite, closeMs, 'IPC drain timed out').catch(() => {});
        onExit();
    }
    async function handle(frame) {
        if (!plainObject(frame) || frame.v !== 1 || typeof frame.id !== 'string' || typeof frame.op !== 'string') throw new Error('Invalid RPC envelope');
        const { id, op, args = {} } = frame;
        if (closing) return failed(id, 'Worker closing');
        try {
            if (op === 'open') {
                if (opened || opening) throw new Error('Worker already opened');
                opening = true;
                try {
                    // Host events are deliberately turn-scoped below. Unscoped
                    // engine callbacks may never authorize a tool or a model turn.
                    engine = await engineFactory(args, { emit: () => {} });
                    if (closing) { await engine.close('closed-during-open'); return; }
                    opened = true; reply(id, { nativeSessionId: engine.id || null });
                } finally { opening = false; }
                return;
            }
            if (op === 'close') { reply(id, null); await stop('paseodog-worker-close'); return; }
            if (!engine || !opened) throw new Error('Worker is not open');
            if (op === 'status') { reply(id, await engine.status()); return; }
            if (op === 'auth') {
                try { reply(id, await engine.auth(args)); }
                catch { failed(id, 'Account connection failed; retry from the account screen'); }
                return;
            }
            if (op === 'permission') {
                const permission = permissions.get(args.id);
                if (!permission || permission.token !== args.token || !live(permission.turn)) throw new Error('Stale permission response');
                permissions.delete(args.id);
                permission.resolve(args.approved === true ? { approved: true } : { approved: false, reason: args.reason || 'Denied' });
                reply(id, null); return;
            }
            if (op === 'abort') {
                if (active) active.canceled = true;
                rejectPermissions('Turn interrupted', active);
                await engine.abort('paseodog-interrupt'); reply(id, null); return;
            }
            if (op !== 'ask' && op !== 'compact') throw new Error(`Unsupported worker operation: ${op}`);
            if (active) throw new Error('Worker busy');
            const turn = { token: id, finished: false, canceled: false };
            active = turn;
            try {
                let value;
                if (op === 'compact') value = await engine.compact();
                else {
                    const callbacks = {};
                    const stream = (kind, part) => {
                        if (!live(turn)) return;
                        const text = String(part || '');
                        for (let at = 0; at < text.length; at += CHUNK_CHARS) {
                            turnEvent(turn, kind, [text.slice(at, at + CHUNK_CHARS)]);
                        }
                    };
                    callbacks.onTextDelta = (chunk) => {
                        if (!live(turn)) return;
                        stream('onTextDelta', chunk);
                    };
                    callbacks.onReasoningDelta = (chunk) => stream('onReasoningDelta', chunk);
                    callbacks.onAssistantText = (text) => turnEvent(turn, 'onAssistantText',
                        [display(text, ANSWER_PREVIEW_CHARS)]);
                    callbacks.onIdentity = (info) => turnEvent(turn, 'identity', info);
                    callbacks.onToolCall = (iter, calls) => {
                        if (!live(turn)) return;
                        for (let at = 0; at < (calls || []).length; at += 20) {
                            turnEvent(turn, 'onToolCall', [iter, calls.slice(at, at + 20).map(projectedCall)]);
                        }
                    };
                    callbacks.onAssistantToolCallObserved = (call) => {
                        if (!live(turn)) return;
                        turnEvent(turn, 'onAssistantToolCallObserved', [projectedCall(call)]);
                    };
                    callbacks.onToolResult = (result) => turnEvent(turn, 'onToolResult', [projectToolResult(result)]);
                    callbacks.onUsageDelta = (delta) => turnEvent(turn, 'onUsageDelta', [delta]);
                    callbacks.onCompactEvent = (event) => turnEvent(turn, 'onCompactEvent', [display(event, 4000)]);
                    // Paseo's pinned provider translates assistant snapshots into append-only
                    // deltas. It cannot retract bytes already delivered to a client. Mixdog
                    // explicitly requires an affirmative acknowledgement before replaying
                    // replacement output. Rejecting resets preserves the original partial.
                    callbacks.onTextReset = () => false;
                    callbacks.onToolApproval = async (info) => {
                        if (!live(turn)) return { approved: false, reason: 'Turn no longer active' };
                        // Never present an abbreviated command for approval;
                        // oversized or unserializable command arguments must be denied.
                        try {
                            if (Buffer.byteLength(JSON.stringify(info)) > 128 * 1024)
                                return { approved: false, reason: 'Approval arguments exceed UI safety limit' };
                        } catch {
                            return { approved: false, reason: 'Approval arguments are not serializable' };
                        }
                        const permissionId = `permission_${++nextPermission}`;
                        const pending = deferred();
                        permissions.set(permissionId, { ...pending, token: turn.token, turn });
                        turnEvent(turn, 'permission', { id: permissionId, info });
                        return pending.promise;
                    };
                    value = await engine.ask(args.text, callbacks);
                }
                const result = value?.result || value;
                reply(id, { result: op === 'compact' ? compactSummary(value) :
                    { content: display(result?.content || '', ANSWER_PREVIEW_CHARS),
                        stopReason: result?.stopReason, terminationReason: result?.terminationReason },
                    nativeSessionId: engine.id || null });
            } finally {
                turn.finished = true;
                rejectPermissions('Turn ended', turn);
                if (active === turn) active = null;
            }
        } catch (error) { failed(id, error); }
    }
    const decoder = createJsonLineDecoder((frame) => { void handle(frame).catch((e) => stop(errorText(e))); }, (error) => stop(errorText(error)));
    input.on('data', (chunk) => decoder.write(chunk));
    input.on('end', () => { decoder.end(); void stop('Parent disconnected'); });
    input.on('error', () => stop('Input failure'));
    return { stop };
}

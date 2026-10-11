import { createNativeEngine } from './native-engine.mjs';
import { createJsonLineDecoder, encodeFrame } from '../../plugin/server/json-lines.mjs';
import { deferred, deadline, errorText, plainObject } from '../../plugin/server/util.mjs';

// Keep native context and provider replay outside the UI/control channel.
export function compactSummary(value) {
    const summary = {};
    for (const key of ['changed', 'skipped']) {
        if (typeof value?.[key] === 'boolean') summary[key] = value[key];
    }
    for (const key of ['beforeTokens', 'afterTokens', 'preTokens', 'postTokens']) {
        if (Number.isFinite(value?.[key]) && value[key] >= 0) summary[key] = value[key];
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
    const event = (kind, payload) => { if (!closing) write({ v: 1, event: kind, token: active, payload }); };
    function rejectPermissions(reason) {
        for (const p of permissions.values()) p.resolve({ approved: false, reason });
        permissions.clear();
    }
    async function stop(reason) {
        if (closing) return;
        closing = true; rejectPermissions(reason);
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
                    engine = await engineFactory(args, { emit: event });
                    if (closing) { await engine.close('closed-during-open'); return; }
                    opened = true; reply(id, { nativeSessionId: engine.id || null });
                } finally { opening = false; }
                return;
            }
            if (op === 'close') { reply(id, null); await stop('paseodog-worker-close'); return; }
            if (!engine || !opened) throw new Error('Worker is not open');
            if (op === 'permission') {
                const permission = permissions.get(args.id);
                if (!permission || permission.token !== args.token || active !== args.token) throw new Error('Stale permission response');
                permissions.delete(args.id);
                permission.resolve(args.approved === true ? { approved: true } : { approved: false, reason: args.reason || 'Denied' });
                reply(id, null); return;
            }
            if (op === 'abort') {
                rejectPermissions('Turn interrupted');
                await engine.abort('paseodog-interrupt'); reply(id, null); return;
            }
            if (op !== 'ask' && op !== 'compact') throw new Error(`Unsupported worker operation: ${op}`);
            if (active) throw new Error('Worker busy');
            active = id;
            try {
                let value;
                if (op === 'compact') value = await engine.compact();
                else {
                    const callbacks = {};
                    let streamChars = 0, resettable = true;
                    for (const name of ['onTextDelta', 'onReasoningDelta', 'onAssistantText', 'onToolCall', 'onAssistantToolCallObserved', 'onToolResult', 'onUsageDelta', 'onCompactEvent', 'onStageChange']) {
                        callbacks[name] = (...values) => {
                            if (name === 'onToolCall' || name === 'onAssistantToolCallObserved') { resettable = false; streamChars = 0; }
                            if (name === 'onTextDelta') { resettable = true; streamChars += String(values[0] || '').length; }
                            event(name, values);
                        };
                    }
                    callbacks.onTextReset = (reset) => {
                        const count = Number(reset?.chars);
                        if (!resettable || !Number.isFinite(count) || count <= 0 || count > streamChars) return false;
                        streamChars -= Math.trunc(count); event('onTextReset', [reset]); return true;
                    };
                    callbacks.onToolApproval = async (info) => {
                        const permissionId = `permission_${++nextPermission}`;
                        const pending = deferred();
                        permissions.set(permissionId, { ...pending, token: active });
                        event('permission', { id: permissionId, info });
                        return pending.promise;
                    };
                    value = await engine.ask(args.text, callbacks);
                }
                // Do not serialize native session objects (may contain secrets/cycles).
                const result = value?.result || value;
                reply(id, { result: op === 'compact' ? compactSummary(value) : { content: result?.content || '', stopReason: result?.stopReason, terminationReason: result?.terminationReason }, nativeSessionId: engine.id || null });
            } finally { rejectPermissions('Turn ended'); active = null; }
        } catch (error) { failed(id, error); }
    }
    const decoder = createJsonLineDecoder((frame) => { void handle(frame).catch((e) => stop(errorText(e))); }, (error) => stop(errorText(error)));
    input.on('data', (chunk) => decoder.write(chunk));
    input.on('end', () => { decoder.end(); void stop('Parent disconnected'); });
    input.on('error', () => stop('Input failure'));
    return { stop };
}

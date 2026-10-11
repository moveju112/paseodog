import { createJsonLineDecoder, encodeFrame } from './json-lines.mjs';
import { deferred, deadline, errorText } from './util.mjs';

export function processEngineFactory({ launch, spawnProcess, terminateProcess, timeoutMs = 60000, stopMs = 8000 }) {
    return {
        async create(args, { signal } = {}) {
            if (signal?.aborted) throw new Error('Engine startup canceled');
            if (!launch?.command) throw new Error('paseodog-engine executable not resolved');
            const env = { ...launch.env, ...args.config.env };
            // Do not let project-supplied Node loader injection alter the engine.
            for (const key of ['NODE_OPTIONS', 'NODE_PATH']) delete env[key];
            const child = spawnProcess(launch.command, [...launch.args, '--stdio'], { env, cwd: args.config.cwd, stdio: 'pipe' });
            let sequence = 0, dead = false, closing = false, nativeId = args.nativeSessionId || '', activeCallbacks = null, activeToken = null;
            const pending = new Map();
            const exited = deferred();
            function failAll(error) {
                if (dead) return;
                dead = true;
                for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); }
                pending.clear();
            }
            function send(op, body = {}, { waitMs = timeoutMs, callbacks } = {}) {
                if (dead || (closing && op !== 'close')) return Promise.reject(new Error('Engine process unavailable'));
                const id = `rpc_${++sequence}`, p = deferred();
                if (callbacks) { activeCallbacks = callbacks; activeToken = id; }
                const timer = waitMs ? setTimeout(() => {
                    if (!pending.has(id)) return;
                    pending.delete(id); p.reject(new Error(`Engine ${op} timed out`));
                    failAll(new Error('Engine timed out; no automatic retry'));
                    terminateProcess(child);
                }, waitMs) : null;
                pending.set(id, { ...p, timer });
                try {
                    child.stdin.write(encodeFrame({ v: 1, id, op, args: body }), (error) => {
                        if (error) { failAll(error); terminateProcess(child); }
                    });
                } catch (error) { failAll(error); terminateProcess(child); }
                return p.promise.finally(() => {
                    if (activeToken === id) { activeToken = null; activeCallbacks = null; }
                });
            }
            const decoder = createJsonLineDecoder((frame) => {
                if (frame.v !== 1) throw new Error('Worker protocol mismatch');
                if (frame.event) {
                    if (!activeCallbacks || frame.token !== activeToken) return;
                    if (frame.event === 'identity') {
                        nativeId = frame.payload.id;
                        activeCallbacks.onIdentity?.(frame.payload);
                        return;
                    }
                    if (frame.event === 'permission') {
                        const callbacks = activeCallbacks, token = activeToken;
                        Promise.resolve().then(() => callbacks.onToolApproval?.(frame.payload.info))
                            .then((answer) => send('permission', { id: frame.payload.id, token,
                                approved: answer?.approved === true, reason: answer?.reason || '' }))
                            .catch(() => { /* canceled or stale approvals cannot grant access */ });
                        return;
                    }
                    const callback = activeCallbacks[frame.event];
                    if (typeof callback === 'function' && Array.isArray(frame.payload)) callback(...frame.payload);
                    return;
                }
                const p = pending.get(frame.id);
                if (!p) return;
                pending.delete(frame.id); clearTimeout(p.timer);
                if (frame.ok === true) {
                    if (frame.value?.nativeSessionId) nativeId = frame.value.nativeSessionId;
                    p.resolve(frame.value);
                } else p.reject(new Error(String(frame.error || 'Worker request failed')));
            }, (error) => { failAll(error); terminateProcess(child); });
            const onAbort = () => { failAll(new Error('Engine startup canceled')); terminateProcess(child); };
            signal?.addEventListener('abort', onAbort, { once: true });
            if (signal?.aborted) onAbort();
            child.stdout.on('data', (chunk) => decoder.write(chunk));
            child.stdin.on('error', (error) => { failAll(error); terminateProcess(child); });
            child.on('error', (error) => { failAll(error); exited.resolve(); });
            child.on('close', (code, signal) => {
                decoder.end(); failAll(new Error(`Engine exited (${signal || code}); request outcome may be uncertain`)); exited.resolve();
            });
            // Drain but never copy potentially credential-bearing upstream logs to mobile or console.
            child.stderr.on('data', () => {});
            try { await send('open', args); }
            catch (error) { terminateProcess(child); await deadline(exited.promise, stopMs).catch(() => {}); throw error; }
            finally { signal?.removeEventListener('abort', onAbort); }
            return {
                get id() { return nativeId; },
                ask(text, callbacks) { return send('ask', { text }, { waitMs: 0, callbacks }); },
                compact(callbacks = {}) { return send('compact', {}, { waitMs: 0, callbacks }); },
                async abort() { if (!dead) await send('abort', {}, { waitMs: stopMs }); },
                async close() {
                    if (closing) return; closing = true;
                    try { if (!dead) await send('close', {}, { waitMs: stopMs }); } catch {}
                    child.stdin.end();
                    try { await deadline(exited.promise, stopMs); }
                    catch { terminateProcess(child); await deadline(exited.promise, stopMs).catch(() => {}); }
                    failAll(new Error('Engine closed'));
                },
                kill() { terminateProcess(child); failAll(new Error('Engine forcibly stopped')); },
            };
        },
    };
}

import { createJsonLineDecoder, encodeFrame } from './json-lines.mjs';
import { deferred, deadline, errorText } from './util.mjs';
import { createProcessScope } from './process-scope.mjs';

/**
 * The child is spawned with detached:true on Unix, so its pid is a dedicated
 * process-group ID. A process-only SIGKILL leaves shell/grandchild processes
 * running after a canceled turn. Never use a negative PID without owning the
 * group via the detached spawn below.
 */
export async function stopEngineProcessGroup(child, terminateProcess, graceMs = 250) {
    if (process.platform === 'win32' || !Number.isInteger(child?.pid) || child.pid < 2) {
        await terminateProcess(child);
        return;
    }
    const signalGroup = (signal) => {
        try { process.kill(-child.pid, signal); return true; }
        catch (error) {
            if (error?.code === 'ESRCH') return false;
            if (error?.code === 'EPERM') throw error;
            throw error;
        }
    };
    try {
        if (!signalGroup('SIGTERM')) return;
        await new Promise((resolve) => setTimeout(resolve, graceMs));
        // Kill descendants that ignored SIGTERM, even if the worker itself died.
        signalGroup('SIGKILL');
    } catch (error) {
        await terminateProcess(child);
        if (error?.code !== 'ESRCH') throw error;
    }
}

export function processEngineFactory({ launch, spawnProcess, terminateProcess, timeoutMs = 60000, stopMs = 8000,
    scopeMode = 'strict', scopeFactory = createProcessScope }) {
    return {
        async create(args, { signal } = {}) {
            if (signal?.aborted) throw new Error('Engine startup canceled');
            if (!launch?.command) throw new Error('paseodog-engine executable not resolved');
            const env = { ...launch.env, ...args.config.env };
            for (const key of ['MIXDOG_HOME', 'MIXDOG_DATA_DIR', 'PASEO_HOME', 'PASEODOG_STATE_DIR']) {
                if (launch.env?.[key] !== undefined) env[key] = launch.env[key];
                else delete env[key];
            }
            for (const key of ['NODE_OPTIONS', 'NODE_PATH']) delete env[key];
            const scope = scopeFactory({ launch, mode: scopeMode });
            // Fail closed before launching an unsupervised native shell. On Linux,
            // systemd --user is mandatory so setpgid() descendants stay in scope.
            await scope.preflight();
            const child = spawnProcess(scope.command, scope.args, {
                env, cwd: args.config.cwd, stdio: 'pipe', detached: scope.detached,
            });
            let sequence = 0, dead = false, closing = false, ready = false;
            let nativeId = args.nativeSessionId || '', activeCallbacks = null, activeToken = null;
            let crashReason = null, stopPromise = null;
            const listeners = new Set(), pending = new Map(), exited = deferred();
            // One termination promise is shared by crash, timeout, explicit
            // close and provider interrupt, so no double-signaling races.
            function terminateScope() {
                if (!stopPromise) stopPromise = scope.stop
                    ? scope.stop() : stopEngineProcessGroup(child, terminateProcess, Math.min(250, stopMs));
                return stopPromise;
            }
            function failAll(error) {
                if (dead) return;
                dead = true;
                for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); }
                pending.clear();
                if (!closing) crashReason = error;
                if (ready && !closing) {
                    for (const listener of listeners) { try { listener(error); } catch {} }
                }
            }
            function failAndStop(error) {
                failAll(error);
                void terminateScope().catch(() => {});
            }
            function send(op, body = {}, { waitMs = timeoutMs, callbacks } = {}) {
                if (dead || (closing && op !== 'close')) return Promise.reject(new Error('Engine process unavailable'));
                const id = `rpc_${++sequence}`, p = deferred();
                if (callbacks) { activeCallbacks = callbacks; activeToken = id; }
                const timer = waitMs ? setTimeout(() => {
                    if (!pending.has(id)) return;
                    pending.delete(id);
                    const error = new Error(`Engine ${op} timed out; side effects may be uncertain`);
                    p.reject(error); failAndStop(error);
                }, waitMs) : null;
                pending.set(id, { ...p, timer });
                try {
                    child.stdin.write(encodeFrame({ v: 1, id, op, args: body }), (error) => {
                        if (error) failAndStop(error);
                    });
                } catch (error) { failAndStop(error); }
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
                            .catch(() => { /* closed/obsolete permissions are never granted */ });
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
            }, (error) => failAndStop(error));
            const onAbort = () => failAndStop(new Error('Engine startup canceled'));
            signal?.addEventListener('abort', onAbort, { once: true });
            if (signal?.aborted) onAbort();
            child.stdout.on('data', (chunk) => decoder.write(chunk));
            child.stdin.on('error', (error) => failAndStop(error));
            const exitError = (code, signalName) => new Error(
                `Engine exited (${signalName || code}); request outcome may be uncertain`
            );
            child.on('error', (error) => { failAndStop(error); exited.resolve(); });
            // 'close' waits for descendant-held pipe handles. 'exit' doesn't:
            // fail outstanding requests and stop the whole scope immediately.
            child.on('exit', (code, signalName) => {
                exited.resolve();
                failAll(exitError(code, signalName));
                void terminateScope().catch((error) => {
                    process.stderr.write(`[paseodog] process scope cleanup failed: ${errorText(error)}\n`);
                });
            });
            child.on('close', (code, signalName) => {
                decoder.end();
                failAll(exitError(code, signalName));
                exited.resolve();
                void terminateScope().catch((error) => {
                    process.stderr.write(`[paseodog] process scope cleanup failed: ${errorText(error)}\n`);
                });
            });
            // Native stdout is the authenticated JSONL channel. Avoid relaying stderr
            // into client-visible errors: diagnostics can include credentials.
            child.stderr.on('data', () => {});
            try { await send('open', args); ready = true; }
            catch (error) { await terminateScope().catch((cleanup) => {
                error.message += `; containment cleanup failed: ${errorText(cleanup)}`;
            }); await deadline(exited.promise, stopMs).catch(() => {}); throw error; }
            finally { signal?.removeEventListener('abort', onAbort); }
            return {
                get id() { return nativeId; },
                onCrash(listener) {
                    listeners.add(listener);
                    if (crashReason) queueMicrotask(() => { if (listeners.has(listener)) listener(crashReason); });
                    return () => listeners.delete(listener);
                },
                ask(text, callbacks) { return send('ask', { text }, { waitMs: 0, callbacks }); },
                compact(callbacks = {}) { return send('compact', {}, { waitMs: 0, callbacks }); },
                async abort() { if (!dead) await send('abort', {}, { waitMs: stopMs }); },
                async close() {
                    if (closing) return;
                    closing = true;
                    try { if (!dead) await send('close', {}, { waitMs: stopMs }); } catch {}
                    child.stdin.end();
                    try { await deadline(exited.promise, stopMs); }
                    catch { await terminateScope().catch(() => {}); await deadline(exited.promise, stopMs).catch(() => {}); }
                    await terminateScope();
                    failAll(new Error('Engine closed'));
                    listeners.clear();
                },
                async kill() {
                    failAll(new Error('Engine forcibly stopped; side effects may be uncertain'));
                    await terminateScope();
                },
            };
        },
    };
}

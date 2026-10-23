import { createJsonLineDecoder, encodeFrame } from './json-lines.mjs';
import { deferred, deadline, errorText, engineEnvironment } from './util.mjs';
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
    launch = { ...launch, env: engineEnvironment(launch) };
    return {
        async create(args, { signal } = {}) {
            if (signal?.aborted) throw new Error('Engine startup canceled');
            if (!launch?.command) throw new Error('paseodog-engine executable not resolved');
            const env = { ...launch.env, ...args.config.env };
            for (const key of ['MIXDOG_HOME', 'MIXDOG_DATA_DIR', 'PASEO_HOME', 'PASEODOG_STATE_DIR', 'OPENAI_OAUTH_CREDENTIALS_PATH']) {
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
            let crashReason = null, stopPromise = null, configuration;
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
            function send(op, body = {}, { waitMs = timeoutMs, callbacks, fatalOnTimeout = true } = {}) {
                if (dead || (closing && op !== 'close')) return Promise.reject(new Error('Engine process unavailable'));
                const id = `rpc_${++sequence}`, p = deferred();
                if (callbacks) { activeCallbacks = callbacks; activeToken = id; }
                const timer = waitMs ? setTimeout(() => {
                    if (!pending.has(id)) return;
                    pending.delete(id);
                    const error = new Error(`Engine ${op} timed out; side effects may be uncertain`);
                    p.reject(error);
                    if (fatalOnTimeout) failAndStop(error);
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
                                approved: answer?.approved === true, reason: answer?.reason || '',
                                ...(answer?.approved === true && Array.isArray(answer.answers) ? { answers: answer.answers } : {}) }))
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
                } else {
                    const error = new Error(String(frame.error || 'Worker request failed'));
                    if (frame.quota) error.quota = frame.quota;
                    p.reject(error);
                }
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
            try { configuration = (await send('open', args)).configuration; ready = true; }
            catch (error) { await terminateScope().catch((cleanup) => {
                error.message += `; containment cleanup failed: ${errorText(cleanup)}`;
            }); await deadline(exited.promise, stopMs).catch(() => {}); throw error; }
            finally { signal?.removeEventListener('abort', onAbort); }
            return {
                get id() { return nativeId; },
                // 워커가 확인한 다음 턴 설정만 읽고 호스트 기본값은 조회하지 않는다.
                configuration() { return configuration; },
                onCrash(listener) {
                    listeners.add(listener);
                    if (crashReason) queueMicrotask(() => { if (listeners.has(listener)) listener(crashReason); });
                    return () => listeners.delete(listener);
                },
                ask(text, callbacks, source, quotaRetry = false) {
                    return send('ask', { text, quotaRetry, ...(source ? { source } : {}) }, { waitMs: 0, callbacks });
                },
                steer(text, source) { return send('steer', { text, token: activeToken, ...(source ? { source } : {}) }, { fatalOnTimeout: false }); },
                compact(callbacks = {}) { return send('compact', {}, { waitMs: 0, callbacks }); },
                status() { return send('status', {}, { waitMs: 5000, fatalOnTimeout: false }); },
                async configure(changes) {
                    // 모델 선택은 네이티브 압축 추론을 포함한다. 수동 압축과 동일하게 RPC 시간 제한으로 죽이지 않는다.
                    const switchesModel = changes.route?.provider !== undefined || changes.route?.model !== undefined;
                    const result = await send('configure', changes, { waitMs: switchesModel ? 0 : timeoutMs });
                    if (result && Object.hasOwn(result, 'autoEffort')) configuration = result;
                    return result;
                },
                auth(request) { return send('auth', request); },
                // 계승 결과의 ID가 현재 워커의 네이티브 ID를 덮어쓰지 않도록 응답을 분리한다.
                async action(request) {
                    return (await send('action', request, { waitMs: 0 })).actionResult;
                },
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

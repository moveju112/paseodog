import { processEngineFactory } from './process-engine.mjs';
import { createJsonLineDecoder, encodeFrame } from './json-lines.mjs';
import { deadline } from './util.mjs';

// 상주형 제어 프로세스와 통신하는 경량 JSONL 클라이언트를 생성한다.
function createControlDaemon({ launch, spawnProcess, terminateProcess }) {
    let child = null, timer = null, seq = 0;
    const pending = new Map();
    function failAll(reason) {
        clearTimeout(timer);
        timer = null;
        const current = child;
        child = null;
        if (current) {
            try { terminateProcess ? terminateProcess(current) : current.kill?.(); } catch {}
        }
        for (const [, entry] of pending) {
            clearTimeout(entry.timeout);
            entry.reject(new Error(reason));
        }
        pending.clear();
    }
    function touch() {
        clearTimeout(timer);
        timer = setTimeout(() => failAll('Control daemon idle timeout'), 600000);
        timer.unref?.();
    }
    function ensureChild() {
        if (child) return child;
        const spawned = spawnProcess(launch.command, [...launch.args, '--controls-stdio'], {
            env: launch.env,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        if (!spawned?.stdin || !spawned?.stdout) throw new Error('Control stdio unavailable');
        const decoder = createJsonLineDecoder((frame) => {
            if (!frame || typeof frame.id !== 'string') return;
            const entry = pending.get(frame.id);
            if (!entry) return;
            pending.delete(frame.id);
            clearTimeout(entry.timeout);
            if (frame.ok) entry.resolve(frame.value);
            else entry.reject(new Error(frame.error || 'Engine settings failed'));
        }, () => failAll('Control daemon decode error'));
        spawned.stdout.on('data', (chunk) => decoder.write(chunk));
        spawned.on?.('error', () => failAll('Control daemon process error'));
        spawned.on?.('exit', () => failAll('Control daemon exited'));
        child = spawned;
        touch();
        return child;
    }
    return {
        request(request, timeoutMs = 30000) {
            const proc = ensureChild();
            touch();
            const id = `ctl_${++seq}`;
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    pending.delete(id);
                    failAll('Control daemon request timed out');
                    reject(new Error('Control daemon request timed out'));
                }, timeoutMs);
                timeout.unref?.();
                pending.set(id, { resolve, reject, timeout });
                try {
                    proc.stdin.write(encodeFrame({ v: 1, id, request }));
                } catch (error) {
                    pending.delete(id);
                    clearTimeout(timeout);
                    failAll('Control daemon write failed');
                    reject(error);
                }
            });
        },
        close() {
            failAll('Control daemon closed');
        },
    };
}

// 엔진 설정 호출을 직렬화하고 모델 카탈로그 캐시는 저장 후 갱신한다.
export function createEngineControls({ execCommand, spawnProcess, terminateProcess }) {
    let launch, cached, queue = Promise.resolve();
    let authentication, authTimer, authQueue = Promise.resolve();
    let controlDaemon = null;
    let statusRequest, lastSessions = [];
    const connections = new Set();

    async function invokeControls(request) {
        if (typeof spawnProcess === 'function') {
            if (!controlDaemon) controlDaemon = createControlDaemon({ launch, spawnProcess, terminateProcess });
            try {
                return await controlDaemon.request(request);
            } catch {
                controlDaemon?.close();
                controlDaemon = null;
            }
        }
        let result;
        try {
            result = await execCommand(launch.command,
                [...launch.args, '--controls', JSON.stringify(request)],
                { env: launch.env, timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
        } catch {
            cached = undefined;
            throw new Error('엔진 설정 호출 실패. 시간 초과 시 저장 여부를 새로고침으로 확인하세요.');
        }
        const value = JSON.parse(result.stdout);
        if (value.error) throw new Error(value.error);
        return value;
    }

    return {
        // 인증 코드는 argv나 로그가 아닌 기존 JSONL 파이프로만 전달한다.
        auth(input) {
            const operation = authQueue.then(async () => {
                if (!launch?.env?.MIXDOG_HOME || !launch.env.MIXDOG_DATA_DIR) throw new Error('Dedicated engine profile required');
                if (!authentication) {
                    authentication = await processEngineFactory({ launch, spawnProcess, terminateProcess }).create({
                        config: { cwd: launch.env.MIXDOG_HOME, mode: 'review', env: {}, mcpServers: {}, settings: {}, persist: true },
                        route: {},
                    });
                }
                clearTimeout(authTimer);
                authTimer = setTimeout(() => { void authentication?.close(); authentication = undefined; }, 660000);
                authTimer.unref?.();
                try {
                    const result = await authentication.auth(input);
                    if (result.state === 'completed') {
                        cached = undefined;
                        controlDaemon?.close();
                        controlDaemon = null;
                    }
                    return result;
                } catch { throw new Error('계정 연결에 실패했어요. 새 로그인으로 다시 시도해 주세요.'); }
            });
            authQueue = operation.catch(() => {});
            return operation;
        },
        async close() {
            clearTimeout(authTimer);
            controlDaemon?.close();
            controlDaemon = null;
            await authQueue;
            await authentication?.close();
            authentication = undefined;
        },
        bind(value) {
            if (!value?.command) return;
            if (launch && JSON.stringify(launch) !== JSON.stringify(value)) {
                cached = undefined;
                controlDaemon?.close();
                controlDaemon = null;
            }
            launch = value;
        },
        register(connection) {
            connections.add(connection);
            return () => connections.delete(connection);
        },
        read(request = {}) {
            const run = queue.then(async () => {
                if (!launch) throw new Error('PaseoDog 공급자를 새로고침한 뒤 다시 열어주세요.');
                const mutation = request.action && request.action !== 'read';
                if (!mutation && !request.refresh && cached) return cached;
                const value = await invokeControls(request);
                cached = value;
                return value;
            });
            queue = run.catch(() => {});
            return run;
        },
        peekSessions() {
            void this.sessions().catch(() => {});
            return lastSessions;
        },
        async sessions() {
            if (!statusRequest) {
                statusRequest = deadline(
                    Promise.all([...connections].map((connection) => connection.engineStatus()))
                        .then((rows) => {
                            lastSessions = rows.flat();
                            return lastSessions;
                        }),
                    1500,
                    'Session status timeout',
                ).catch(() => lastSessions).finally(() => { statusRequest = undefined; });
            }
            return statusRequest;
        },
    };
}

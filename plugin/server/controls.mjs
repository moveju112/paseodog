import { processEngineFactory } from './process-engine.mjs';
import { createJsonLineDecoder, encodeFrame } from './json-lines.mjs';
import { deadline } from './util.mjs';
import { createQuotaRefreshPolicy } from './quota-refresh.mjs';

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
    let launch, queue = Promise.resolve();
    let authentication, authTimer, authQueue = Promise.resolve();
    let controlDaemon = null;
    let statusRequest, lastSessions = [];
    const connections = new Set();
    const statusRows = new Map();
    const quotaRefresh = createQuotaRefreshPolicy();

    async function invokeControls(request) {
        if (typeof spawnProcess === 'function') {
            if (!controlDaemon) controlDaemon = createControlDaemon({ launch, spawnProcess, terminateProcess });
            try {
                return await controlDaemon.request(request);
            } catch (error) {
                controlDaemon?.close();
                controlDaemon = null;
                if (request.action && request.action !== 'read') {
                    throw new Error('설정 저장 결과를 확인할 수 없어요. 새로고침으로 확인하세요.', { cause: error });
                }
            }
        }
        let result;
        try {
            result = await execCommand(launch.command,
                [...launch.args, '--controls', JSON.stringify(request)],
                { env: launch.env, timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
        } catch {
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
                    if (result.state === 'completed' || ['selectAccount', 'logout', 'saveApiKey'].includes(input.action)) {
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
                controlDaemon?.close();
                controlDaemon = null;
            }
            launch = value;
        },
        register(connection) {
            connections.add(connection);
            return () => { connections.delete(connection); statusRows.delete(connection); };
        },
        // 세션 ID가 유일한 연결에만 전달하고 실패·시간 초과 요청은 재시도하지 않는다.
        sessionAction(request) {
            const owners = [...connections].filter((connection) => connection.hasSession(request.sessionId));
            if (owners.length !== 1) throw new Error('세션 소유 연결을 확인할 수 없어요. 세션을 다시 열어 주세요.');
            return owners[0].sessionAction(request);
        },
        read(request = {}) {
            const run = queue.then(async () => {
                if (!launch) throw new Error('PaseoDog 공급자를 새로고침한 뒤 다시 열어주세요.');
                return await invokeControls(request);
            });
            queue = run.catch(() => {});
            return run;
        },
        // 설정 스냅샷 캐시를 건드리지 않고 Mixdog의 사용량 캐시·갱신 경로를 호출한다.
        usage() {
            const run = queue.then(async () => {
                if (!launch) throw new Error('PaseoDog 공급자를 새로고침한 뒤 다시 열어주세요.');
                return await invokeControls({ action: 'usage' });
            });
            queue = run.catch(() => {});
            return run;
        },
        // 통계는 설정 캐시와 분리해 명시한 기간마다 네이티브 원장에서 조회한다.
        // OAuth 할당량 실시간 갱신은 호스트 공용 정책이 허용할 때만 요청한다.
        metrics(request = {}) {
            const { refresh, ...period } = request;
            const startedAt = quotaRefresh.admit(refresh);
            const run = queue.then(async () => {
                if (!launch) throw new Error('PaseoDog 공급자를 새로고침한 뒤 다시 열어주세요.');
                return await invokeControls({ ...period, refresh: startedAt !== null, action: 'metrics' });
            });
            if (startedAt !== null) run.then((value) => quotaRefresh.settle(startedAt, value), () => quotaRefresh.settle(startedAt, null));
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
                    Promise.all([...connections].map(async (connection) => {
                        try {
                            const rows = await deadline(connection.engineStatus(), 1500, 'Session status timeout');
                            statusRows.set(connection, rows);
                            return rows;
                        } catch {
                            const previous = statusRows.get(connection) || [];
                            return previous.length
                                ? previous.map(({ id, bridgeId }) => ({ id, bridgeId, state: 'unavailable', jobs: [] }))
                                : [{ state: 'unavailable', jobs: [] }];
                        }
                    }))
                        .then((rows) => {
                            lastSessions = rows.flat();
                            return lastSessions;
                        }),
                    2000,
                    'Session status timeout',
                ).catch(() => lastSessions.map(({ id, bridgeId }) =>
                    ({ id, bridgeId, state: 'unavailable', jobs: [] }))).finally(() => { statusRequest = undefined; });
            }
            return statusRequest;
        },
    };
}

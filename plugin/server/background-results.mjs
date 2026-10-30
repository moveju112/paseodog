import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { JournalStore } from './journal.mjs';
import { agentsBySession } from './turn-recovery.mjs';
import { hash } from './util.mjs';

const TERMINAL = new Set(['completed', 'failed', 'canceled']);
const LABELS = { completed: '성공', failed: '실패', canceled: '취소', unknown: '결과 불명' };
const LOST = 'daemon restarted while this shell task was running; its outcome was lost.';
const MAX_TASKS = 1000;

// 결과 데이터만 저장한다. 명령·로그·URL·서버 오류 원문을 채팅에 복제하지 않는다.
export function resultItem(task, status) {
    const id = `background-result:${hash({ key: task.key, status })}`;
    const origin = task.surface === 'remote' ? `원격 작업 ${task.jobId}`
        : task.surface === 'delivery' ? `배포 ${task.jobId}` : '백그라운드 명령 실행 결과';
    const message = `${origin}: ${LABELS[status]}.`
        + (status === 'unknown' ? ' 상태 확인이 필요하며 원래 명령은 자동 재실행하지 않았어.' : '');
    return { type: 'notification', id, level: status === 'failed' || status === 'unknown' ? 'warning' : 'info', message };
}

export function saveObservation(record, task, status, now = Date.now()) {
    const rows = [];
    if (!['running', 'unknown', ...TERMINAL].includes(status)) throw new Error('Invalid background result');
    if (status !== 'running') {
        const item = resultItem(task, status), key = hash(item.id);
        if (!record.receipts[key]) {
            const row = { item, timestamp: new Date(now).toISOString() };
            record.items.push(row);
            // 보고 receipt는 추론 receipt와 분리하며 journal 저장만을 확인한다.
            record.receipts[key] = { hash: hash({ task: task.key, status }), state: 'completed',
                result: { type: 'background-report', journalSavedAt: now, clientReceived: null, ai: 'not-requested' } };
            rows.push(row);
        }
    }
    task.status = status;
    task.observedAt = now;
    return rows;
}

export function revokeBackgroundWork(record) {
    record.backgroundEpoch = (record.backgroundEpoch || 0) + 1;
    for (const task of Object.values(record.backgroundTasks || {})) {
        if (task.surface === 'remote' && !TERMINAL.has(task.status)) task.revoked = true;
    }
}

function alive(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    try { process.kill(pid, 0); return true; }
    catch (error) { return error.code === 'EPERM'; }
}

export function shellObservation(job, isAlive = alive) {
    if (job.foreground || typeof job.ownerSessionId !== 'string' || typeof job.jobId !== 'string') return null;
    if (job.terminationUnconfirmed || String(job.error || '').startsWith(LOST)) return 'unknown';
    if (['canceled', 'cancelled'].includes(job.status)) return 'canceled';
    if (job.status === 'running') return isAlive(job.pid) ? 'running' : 'unknown';
    if (Number.isInteger(job.exitCode)) return job.exitCode === 0 ? 'completed' : 'failed';
    if (job.status === 'failed') return 'failed';
    return 'unknown';
}

function statusUrl(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash)
        throw new Error('Status endpoint must be HTTPS without userinfo or fragment');
    return url.href;
}

// 등록 시 승인된 고정 GET만 수행한다. redirect·명령 실행·임의 재등록은 지원하지 않는다.
export async function probeRemote(task, { fetchStatus = fetch, timeoutMs = 5000 } = {}) {
    const response = await fetchStatus(task.url, { method: 'GET', redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('Remote status unavailable');
    let size = 0;
    const chunks = [];
    for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 65536) throw new Error('Remote status exceeds limit');
        chunks.push(Buffer.from(chunk));
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (data.jobId !== task.jobId || !['running', ...TERMINAL].includes(data.status))
        throw new Error('Remote status identity or schema mismatch');
    return data.status;
}

/** @param {{stateRoot: string, paseoHome: string, dataRoot: string, controls?: object, store?: JournalStore,
 * fetchStatus?: typeof fetch, now?: () => number, isAlive?: (pid: number) => boolean, log?: (message: string) => void}} options */
export function createBackgroundResults({ stateRoot, paseoHome, dataRoot, controls,
    store = new JournalStore(stateRoot), fetchStatus, now = Date.now, isAlive = alive,
    log = console.error } = {}) {
    let running = false, disposed = false;
    // 현재 연결은 메모리 저널을 소유한다. 다른 writer의 파일을 직접 덮어쓰지 않는다.
    function update(bridgeId, mutate) {
        const live = controls?.backgroundRecord(bridgeId, mutate);
        if (live !== undefined) return live.value;
        const release = store.acquire(bridgeId);
        try {
            const record = store.load(bridgeId);
            const result = mutate(record);
            if (result.changed) store.save(record);
            return result.value;
        } finally { release(); }
    }
    function owner(agentId) {
        const entry = [...agentsBySession(paseoHome)].find(([, id]) => id === agentId);
        if (!entry) throw new Error('Active top-level recipient not found');
        return entry[0];
    }
    function snapshot(bridgeId) {
        return update(bridgeId, record => ({ value: structuredClone(record.backgroundTasks || {}), changed: false }));
    }
    async function request(input) {
        const bridgeId = owner(input.agentId);
        return update(bridgeId, record => {
            record.backgroundTasks ||= {};
            if (input.action === 'status') {
                return { changed: false, value: { tasks: Object.values(record.backgroundTasks)
                    .map(({ url, ...task }) => ({ ...task, ai: 'not-requested', clientReceived: null })) } };
            }
            if (input.action === 'delivery') {
                const task = { key: input.eventId, surface: 'delivery', jobId: input.jobId };
                const rows = saveObservation(record, task, input.status);
                return { changed: rows.length > 0, rows, value: { journalSaved: true,
                    epoch: record.backgroundEpoch || 0, clientReceived: null } };
            }
            const key = hash({ surface: 'remote', jobId: input.jobId });
            if (input.action === 'cancel') {
                const task = record.backgroundTasks[key];
                if (!task) throw new Error('Registered remote job not found');
                task.revoked = true;
                const rows = saveObservation(record, task, 'unknown', now());
                return { changed: true, rows, value: { monitoring: 'canceled', remoteCanceled: false } };
            }
            if (input.action !== 'register' || input.confirmed !== true) throw new Error('Explicit monitoring authorization required');
            const url = statusUrl(input.url);
            const old = record.backgroundTasks[key];
            if (old) {
                if (old.url !== url || old.revoked || old.epoch !== (record.backgroundEpoch || 0))
                    throw new Error('Remote job registration changed or revoked; use a new job identity');
                return { changed: false, value: { registered: true, key } };
            }
            if (Object.keys(record.backgroundTasks).length >= MAX_TASKS) throw new Error('Background ledger full');
            record.backgroundTasks[key] = { key, surface: 'remote', jobId: input.jobId, url,
                epoch: record.backgroundEpoch || 0, status: 'running', failures: 0, nextCheckAt: 0 };
            return { changed: true, value: { registered: true, key } };
        });
    }
    async function scan() {
        if (running || disposed) return;
        running = true;
        try {
            const recipients = agentsBySession(paseoHome);
            const byOwner = new Map();
            let names;
            try { names = await readdir(join(dataRoot, 'shell-jobs')); }
            catch (error) { if (error.code !== 'ENOENT') throw error; names = []; }
            for (const name of names) {
                if (!/^job_[a-zA-Z0-9_-]+\.json$/.test(name)) continue;
                try {
                    const path = join(dataRoot, 'shell-jobs', name), info = await lstat(path);
                    if (!info.isFile() || info.isSymbolicLink() || info.size > 262144) continue;
                    const job = JSON.parse(await readFile(path, 'utf8'));
                    if (`${job.jobId}.json` !== name || shellObservation(job, isAlive) === null) continue;
                    const jobs = byOwner.get(job.ownerSessionId) || [];
                    jobs.push(job); byOwner.set(job.ownerSessionId, jobs);
                } catch (error) {
                    if (error.code !== 'ENOENT') log('[paseodog] background source unreadable; no command was replayed');
                }
            }
            for (const summary of store.listSummaries()) {
                if (disposed) break;
                if (!recipients.has(summary.id)) continue;
                const jobs = byOwner.get(summary.nativeSessionId) || [];
                if (!jobs.length && !summary.backgroundTracked) continue;
                try {
                    update(summary.id, record => {
                        const rows = [];
                        let changed = false;
                        record.backgroundTasks ||= {};
                        for (const job of jobs) {
                            if (job.ownerSessionId !== record.nativeSessionId) continue;
                            const key = hash({ surface: 'shell', jobId: job.jobId });
                            let task = record.backgroundTasks[key];
                            if (!task) {
                                if (Object.keys(record.backgroundTasks).length >= MAX_TASKS) throw new Error('Background ledger full');
                                task = record.backgroundTasks[key] = { key, surface: 'shell', jobId: job.jobId };
                            }
                            const status = shellObservation(job, isAlive);
                            if (task.status !== status) { rows.push(...saveObservation(record, task, status, now())); changed = true; }
                        }
                        for (const task of Object.values(record.backgroundTasks)) {
                            if (task.surface === 'shell' && task.status === 'running'
                                && !jobs.some(job => job.jobId === task.jobId)) {
                                rows.push(...saveObservation(record, task, 'unknown', now())); changed = true;
                            }
                        }
                        return { changed, rows };
                    });
                    for (const task of Object.values(snapshot(summary.id))) {
                        if (disposed || task.surface !== 'remote' || task.revoked || TERMINAL.has(task.status)
                            || task.nextCheckAt > now()) continue;
                        // 조회 직전에도 취소·세대·수신자 소유권을 다시 확인한다.
                        const permitted = update(summary.id, record => ({ changed: false,
                            value: (record.backgroundEpoch || 0) === task.epoch
                                && !record.backgroundTasks[task.key]?.revoked }));
                        if (!permitted || !agentsBySession(paseoHome).has(summary.id)) continue;
                        let status, failed = false;
                        try { status = await probeRemote(task, { fetchStatus }); }
                        catch { status = 'unknown'; failed = true; }
                        if (disposed || !agentsBySession(paseoHome).has(summary.id)) continue;
                        update(summary.id, record => {
                            const current = record.backgroundTasks?.[task.key];
                            if (!current || current.revoked || (record.backgroundEpoch || 0) !== task.epoch)
                                return { changed: false };
                            current.failures = failed ? current.failures + 1 : 0;
                            current.nextCheckAt = now() + Math.min(300000, 10000 * 2 ** Math.min(current.failures, 5));
                            const rows = saveObservation(record, current, status, now());
                            return { changed: true, rows };
                        });
                    }
                } catch { log('[paseodog] background report pending; owner or journal unavailable'); }
            }
        } finally { running = false; }
    }
    function start(intervalMs = 10000) {
        const tick = () => { void scan().catch(() => log('[paseodog] background scan failed; records retained')); };
        const timer = setInterval(tick, intervalMs);
        timer.unref?.(); tick();
        return () => { disposed = true; clearInterval(timer); };
    }
    return { request, scan, start };
}

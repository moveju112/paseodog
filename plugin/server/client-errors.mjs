import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const CLIENT_ERROR_LIMITS = Object.freeze({
    batch: 20, queue: 16, records: 500, bytes: 256 * 1024,
    retentionMs: 7 * 86400000, minute: 60000, rate: 60,
});
const STRING_LIMITS = {
    source: 64, stage: 64, code: 64, message: 2048, stack: 8192, appVersion: 64, osVersion: 64,
};
const REQUIRED = ['id', 'timestamp', 'source', 'code', 'message', 'appVersion', 'platform'];
const FIELDS = new Set([...REQUIRED, 'stage', 'stack', 'osVersion']);
const PLATFORMS = new Set(['android', 'ios', 'web', 'desktop']);
const SOURCES = new Set(['app', 'console', 'react', 'global', 'unhandledrejection', 'error-boundary', 'rpc',
    'rejection', 'image-picker', 'desktop-main']);
const STAGES = new Set(['startup', 'render', 'runtime', 'connect', 'rpc', 'send', 'receive',
    'permission', 'desktop', 'recovery', 'normalize', 'launch']);
const CODES = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError',
    'NetworkError', 'TimeoutError', 'UNHANDLED_ERROR', 'UNHANDLED_REJECTION', 'CONSOLE_ERROR', 'REACT_ERROR',
    'URIError', 'EvalError', 'AggregateError',
    'E_PICKER', 'ERR_NO_ACTIVITY', 'ERR_CANCELED', 'E_NO_LIBRARY_PERMISSION', 'E_PERMISSION_MISSING',
    'PICKER_LAUNCHER_UNREGISTERED', 'PICKER_ACTIVITY_UNAVAILABLE', 'PICKER_UNINITIALIZED',
    'MAIN_CONSOLE_ERROR', 'MAIN_UNHANDLED_REJECTION', 'MAIN_UNCAUGHT_EXCEPTION']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// 일반 객체만 허용해 알 수 없는 필드와 비정상 입력을 저장 전에 거부한다.
function object(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

// 서버에서도 필드·자료형·길이를 다시 검증하며 오류에는 원문을 넣지 않는다.
function validateEvent(event) {
    if (!object(event) || Object.keys(event).some((key) => !FIELDS.has(key))
        || REQUIRED.some((key) => !Object.hasOwn(event, key))
        || typeof event.id !== 'string' || !UUID.test(event.id)
        || typeof event.timestamp !== 'number' || !Number.isFinite(event.timestamp)
        || !PLATFORMS.has(event.platform)) throw new Error('Invalid client error event');
    for (const [key, limit] of Object.entries(STRING_LIMITS)) {
        if (!Object.hasOwn(event, key)) continue;
        if (typeof event[key] !== 'string' || event[key].length > limit
            || (['source', 'stage', 'code', 'appVersion'].includes(key) && !event[key].length))
            throw new Error('Invalid client error event');
    }
}

// 숫자 버전만 남겨 경로·토큰·사용자 콘텐츠를 메타데이터에 숨길 수 없게 한다.
function version(value) {
    return typeof value === 'string' && /^\d{1,4}(?:\.\d{1,4}){0,3}$/.test(value) ? value : 'unknown';
}

// 정규식 비밀 탐지 대신 허용 목록으로 투영하고 자유 메시지·스택은 전부 가린다.
export function sanitizeClientError(event) {
    validateEvent(event);
    return {
        id: event.id.toLowerCase(), timestamp: event.timestamp,
        source: SOURCES.has(event.source) ? event.source : 'other',
        ...(event.stage === undefined ? {} : { stage: STAGES.has(event.stage) ? event.stage : 'other' }),
        code: CODES.has(event.code) ? event.code : 'Error',
        message: '[redacted]',
        ...(event.stack === undefined ? {} : { stack: '[redacted]' }),
        appVersion: version(event.appVersion), platform: event.platform,
        ...(event.osVersion === undefined ? {} : { osVersion: version(event.osVersion) }),
    };
}

// scripts/paths.mjs와 같은 전용 홈 규칙으로만 저장하며 생성 시에는 파일을 건드리지 않는다.
export function createClientErrorCollector({
    home = resolve(process.env.PASEODOG_HOME || join(homedir(), '.local', 'share', 'paseodog')),
    enabled = process.env.PASEODOG_CLIENT_ERRORS !== '0',
    now = Date.now,
    scheduleMaintenance = setInterval,
    cancelMaintenance = clearInterval,
} = {}) {
    const directory = join(home, 'client-errors');
    const path = join(directory, 'events.jsonl');
    let queue = Promise.resolve(), pending = 0, closed = false;
    let windowStart = 0, used = 0;
    const recent = new Map();

    // 전용 하위 디렉터리가 실제 디렉터리인지 확인하고 접근 권한을 제한한다.
    async function prepare(create) {
        if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
        let info;
        try { info = await lstat(directory); }
        catch (error) { if (error.code === 'ENOENT' && !create) return false; throw error; }
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe client error directory');
        await chmod(directory, 0o700);
        return true;
    }

    // 심볼릭 링크·하드링크·과대 파일을 거부하고 제한된 기존 이벤트만 다시 가린다.
    async function load(time) {
        let handle;
        try {
            handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
            const info = await handle.stat();
            if (!info.isFile() || info.nlink !== 1 || info.size > CLIENT_ERROR_LIMITS.bytes)
                throw new Error('Unsafe client error file');
            const buffer = Buffer.alloc(CLIENT_ERROR_LIMITS.bytes + 1);
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
            if (bytesRead > CLIENT_ERROR_LIMITS.bytes) throw new Error('Client error file limit');
            const text = buffer.subarray(0, bytesRead).toString('utf8');
            const rows = text.trim() ? text.trim().split('\n') : [];
            if (rows.length > CLIENT_ERROR_LIMITS.records) throw new Error('Client error file limit');
            return rows.map((line) => sanitizeClientError(JSON.parse(line)))
                .filter((row) => row.timestamp > time - CLIENT_ERROR_LIMITS.retentionMs && row.timestamp <= time);
        } catch (error) {
            if (error.code === 'ENOENT') return null;
            throw error;
        } finally { await handle?.close(); }
    }

    // 개인 파일 권한을 강제하고 레코드·바이트 상한 안에서 직렬화된 내용을 저장한다.
    async function save(rows) {
        const text = rows.map((row) => JSON.stringify(row) + '\n').join('');
        // 미만료 ID를 밀어내지 않아 불확실한 전달의 재전송도 보존 기간 동안 중복 제거한다.
        if (rows.length > CLIENT_ERROR_LIMITS.records || Buffer.byteLength(text) > CLIENT_ERROR_LIMITS.bytes)
            throw new Error('Client error file limit');
        const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW
            | constants.O_NONBLOCK, 0o600);
        try {
            const info = await handle.stat();
            if (!info.isFile() || info.nlink !== 1) throw new Error('Unsafe client error file');
            await handle.chmod(0o600);
            await handle.truncate(0);
            await handle.writeFile(text, 'utf8');
        } finally { await handle.close(); }
    }

    // 보고 실패는 격리하되 삭제 실패·큐 거부는 원문 없는 고정 오류로 알린다.
    /**
     * @param {() => Promise<{ accepted: number }>} operation
     * @param {boolean} [rejectOnFailure]
     * @returns {Promise<{ accepted: number }>}
     */
    function enqueue(operation, rejectOnFailure = false) {
        if (closed || pending >= CLIENT_ERROR_LIMITS.queue) {
            return rejectOnFailure ? Promise.reject(new Error('Client error clear failed'))
                : Promise.resolve({ accepted: 0 });
        }
        pending++;
        const result = queue.then(operation).catch(() => {
            if (rejectOnFailure) throw new Error('Client error clear failed');
            return { accepted: 0 };
        });
        queue = result.then(() => undefined, () => undefined).finally(() => { pending--; });
        return result;
    }

    // 비활성 상태에서도 삭제는 허용하며 모든 파일 작업은 같은 큐에서 실행한다.
    /** @returns {Promise<{ accepted: number }>} */
    function handle(request) {
        if (!object(request) || !['report', 'clear'].includes(request.action)
            || Object.keys(request).some((key) => !['action', ...(request.action === 'report' ? ['events'] : [])].includes(key)))
            return Promise.reject(new Error('Invalid client error request'));
        if (request.action === 'clear') return enqueue(async () => {
            if (await prepare(false)) {
                const info = await lstat(path).catch((error) => {
                    if (error.code === 'ENOENT') return null;
                    throw error;
                });
                if (info && (!info.isFile() || info.nlink !== 1 || info.size > CLIENT_ERROR_LIMITS.bytes))
                    throw new Error('Unsafe client error file');
                if (info) await unlink(path);
            }
            recent.clear();
            return { accepted: 0 };
        }, true);
        if (!Array.isArray(request.events) || request.events.length > CLIENT_ERROR_LIMITS.batch)
            return Promise.reject(new Error('Invalid client error batch'));
        let events;
        try { events = request.events.map(sanitizeClientError); }
        catch { return Promise.reject(new Error('Invalid client error event')); }
        if (!enabled || !events.length) return Promise.resolve({ accepted: 0 });
        return enqueue(async () => {
            const time = now();
            if (time - windowStart >= CLIENT_ERROR_LIMITS.minute) { windowStart = time; used = 0; }
            for (const [key, timestamp] of recent) if (time - timestamp >= CLIENT_ERROR_LIMITS.minute) recent.delete(key);
            await prepare(true);
            const rows = await load(time) || [];
            const ids = new Set(rows.map((row) => row.id));
            let accepted = 0;
            for (const event of events) {
                // 시계 위조로 보존 기간을 늘리지 못하게 미래·만료 이벤트를 거부한다.
                if (event.timestamp <= time - CLIENT_ERROR_LIMITS.retentionMs || event.timestamp > time + 300000
                    || used >= CLIENT_ERROR_LIMITS.rate || ids.has(event.id)
                    || rows.length >= CLIENT_ERROR_LIMITS.records) continue;
                const key = JSON.stringify({ ...event, id: '', timestamp: 0 });
                if (recent.has(key)) continue;
                event.timestamp = Math.min(event.timestamp, time);
                rows.push(event);
                ids.add(event.id);
                recent.set(key, time);
                used++;
                accepted++;
            }
            await save(rows);
            return { accepted };
        });
    }

    // 유휴 상태에도 시간 단위로 만료 기록을 정리하며 종료 시 타이머를 해제한다.
    const timer = enabled ? scheduleMaintenance(() => {
        return enqueue(async () => {
            if (await prepare(false)) {
                const rows = await load(now());
                if (rows !== null) await save(rows);
            }
            return { accepted: 0 };
        });
    }, 3600000) : null;
    timer?.unref();
    return {
        handle,
        // 종료 이전 요청은 완료시키고 이후 요청은 수락하지 않는다.
        close() { closed = true; cancelMaintenance(timer); return queue; },
    };
}

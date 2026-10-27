import { constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync, closeSync, fsyncSync, renameSync, unlinkSync, rmdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { safeKey, plainObject } from './util.mjs';

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ITEMS = 2000;
const MAX_HISTORY_BYTES = 8 * 1024 * 1024;
const MAX_RECEIPTS = 20000;
// 계승 목록과 세션 도구에서 같은 첫 사용자 지시로 대상을 구분한다.
export function sessionDescription(row) {
    const prompt = row.items.find(({ item }) => item.type === 'user_message'
        && typeof item.text === 'string' && item.text.trim())?.item;
    const description = prompt?.text.replace(/\s+/g, ' ').trim().slice(0, 500);
    return { title: description?.slice(0, 100) || row.cwd.split('/').pop() || row.cwd, description };
}
function sessionSummary(row) {
    if (!row.items.length) return null;
    return { id: row.id, cwd: row.cwd, createdAt: row.createdAt, updatedAt: row.updatedAt,
        ...sessionDescription(row) };
}
function pidIdentity(pid) {
    try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
        return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
    } catch { return null; }
}
function alive(owner) {
    if (!owner || owner.host !== hostname() || !Number.isInteger(owner.pid) || owner.pid < 1) return true;
    try { process.kill(owner.pid, 0); }
    catch (error) { return error.code !== 'ESRCH'; }
    const start = pidIdentity(owner.pid);
    return !(owner.start && start && owner.start !== start);
}
function privateDir(path) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe state directory: ${path}`);
    if (process.platform !== 'win32' && (stat.mode & 0o077)) throw new Error(`State directory must be owner-only (chmod 700): ${path}`);
}
function readBytes(path) {
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
        const data = readFileSync(fd);
        if (data.length > MAX_BYTES) throw new Error('Session journal exceeds safety limit');
        return data;
    } finally { closeSync(fd); }
}
function readJson(path) {
    return JSON.parse(readBytes(path).toString('utf8'));
}
function atomicJson(path, data) {
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Refusing symlink journal');
    if (data.length > MAX_BYTES) throw new Error('Session journal full; archive this session and open a new one');
    const tmp = `${path}.${randomUUID()}.tmp`;
    let fd;
    try {
        fd = openSync(tmp, 'wx', 0o600);
        writeFileSync(fd, data); fsyncSync(fd); closeSync(fd); fd = undefined;
        renameSync(tmp, path);
        if (process.platform !== 'win32') {
            const parent = openSync(resolve(path, '..'), 'r');
            try { fsyncSync(parent); } finally { closeSync(parent); }
        }
    } finally {
        if (fd !== undefined) closeSync(fd);
        try { unlinkSync(tmp); } catch {}
    }
}
export class JournalStore {
    constructor(root) { this.root = resolve(root); privateDir(this.root); this.summaryCache = new Map(); }
    file(id) { return join(this.root, `${safeKey(id, 'bridge ID')}.json`); }
    acquire(id) {
        const dir = join(this.root, `${safeKey(id)}.lock`);
        const nonce = randomUUID();
        const owner = { pid: process.pid, start: pidIdentity(process.pid), host: hostname(), nonce };
        for (let attempt = 0; attempt < 2; attempt++) {
            try { mkdirSync(dir, { mode: 0o700 }); atomicJson(join(dir, 'owner.json'), Buffer.from(JSON.stringify(owner))); break; }
            catch (error) {
                if (error.code !== 'EEXIST') throw error;
                if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) throw new Error('Unsafe session lock');
                // Elect exactly one stale-lock reaper inside the existing directory.
                // A contender must re-read the owner after this election: it may
                // have raced with a new owner replacing a previously dead lock.
                const reap = join(dir, 'reap');
                try { mkdirSync(reap, { mode: 0o700 }); }
                catch { throw new Error('Session lock recovery in progress'); }
                let moved = false;
                try {
                    let previous;
                    try { previous = readJson(join(dir, 'owner.json')); }
                    catch { throw new Error('Session lock is initializing or damaged; stop the daemon before repairing it'); }
                    if (alive(previous)) throw new Error('Session already owned by another live connection');
                    const stale = `${dir}.stale-${nonce}`;
                    renameSync(dir, stale); moved = true;
                    try { unlinkSync(join(stale, 'owner.json')); rmdirSync(join(stale, 'reap')); rmdirSync(stale); } catch {}
                } finally { if (!moved) { try { rmdirSync(reap); } catch {} } }
                if (attempt === 1) throw new Error('Unable to acquire session lock');
            }
        }
        let released = false;
        return () => {
            if (released) return; released = true;
            try {
                if (readJson(join(dir, 'owner.json')).nonce !== nonce) return;
                unlinkSync(join(dir, 'owner.json')); rmdirSync(dir);
            } catch {}
        };
    }
    load(id) {
        const data = readJson(this.file(id));
        if (data.version !== 2 || data.id !== id || !Array.isArray(data.items) || !plainObject(data.receipts)) {
            throw new Error('Invalid journal; refusing to replace existing history');
        }
        if (typeof data.cwd !== 'string' || (data.nativeSessionId !== null && typeof data.nativeSessionId !== 'string')) throw new Error('Invalid journal identity');
        return data;
    }
    create(id, cwd, promptHash) {
        if (existsSync(this.file(id))) throw new Error('Journal already exists');
        const data = { version: 2, id, cwd, promptHash, nativeSessionId: null, createdAt: Date.now(), updatedAt: Date.now(), items: [], receipts: {}, active: null, usage: {}, historyTruncated: false };
        this.save(data); return data;
    }
    save(data) {
        if (Object.keys(data.receipts).length > MAX_RECEIPTS) throw new Error('Receipt ledger full; open a new session (old requests cannot be forgotten safely)');
        data.updatedAt = Date.now();
        if (data.items.length > MAX_ITEMS) {
            data.items = data.items.slice(-MAX_ITEMS); data.historyTruncated = true;
        }
        let serialized = JSON.stringify(data);
        // 전체 JSON이 본문 한도 안이면 포함된 items도 한도 안이다. 같은 본문을 다시 직렬화하지 않는다.
        if (data.items.length > 1 && Buffer.byteLength(serialized) > MAX_HISTORY_BYTES) {
            const previousLength = data.items.length;
            // receipt는 줄이지 않고 기존과 동일한 오래된 본문만 제거한다.
            while (data.items.length > 1 && Buffer.byteLength(JSON.stringify(data.items)) > MAX_HISTORY_BYTES) {
                data.items.shift(); data.historyTruncated = true;
            }
            if (data.items.length !== previousLength) serialized = JSON.stringify(data);
        }
        atomicJson(this.file(data.id), Buffer.from(serialized));
    }
    remove(id) { try { unlinkSync(this.file(id)); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    list() {
        return readdirSync(this.root).filter((p) => /^[a-zA-Z0-9_-]+\.json$/.test(p)).map((p) => {
            try { return this.load(p.slice(0, -5)); } catch { return null; }
        }).filter(Boolean);
    }
    listSummaries() {
        const files = readdirSync(this.root).filter((p) => /^[a-zA-Z0-9_-]+\.json$/.test(p));
        const present = new Set(files);
        for (const file of this.summaryCache.keys()) {
            if (!present.has(file)) this.summaryCache.delete(file);
        }
        const summaries = [];
        for (const file of files) {
            try {
                const stat = lstatSync(join(this.root, file), { bigint: true });
                if (!stat.isFile()) { this.summaryCache.delete(file); continue; }
                // 파일시스템 시간 해상도 때문에 연속 쓰기의 ctime도 같을 수 있다.
                // 메타데이터만으로 과거 본문을 되살리지 않도록 실제 바이트를 함께 비교한다.
                // 기존 O_NOFOLLOW와 크기 제한을 재사용하고 JSON 파싱·요약은 변경 시에만 수행한다.
                const digest = createHash('sha256').update(readBytes(join(this.root, file))).digest('hex');
                const revision = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.mode}:${digest}`;
                let cached = this.summaryCache.get(file);
                if (!cached || cached.revision !== revision) {
                    cached = { revision, summary: sessionSummary(this.load(file.slice(0, -5))) };
                    this.summaryCache.set(file, cached);
                }
                if (cached.summary) summaries.push({ ...cached.summary });
            } catch {
                // 손상·권한 변경·삭제된 파일의 이전 미리보기를 되살리지 않는다.
                this.summaryCache.delete(file);
            }
        }
        return summaries;
    }
}
export class MemoryJournalStore {
    constructor() { this.values = new Map(); this.locks = new Set(); }
    acquire(id) { if (this.locks.has(id)) throw new Error('Session already owned'); this.locks.add(id); return () => this.locks.delete(id); }
    create(id, cwd, promptHash) { const data = { version: 2, id, cwd, promptHash, nativeSessionId: null, items: [], receipts: {}, active: null, usage: {} }; this.save(data); return data; }
    load(id) { if (!this.values.has(id)) throw new Error('Session not found'); return structuredClone(this.values.get(id)); }
    save(data) { this.values.set(data.id, structuredClone(data)); }
    remove(id) { this.values.delete(id); }
    list() { return [...this.values.values()].map((value) => structuredClone(value)); }
    listSummaries() { return [...this.values.values()].map(sessionSummary).filter(Boolean); }
}
// 세션 잠금 소유자가 살아 있는지(다른 모듈의 중단 턴 판정용).
export { alive as lockOwnerAlive };

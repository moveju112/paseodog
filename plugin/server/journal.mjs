import { constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync, closeSync, fsyncSync, renameSync, unlinkSync, rmdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { safeKey, plainObject } from './util.mjs';

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ITEMS = 2000;
const MAX_RECEIPTS = 20000;
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
function readJson(path) {
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
        const data = readFileSync(fd);
        if (data.length > MAX_BYTES) throw new Error('Session journal exceeds safety limit');
        return JSON.parse(data.toString('utf8'));
    } finally { closeSync(fd); }
}
function atomicJson(path, value) {
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Refusing symlink journal');
    const data = Buffer.from(JSON.stringify(value));
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
    constructor(root) { this.root = resolve(root); privateDir(this.root); }
    file(id) { return join(this.root, `${safeKey(id, 'bridge ID')}.json`); }
    acquire(id) {
        const dir = join(this.root, `${safeKey(id)}.lock`);
        const nonce = randomUUID();
        const owner = { pid: process.pid, start: pidIdentity(process.pid), host: hostname(), nonce };
        for (let attempt = 0; attempt < 2; attempt++) {
            try { mkdirSync(dir, { mode: 0o700 }); atomicJson(join(dir, 'owner.json'), owner); break; }
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
        // Bound text snapshots independently of receipts, which must not be evicted.
        while (Buffer.byteLength(JSON.stringify(data.items)) > 8 * 1024 * 1024 && data.items.length > 1) {
            data.items.shift(); data.historyTruncated = true;
        }
        atomicJson(this.file(data.id), data);
    }
    remove(id) { try { unlinkSync(this.file(id)); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    list() {
        return readdirSync(this.root).filter((p) => /^[a-zA-Z0-9_-]+\.json$/.test(p)).map((p) => {
            try { return this.load(p.slice(0, -5)); } catch { return null; }
        }).filter(Boolean);
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
}

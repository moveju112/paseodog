import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, lstatSync, symlinkSync, mkdirSync, readdirSync, utimesSync, chmodSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { JournalStore } from '../plugin/server/journal.mjs';
function fixture(t){const root=mkdtempSync(join(tmpdir(),'paseodog-journal-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return {root,store:new JournalStore(root)};}
test('journal atomic persistence preserves native ID, receipts and 0600 permissions',t=>{
    const {root,store}=fixture(t),release=store.acquire('a');const record=store.create('a','/work','hash');record.nativeSessionId='sess1';record.receipts.x={state:'completed'};store.save(record);release();
    assert.equal(store.load('a').nativeSessionId,'sess1');assert.equal(lstatSync(join(root,'a.json')).mode&0o777,0o600);assert.deepEqual(readdirSync(root),['a.json']);
});
test('live lock prevents simultaneous writers and release is idempotent',t=>{
    const {store}=fixture(t),release=store.acquire('a');assert.throws(()=>store.acquire('a'),/owned/);release();release();store.acquire('a')();
});
test('stale PID lock is recovered by one reaper and replaced',t=>{
    const {root,store}=fixture(t);mkdirSync(join(root,'a.lock'),{mode:0o700});writeFileSync(join(root,'a.lock','owner.json'),JSON.stringify({pid:99999999,host:hostname(),start:'0',nonce:'old'}));
    const release=store.acquire('a');assert.equal(JSON.parse(readFileSync(join(root,'a.lock','owner.json'),'utf8')).pid,process.pid);release();
});
test('foreign-host lock is never assumed stale',t=>{
    const {root,store}=fixture(t);mkdirSync(join(root,'a.lock'),{mode:0o700});writeFileSync(join(root,'a.lock','owner.json'),JSON.stringify({pid:99999999,host:'other-host',nonce:'old'}));
    assert.throws(()=>store.acquire('a'),/owned/);
});
test('initializing/damaged lock fails closed rather than deleting it',t=>{
    const {root,store}=fixture(t);mkdirSync(join(root,'a.lock'),{mode:0o700});assert.throws(()=>store.acquire('a'),/initializing|damaged/);assert.ok(lstatSync(join(root,'a.lock')).isDirectory());
});
test('path traversal and symlink journals are rejected',t=>{
    const {root,store}=fixture(t);assert.throws(()=>store.file('../escape'),/Invalid/);const target=join(root,'target');writeFileSync(target,'secret');symlinkSync(target,join(root,'a.json'));
    assert.throws(()=>store.load('a'));assert.throws(()=>store.save({id:'a',items:[],receipts:{}}),/symlink/);assert.equal(readFileSync(target,'utf8'),'secret');
});
test('corrupt history is not replaced or silently reset',t=>{
    const {root,store}=fixture(t);writeFileSync(join(root,'a.json'),'not-json');assert.throws(()=>store.load('a'));assert.throws(()=>store.create('a','/work','hash'));assert.equal(readFileSync(join(root,'a.json'),'utf8'),'not-json');
});
test('UI history can be bounded but receipt deduplication ledger is retained',t=>{
    const {store}=fixture(t),r=store.create('a','/work','hash');r.items=Array.from({length:2300},(_,i)=>({item:{id:String(i),text:'x'}}));r.receipts.old={state:'completed'};store.save(r);
    const loaded=store.load('a');assert.equal(loaded.items.length,2000);assert.equal(loaded.historyTruncated,true);assert.ok(loaded.receipts.old);
});
test('state directory cannot be world-readable or a symlink',t=>{
    // 실행 환경의 umask와 무관하게 실제로 공개된 디렉터리를 검사한다.
    const {root}=fixture(t);mkdirSync(join(root,'public'),{mode:0o755});chmodSync(join(root,'public'),0o755);assert.throws(()=>new JournalStore(join(root,'public')),/owner-only/);symlinkSync(root,join(root,'link'));assert.throws(()=>new JournalStore(join(root,'link')),/Unsafe/);
});

test('summary listings retain only metadata and do not reload unchanged journals', (t) => {
    const { store } = fixture(t);
    const record = store.create('a', '/work', 'hash');
    record.items = [{ item: { type: 'user_message', text: '  first\nrequest  ' } },
        { item: { type: 'assistant_message', text: 'history-only' } }];
    record.receipts.accepted = { state: 'completed' };
    store.save(record);
    store.create('empty', '/work', 'hash');
    const load = store.load.bind(store);
    let reads = 0;
    store.load = (id) => { reads++; return load(id); };
    const expected = [{ id: 'a', cwd: '/work', createdAt: record.createdAt,
        updatedAt: record.updatedAt, title: 'first request', description: 'first request' }];
    const first = store.listSummaries();
    assert.deepEqual(first, expected);
    assert.equal(reads, 2);
    first[0].title = 'caller mutation';
    assert.deepEqual(store.listSummaries(), expected);
    assert.equal(reads, 2);
    assert.deepEqual(load('a'), record);
});

test('summary listings detect external replacements, additions, deletion and formerly empty journals', (t) => {
    const { root, store } = fixture(t);
    const writer = new JournalStore(root);
    const record = writer.create('a', '/work', 'hash');
    record.items = [{ item: { type: 'user_message', text: 'first' } }];
    writer.save(record);
    writer.create('empty', '/work', 'hash');
    assert.equal(store.listSummaries()[0].title, 'first');
    const path = join(root, 'a.json');
    const before = lstatSync(path);
    record.items[0].item.text = 'other';
    writer.save(record);
    utimesSync(path, before.atime, before.mtime);
    assert.equal(store.listSummaries()[0].title, 'other');
    const empty = writer.load('empty');
    empty.items = [{ item: { type: 'assistant_message', text: 'no user prompt' } }];
    writer.save(empty);
    const added = writer.create('added', '/second', 'hash');
    added.items = [{ item: { type: 'user_message', text: 'new' } }];
    writer.save(added);
    writer.remove('a');
    assert.deepEqual(store.listSummaries().map(({ id, title }) => ({ id, title })).sort((a, b) => a.id.localeCompare(b.id)),
        [{ id: 'added', title: 'new' }, { id: 'empty', title: 'work' }]);
});

test('summary listings invalidate same-size in-place edits even when mtime is restored', (t) => {
    const { root, store } = fixture(t);
    const record = store.create('a', '/work', 'hash');
    record.items = [{ item: { type: 'user_message', text: 'first' } }];
    store.save(record);
    const path = join(root, 'a.json');
    const oldTime = new Date('2020-01-01T00:00:00Z');
    utimesSync(path, oldTime, oldTime);
    assert.equal(store.listSummaries()[0].title, 'first');
    const before = lstatSync(path);
    writeFileSync(path, readFileSync(path, 'utf8').replace('"first"', '"other"'));
    utimesSync(path, oldTime, oldTime);
    assert.equal(lstatSync(path).size, before.size);
    assert.equal(lstatSync(path).mtimeMs, before.mtimeMs);
    assert.equal(store.listSummaries()[0].title, 'other');
});

test('summary listings never serve cached previews for corrupt or symlink-replaced journals', (t) => {
    const { root, store } = fixture(t);
    const record = store.create('a', '/work', 'hash');
    record.items = [{ item: { type: 'user_message', text: 'original' } }];
    store.save(record);
    assert.equal(store.listSummaries().length, 1);
    const path = join(root, 'a.json');
    writeFileSync(path, 'not-json');
    assert.deepEqual(store.listSummaries(), []);
    store.save(record);
    assert.equal(store.listSummaries().length, 1);
    const target = join(root, 'outside');
    writeFileSync(target, readFileSync(path));
    rmSync(path);
    symlinkSync(target, path);
    assert.deepEqual(store.listSummaries(), []);
    assert.deepEqual(store.listSummaries(), []);
});

test('summary listings invalidate unreadable files and recover after access is restored',
    { skip: process.platform === 'win32' || process.getuid?.() === 0 }, (t) => {
        const { root, store } = fixture(t);
        const record = store.create('a', '/work', 'hash');
        record.items = [{ item: { type: 'user_message', text: 'private' } }];
        store.save(record);
        assert.equal(store.listSummaries()[0].title, 'private');
        const path = join(root, 'a.json');
        chmodSync(path, 0o000);
        try { assert.deepEqual(store.listSummaries(), []); }
        finally { chmodSync(path, 0o600); }
        assert.equal(store.listSummaries()[0].title, 'private');
    });

test('summary listings retain journal identity validation after warming the cache', (t) => {
    const { root, store } = fixture(t);
    const record = store.create('a', '/work', 'hash');
    record.items = [{ item: { type: 'user_message', text: 'valid' } }];
    store.save(record);
    assert.equal(store.listSummaries().length, 1);
    writeFileSync(join(root, 'a.json'), JSON.stringify({ ...record, id: 'different-session' }));
    assert.deepEqual(store.listSummaries(), []);
    store.save(record);
    assert.equal(store.listSummaries()[0].id, 'a');
});

test('summary listings tolerate external replacement and deletion during a journal read', (t) => {
    const { root, store } = fixture(t);
    const writer = new JournalStore(root);
    const record = writer.create('a', '/work', 'hash');
    record.items = [{ item: { type: 'user_message', text: 'old' } }];
    writer.save(record);
    const load = store.load.bind(store);
    store.load = (id) => {
        record.items[0].item.text = 'replacement';
        writer.save(record);
        store.load = load;
        return load(id);
    };
    assert.equal(store.listSummaries()[0].title, 'replacement');
    assert.equal(store.listSummaries()[0].title, 'replacement');
    writer.save(record);
    store.load = (id) => { writer.remove(id); return load(id); };
    assert.deepEqual(store.listSummaries(), []);
    assert.deepEqual(store.listSummaries(), []);
});

test('journal writes retain exact JSON bytes including escaped and multibyte text', (t) => {
    const { root, store } = fixture(t);
    t.mock.method(Date, 'now', () => 1234567890123);
    const record = store.create('bytes', '/work', 'hash');
    record.items = [
        { item: { id: 'a', type: 'user_message', text: '한글 🐶\n"quoted" \\slash \ud800' } },
        { item: { id: 'b', type: 'assistant_message', text: 'response' }, timestamp: '2026-01-01T00:00:00.000Z' },
    ];
    record.receipts.accepted = { state: 'completed', result: { type: 'accepted' } };
    const expected = Buffer.from(JSON.stringify(record));
    store.save(record);
    assert.deepEqual(readFileSync(join(root, 'bytes.json')), expected);
    assert.deepEqual(store.load('bytes'), record);
});

test('metadata over the history threshold never causes otherwise small history to be evicted', (t) => {
    const { store } = fixture(t);
    const record = store.create('metadata', '/work', 'hash');
    record.items = [{ item: { id: 'a', text: 'one' } }, { item: { id: 'b', text: 'two' } }];
    record.metadata = 'x'.repeat(8 * 1024 * 1024);
    const items = record.items;
    store.save(record);
    assert.equal(record.items, items);
    assert.equal(record.historyTruncated, false);
    assert.deepEqual(store.load('metadata').items, items);
});

test('history byte pruning keeps its in-place semantics, UTF-8 limit and receipt ledger', (t) => {
    const { store } = fixture(t);
    const record = store.create('trim', '/work', 'hash');
    record.items = [
        { item: { id: 'old', text: '가'.repeat(2 * 1024 * 1024) } },
        { item: { id: 'latest', text: 'x'.repeat(3 * 1024 * 1024) } },
    ];
    record.receipts.accepted = { state: 'completed' };
    const items = record.items;
    store.save(record);
    assert.equal(record.items, items);
    assert.deepEqual(record.items.map((row) => row.item.id), ['latest']);
    assert.equal(record.historyTruncated, true);
    const restored = store.load('trim');
    assert.deepEqual(restored.receipts, { accepted: { state: 'completed' } });
    assert.equal(restored.items[0].item.text.length, 3 * 1024 * 1024);
});

test('a lone oversized history item stays intact but the full journal limit still fails closed', (t) => {
    const { root, store } = fixture(t);
    const record = store.create('large', '/work', 'hash');
    record.items = [{ item: { id: 'only', text: 'x'.repeat(9 * 1024 * 1024) } }];
    store.save(record);
    assert.equal(record.historyTruncated, false);
    assert.equal(store.load('large').items[0].item.text.length, 9 * 1024 * 1024);
    const before = readFileSync(join(root, 'large.json'));
    record.metadata = 'x'.repeat(8 * 1024 * 1024);
    assert.throws(() => store.save(record), /Session journal full/);
    assert.deepEqual(readFileSync(join(root, 'large.json')), before);
});

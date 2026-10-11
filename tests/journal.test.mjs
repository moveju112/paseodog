import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, lstatSync, symlinkSync, mkdirSync, readdirSync } from 'node:fs';
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
    const {root}=fixture(t);mkdirSync(join(root,'public'),{mode:0o755});assert.throws(()=>new JournalStore(join(root,'public')),/owner-only/);symlinkSync(root,join(root,'link'));assert.throws(()=>new JournalStore(join(root,'link')),/Unsafe/);
});

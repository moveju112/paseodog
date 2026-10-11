// Real bridge + OS child + disk journal. The model runtime is an explicit fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createProviderConnection } from '../plugin/server/connection.mjs';
import { processEngineFactory } from '../plugin/server/process-engine.mjs';
import { JournalStore } from '../plugin/server/journal.mjs';
import { compactSummary } from '../engine/src/worker.mjs';
import { validateEvent } from './contracts/provider-events.mjs';
import { until, delay } from './helpers.mjs';
const worker=fileURLToPath(new URL('./fixtures/worker-fixture.mjs',import.meta.url));
function fixture(t) {
    const root=mkdtempSync(join(tmpdir(),'paseodog-integration-'));
    const log=join(root,'asks.log'); const connections=[];
    const store=new JournalStore(join(root,'journal'));
    const factory=processEngineFactory({launch:{command:process.execPath,args:[worker],env:{...process.env}},spawnProcess:spawn,terminateProcess:(child)=>child.kill('SIGKILL'),timeoutMs:2000,stopMs:100,scopeMode:'test-only-process-group'});
    function client(){const events=[];const connection=createProviderConnection({engineFactory:factory,store,bootMs:3000,stopMs:200,permissionMs:500,flushMs:5,maxTurnMs:5000});connection.onEvent(e=>events.push(e));connections.push({connection,events});return{connection,events};}
    const config={cwd:root,env:{ASK_LOG:log},settings:{},mcpServers:{},persist:true};
    const open=(sessionId='p1',persistence)=>({type:'session.open',requestId:'open:'+sessionId,sessionId,config,persistence,history:persistence?'replay':'skip'});
    const prompt=(text='normal',clientMessageId='m1',sessionId='p1')=>({type:'session.prompt',sessionId,prompt:{clientMessageId,delivery:'auto',input:{type:'message',content:[{type:'text',text}]}}});
    t.after(async()=>{for(const c of connections) await c.connection.close();for(const c of connections)for(const e of c.events)validateEvent(e);rmSync(root,{recursive:true,force:true});});
    const askCount=()=>existsSync(log)?readFileSync(log,'utf8').trim().split('\n').filter(Boolean).length:0;
    return {root,client,open,prompt,askCount};
}
test('integrated disk restore replays stable timeline without executing a duplicate prompt',async t=>{
    const f=fixture(t),a=f.client();await a.connection.send(f.open());const opened=await until(a.events,e=>e.type==='session.opened');await until(a.events,e=>e.type==='session.ready');
    await a.connection.send(f.prompt());await until(a.events,e=>e.type==='session.turn'&&e.state==='completed');const original=a.events.find(e=>e.type==='timeline.item'&&e.item.type==='assistant_message').item.id;
    await a.connection.close();const b=f.client();await b.connection.send(f.open('p2',opened.persistence));await until(b.events,e=>e.type==='session.ready');
    assert.ok(b.events.some(e=>e.type==='timeline.item'&&e.item.id===original));await b.connection.send(f.prompt('normal','m1','p2'));await until(b.events,e=>e.type==='session.prompt_result');await delay(20);assert.equal(f.askCount(),1);
});
test('integrated phone-style permission responses bind to one pending tool call',async t=>{
    const f=fixture(t),a=f.client();await a.connection.send(f.open());await until(a.events,e=>e.type==='session.ready');
    for(const [index,behavior] of ['deny','allow'].entries()){
        const start=a.events.length;await a.connection.send(f.prompt('permission','m'+index));const request=await until(a.events,e=>e.type==='session.permission'&&a.events.indexOf(e)>=start);
        await a.connection.send({type:'session.permission',sessionId:'p1',permissionId:request.request.id,response:{behavior,selectedActionId:behavior==='allow'?'allow-once':'deny'}});
        const end=await until(a.events,e=>e.type==='session.turn'&&e.state==='completed'&&a.events.indexOf(e)>=start);assert.equal(end.state,'completed');
        assert.ok(a.events.slice(start).some(e=>e.type==='timeline.item'&&e.item.text===(behavior==='allow'?'allowed':'denied')));
    }
});
test('integrated stop unblocks a pending child turn and has one terminal event',async t=>{
    const f=fixture(t),a=f.client();await a.connection.send(f.open());await until(a.events,e=>e.type==='session.ready');await a.connection.send(f.prompt('wait'));
    await until(a.events,e=>e.type==='session.turn'&&e.state==='started');await delay(30);await a.connection.send({type:'session.interrupt',requestId:'stop',sessionId:'p1'});
    await until(a.events,e=>e.type==='request.completed'&&e.requestId==='stop');const terminal=a.events.filter(e=>e.type==='session.turn'&&e.state!=='started');assert.equal(terminal.length,1);assert.equal(terminal[0].state,'canceled');
});
test('integrated worker crash is recorded and never automatically replayed',async t=>{
    const f=fixture(t),a=f.client();await a.connection.send(f.open());const opened=await until(a.events,e=>e.type==='session.opened');await until(a.events,e=>e.type==='session.ready');await a.connection.send(f.prompt('crash'));await until(a.events,e=>e.type==='session.turn'&&e.state==='failed');await a.connection.close();
    const b=f.client();await b.connection.send(f.open('p2',opened.persistence));await until(b.events,e=>e.type==='session.ready');await b.connection.send(f.prompt('crash','m1','p2'));await until(b.events,e=>e.type==='session.prompt_result');await delay(20);assert.equal(f.askCount(),1);
});
test('integrated compact response strips native model messages and opaque provider replay',async t=>{
    const f=fixture(t),a=f.client();await a.connection.send(f.open());await until(a.events,e=>e.type==='session.ready');
    await a.connection.send({type:'session.prompt',sessionId:'p1',prompt:{clientMessageId:'compact-1',delivery:'auto',input:{type:'command',name:'compact',arguments:''}}});await until(a.events,e=>e.type==='session.turn'&&e.state==='completed');assert.doesNotMatch(JSON.stringify(a.events),/MUST_NOT_CROSS_WIRE/);assert.equal(f.askCount(),0);
});
test('compact projection permits only bounded scalars, even with cycles in native state',()=>{
    const value={changed:true,beforeTokens:123,afterTokens:NaN,reason:'a'.repeat(2000),messages:[]};value.session=value;
    assert.deepEqual(compactSummary(value),{changed:true,beforeTokens:123,reason:'a'.repeat(1000)});
});

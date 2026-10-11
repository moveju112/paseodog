import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { processEngineFactory } from '../plugin/server/process-engine.mjs';
import { delay } from './helpers.mjs';
const script=fileURLToPath(new URL('./fixtures/worker-fixture.mjs',import.meta.url));
const processes=[];
function factory(options={}){return processEngineFactory({launch:{command:process.execPath,args:[script],env:{...process.env}},spawnProcess:(...args)=>{const child=spawn(...args);processes.push(child);return child;},terminateProcess:child=>child.kill('SIGKILL'),timeoutMs:5000,stopMs:100,...options});}
const args={config:{cwd:tmpdir(),env:{},mcpServers:{},settings:{},persist:true}};
test('real child process JSONL open/stream/identity/result/close works without leaking native replay',async()=>{
    const engine=await factory().create(args);const chunks=[],ids=[];try{const result=await engine.ask('normal',{onTextDelta:x=>chunks.push(x),onTextReset:()=>true,onIdentity:x=>ids.push(x.id)});assert.deepEqual(chunks,['child ','result']);assert.deepEqual(ids,['sess_child']);assert.equal(result.result.content,'child result');assert.doesNotMatch(JSON.stringify(result),/MUST_NOT_CROSS_WIRE/);}finally{await engine.close();}
});
test('simultaneous child engines have isolated per-session configuration',async()=>{
    const a=await factory().create({...args,config:{...args.config,env:{TEST_VALUE:'one'}}}),b=await factory().create({...args,config:{...args.config,env:{TEST_VALUE:'two'}}});
    try{const results=await Promise.all([a.ask('normal',{}),b.ask('normal',{})]);assert.deepEqual(results.map(x=>x.result.content),['one','two']);}finally{await Promise.all([a.close(),b.close()]);}
});
test('permission event round-trips allow and deny across an actual child process',async()=>{
    for(const approved of [true,false]){const e=await factory().create(args);try{const result=await e.ask('permission',{onToolApproval:async()=>({approved})});assert.equal(result.result.content,approved?'allowed':'denied');}finally{await e.close();}}
});
test('child crash rejects pending inference; no implicit respawn or replay',async()=>{
    const e=await factory().create(args);await assert.rejects(e.ask('crash',{}),/exited/);await assert.rejects(e.ask('normal',{}),/unavailable/);await e.close();
});
test('interrupt uses a separate RPC while ask is pending',async()=>{
    const e=await factory().create(args);const ask=e.ask('wait',{});const rejection=assert.rejects(ask,/aborted/);await delay(30);await e.abort();await rejection;await e.close();
});
test('closing hanging inference terminates child within bounded deadline',async()=>{
    const e=await factory().create(args);const ask=e.ask('hang',{});const rejection=assert.rejects(ask);await delay(20);await e.close();await rejection;
});
test('abort signal cancels worker startup and leaves no active child',async()=>{
    const controller=new AbortController();controller.abort();const before=processes.length;await assert.rejects(factory().create(args,{signal:controller.signal}),/canceled/);assert.equal(processes.length,before);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { attachHostPolicy, mapMcpServers } from '../engine/src/policy.mjs';
import { createNativeEngine } from '../engine/src/native-engine.mjs';
import { patchedSource, gitBlob, ANCHOR, MARKER } from '../scripts/patch-mixdog.mjs';
const makeSession=()=>({id:'sess1',messages:[{role:'system',content:'base'}],cwd:'/work'});
test('every tool requires approval; original deny decisions remain authoritative',async()=>{
    const s=makeSession();s.beforeToolHook=async(input)=>input.name==='bad'?{action:'deny',reason:'upstream'}:null;
    attachHostPolicy(s,{mode:'ask'});assert.equal((await s.beforeToolHook({name:'read',args:{path:'a'}})).action,'ask');assert.equal((await s.beforeToolHook({name:'bad',args:{}})).reason,'upstream');
});
test('rewritten tools are checked after upstream hooks and cannot escape review mode',async()=>{
    const s=makeSession();s.beforeToolHook=async()=>({action:'rewrite',name:'shell',args:{command:'danger'}});attachHostPolicy(s,{mode:'review'});
    assert.equal((await s.beforeToolHook({name:'read',args:{}})).action,'deny');
});
test('delegation and automation are denied even in build mode',async()=>{
    for(const name of ['agent','task','automation','schedule','setup','computer','goal']){const s=makeSession();attachHostPolicy(s,{mode:'ask'});assert.equal((await s.beforeToolHook({name,args:{}})).action,'deny');}
});
test('unknown tools are denied in review and require approval in ask mode',async()=>{
    for(const mode of ['ask','review']){const s=makeSession();attachHostPolicy(s,{mode});assert.equal((await s.beforeToolHook({name:'unknown',args:{}})).action,mode==='ask'?'ask':'deny');}
});
test('repeated host-hook installation calls the original hook once, not a growing wrapper chain',async()=>{
    let count=0;const s=makeSession();s.beforeToolHook=async()=>{count++;return null;};for(let i=0;i<100;i++)attachHostPolicy(s,{mode:'ask'});await s.beforeToolHook({name:'read',args:{}});assert.equal(count,1);
    const empty=makeSession();for(let i=0;i<100;i++)attachHostPolicy(empty,{mode:'ask'});assert.equal((await empty.beforeToolHook({name:'read',args:{}})).action,'ask');
});
test('host prompt is injected once and invalidates old continuation; changed prompt is rejected',()=>{
    const s=makeSession();s.messages.push({role:'user',content:'work'});s.providerState={previousResponseId:'old'};attachHostPolicy(s,{systemPrompt:'rules'});attachHostPolicy(s,{systemPrompt:'rules'});
    assert.equal(s.messages.filter(x=>x.content==='rules').length,1);assert.equal(s.messages[1].role,'system');assert.equal(s.providerState,undefined);assert.throws(()=>attachHostPolicy(s,{systemPrompt:'different'}),/changed/);
});
test('MCP mapping preserves headers/args and rejects credential URLs and invalid names',()=>{
    const out=mapMcpServers({one:{type:'stdio',command:'node',args:['a'],env:{KEY:'x'}},two:{type:'http',url:'https://localhost/mcp',headers:{Authorization:'Bearer x'}}});
    assert.equal(out.one.env.KEY,'x');assert.equal(out.two.headers.Authorization,'Bearer x');assert.throws(()=>mapMcpServers({a:{type:'http',url:'https://u:p@host/'}}));assert.throws(()=>mapMcpServers(JSON.parse('{"__proto__":{"type":"stdio","command":"x"}}')));
});
test('native adapter passes config, uses pinned beforeSessionAsk hook and disables delegation',async()=>{
    let options,asks=0;const s=makeSession();const events=[];
    const runtime={id:'sess1',async ask(text,cb){asks++;await cb.beforeSessionAsk(s);return {result:{content:text}};},abort(){},close(){},resume(){},compact(){}};
    const engine=await createNativeEngine({config:{cwd:'/work',mode:'review',systemPrompt:'rules',mcpServers:{}},route:{provider:'p',model:'m',effort:'low'}}, {modules:{loadConfig:()=>({memory:{enabled:true},autoClear:{enabled:true}}),createMixdogSessionRuntime:async(o)=>{options=o;return runtime;}},emit:(...x)=>events.push(x)});
    await engine.ask('hi',{});assert.equal(asks,1);assert.equal(options.disallowDelegation,true);assert.equal(options.toolMode,'readonly');assert.equal(options.initialConfig.memory.enabled,true);assert.equal(options.initialConfig.autoClear.enabled,true);assert.equal(events[0][0],'identity');assert.equal((await s.beforeToolHook({name:'shell',args:{}})).action,'deny');await engine.close('done');
});
test('native restore failure and mismatched cwd cannot silently create a different session',async()=>{
    for(const resumed of [null,{id:'wrong',cwd:'/work'},{id:'sess1',cwd:'/other'}]){
        let closed=0;await assert.rejects(createNativeEngine({config:{cwd:'/work',mcpServers:{}},nativeSessionId:'sess1'}, {modules:{loadConfig:()=>({}),createMixdogSessionRuntime:async()=>({ask(){},abort(){},close(){closed++;},compact(){},resume:()=>resumed})}}));assert.equal(closed,1);
    }
});
test('host-boundary source patch is hash-locked, idempotent and fails on upstream drift',()=>{
    const original=`async function x(){\n${ANCHOR}\n}`;const expected=gitBlob(original);const patched=patchedSource(original,expected);
    assert.ok(patched.includes(MARKER));assert.equal(patchedSource(patched,expected),patched);assert.throws(()=>patchedSource(original+'//drift',expected),/hash mismatch/);
});
test('native session owned by a raw Mixdog process is not remotely forwarded past the host guard',async()=>{
    let closed=0,asked=0;await assert.rejects(createNativeEngine({config:{cwd:'/work',mcpServers:{}},nativeSessionId:'sess1'}, {modules:{loadConfig:()=>({}),createMixdogSessionRuntime:async()=>({session:{remoteAttached:true},ask(){asked++;},abort(){},close(){closed++;},compact(){},resume:()=>({id:'sess1',cwd:'/work'})})}}),/another live/);assert.equal(asked,0);assert.equal(closed,1);
});

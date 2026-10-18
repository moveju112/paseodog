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
test('native adapter passes config and enables only host-managed delegation',async()=>{
    let options,asks=0;const s=makeSession();const events=[];
    const runtime={id:'sess1',async ask(text,cb){asks++;await cb.beforeSessionAsk(s);return {result:{content:text}};},abort(){},close(){},resume(){},compact(){}};
    const tool={getStatus:()=>({jobs:[]}),onStatusChange:()=>()=>{},closeAll:async()=>({failed:[]})};
    const engine=await createNativeEngine({config:{cwd:'/work',mode:'review',systemPrompt:'rules',mcpServers:{}},route:{provider:'p',model:'m',effort:'low',fast:false,autoEffort:false}}, {modules:{loadConfig:()=>({memory:{enabled:true},autoClear:{enabled:true}}),createMixdogSessionRuntime:async(o)=>{options=o;o.agentSessionSurface({mgr:{},getAgentTool:()=>tool});return runtime;}},emit:(...x)=>events.push(x)});
    assert.equal(options.fast,false);assert.equal(options.autoEffort,false);
    await engine.ask('hi',{onIdentity:(info)=>events.push(['identity',info])});assert.equal(asks,1);assert.equal(options.disallowDelegation,false);assert.equal(options.toolMode,'readonly');assert.equal(options.initialConfig.memory.enabled,true);assert.equal(options.initialConfig.autoClear.enabled,true);assert.equal(events[0][0],'identity');assert.equal((await s.beforeToolHook({name:'shell',args:{}})).action,'deny');await engine.close('done');
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

// 엔진 설정 유지 및 자동 업데이트 차단을 검증한다.
test('Mixdog retains native compaction and model settings without staging engine updates', async () => {
    const base = { compaction: { enabled: true }, models: { saved: { autoEffort: true } },
        update: { auto: true }, mcpServers: { hidden: { type: 'stdio', command: 'hidden' } } };
    let options;
    const runtime = { ask() {}, abort() {}, close() {}, resume() {}, compact() {} };
    const engine = await createNativeEngine({ config: { cwd: '/work', mcpServers: {} } }, {
        modules: { loadConfig: () => base, createMixdogSessionRuntime: async (value) => {
            options = value;
            return runtime;
        } },
    });
    assert.deepEqual(options.initialConfig.compaction, base.compaction);
    assert.deepEqual(options.initialConfig.models, base.models);
    assert.equal(options.initialConfig.update.auto, false);
    assert.equal(base.update.auto, true);
    assert.deepEqual(Object.keys(options.initialConfig.mcpServers), []);
    await engine.close('done');
});

// Worker opt-in은 호스트 설정에만 적용하고 원래 프로필·다른 역할은 바꾸지 않는다.
test('Paseo Worker opt-in follows the parent route without API fallbacks or profile writes', async (t) => {
    const previous = process.env.PASEODOG_TEST_PARENT_WORKER;
    process.env.PASEODOG_TEST_PARENT_WORKER = 'true';
    t.after(() => {
        if (previous === undefined) delete process.env.PASEODOG_TEST_PARENT_WORKER;
        else process.env.PASEODOG_TEST_PARENT_WORKER = previous;
    });
    const base = { disabledAgents: ['worker', 'advisor'],
        agents: { worker: { provider: 'api', model: 'other', fallbacks: [{ provider: 'api', model: 'paid' }] } } };
    let options;
    const engine = await createNativeEngine({
        config: { cwd: '/work', mcpServers: {} },
        route: { provider: 'openai-oauth', model: 'gpt-6-luna', effort: 'low' },
    }, { modules: { loadConfig: () => base, createMixdogSessionRuntime: async (value) => {
        options = value;
        return { ask() {}, abort() {}, close() {}, resume() {}, compact() {} };
    } } });
    assert.deepEqual(options.initialConfig.disabledAgents, ['advisor']);
    assert.deepEqual(options.initialConfig.agents.worker, {
        provider: 'openai-oauth', model: 'gpt-6-luna', effort: 'low', fast: false, autoEffort: false, fallbacks: [],
    });
    assert.deepEqual(base.disabledAgents, ['worker', 'advisor']);
    assert.equal(base.agents.worker.provider, 'api');
    await engine.close('done');
    await assert.rejects(createNativeEngine({ config: { cwd: '/work' } },
        { modules: { loadConfig: () => base } }), /explicit parent model route/);
});

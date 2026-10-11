import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, until, deferred, delay, terminal } from './helpers.mjs';
import { hash } from '../plugin/server/util.mjs';

test('text lifecycle emits a single acceptance, start, terminal, stable timeline and usage', async (t) => {
    const f=fixture(); t.after(()=>f.connection.close()); await f.ready(); await f.run();
    assert.equal(f.events.filter(e=>e.type==='session.prompt_result').length,1);
    assert.deepEqual(f.events.filter(e=>e.type==='session.turn').map(e=>e.state),['started','completed']);
    assert.equal(f.events.findLast(e=>e.item?.type==='assistant_message').item.text,'hello world');
    assert.deepEqual(f.events.find(e=>e.type==='session.usage').usage,{inputTokens:12,cachedInputTokens:2,outputTokens:3});
    assert.equal(f.store.list()[0].nativeSessionId,'sess_test');
    assert.equal(Object.values(f.store.list()[0].usage)[0].cacheWriteTokens,1);
});
test('env, MCP servers, system prompt, native provider/model/effort reach factory', async(t)=>{
    const f=fixture(); t.after(()=>f.connection.close());
    f.open.config={...f.open.config,env:{MY_KEY:'private'},systemPrompt:'rules',mcpServers:{test:{type:'stdio',command:'test'}},providerOptions:{provider:'p',model:'m',effort:'low'}};
    await f.ready(); assert.equal(f.creates[0].config.env.MY_KEY,'private');
    assert.equal(f.creates[0].config.systemPrompt,'rules'); assert.equal(f.creates[0].config.mcpServers.test.command,'test');
    assert.deepEqual(f.creates[0].route,{provider:'p',model:'m',effort:'low'});
    assert.doesNotMatch(JSON.stringify(f.store.list()),/private|MY_KEY/);
});
test('config refuses silent policy downgrade, ephemeral persistence and unknown mode', async(t)=>{
    for(const update of [{toolPolicy:{preapproved:[{kind:'mcp',server:'x',tool:'x'}]}},{persist:false},{mode:'implicit'}]) {
        const f=fixture(); t.after(()=>f.connection.close()); f.open.config={...f.open.config,...update};
        await f.connection.send(f.open); await until(f.events,e=>e.type==='request.failed'); assert.equal(f.creates.length,0);
    }
});
test('invalid or legacy persistence fails instead of creating fresh context', async(t)=>{
    const f=fixture(); t.after(()=>f.connection.close()); await f.connection.send({...f.open,persistence:{version:1,data:{nativeSessionId:'old'}}});
    await until(f.events,e=>e.type==='request.failed'); assert.equal(f.creates.length,0);
});
test('same clientMessageId is idempotent while active and after completion', async(t)=>{
    const gate=deferred(); let count=0; const f=fixture({async ask(){count++;await gate.promise;return {content:'done'};}}); t.after(()=>f.connection.close());
    await f.ready(); await f.connection.send(f.prompt); await until(f.events,e=>e.type==='session.turn');
    await f.connection.send(f.prompt); await delay(5); gate.resolve(); await until(f.events,e=>e.type==='session.turn'&&e.state==='completed');
    await f.connection.send(f.prompt); await delay(5); assert.equal(count,1); assert.equal(terminal(f.events).length,1); assert.equal(f.events.filter(e=>e.type==='session.prompt_result').length,1);
});
test('simultaneous distinct prompts never overlap', async(t)=>{
    const gate=deferred(); let count=0; const f=fixture({async ask(){count++;await gate.promise;return {content:'done'};}}); t.after(()=>f.connection.close());
    await f.ready(); await f.connection.send(f.prompt); await until(f.events,e=>e.type==='session.turn');
    await f.connection.send({...f.prompt,prompt:{...f.prompt.prompt,clientMessageId:'m2'}});
    const rejected=await until(f.events,e=>e.type==='session.prompt_result'&&e.clientMessageId==='m2'); assert.equal(rejected.result.type,'failed'); assert.equal(count,1); gate.resolve();
});
test('replay preserves public IDs and does not display native synthetic instructions', async(t)=>{
    const f=fixture(); await f.ready(); await f.run(); const saved=f.events.find(e=>e.type==='session.opened').persistence;
    const ids=f.store.list()[0].items.map(x=>x.item.id); await f.connection.close();
    const g=fixture({}, {store:f.store}); t.after(()=>g.connection.close()); g.open={...g.open,persistence:saved,history:'replay'};
    await g.connection.send(g.open); await until(g.events,e=>e.type==='session.ready');
    assert.deepEqual(g.events.filter(e=>e.type==='timeline.item').map(e=>e.item.id),ids); assert.equal(g.creates[0].nativeSessionId,'sess_test');
    await g.connection.send(g.prompt); await until(g.events,e=>e.type==='session.prompt_result'); assert.equal(g.calls.filter(x=>x.text).length,0);
});
test('same native journal cannot be opened by two live connections', async(t)=>{
    const f=fixture(); t.after(()=>f.connection.close()); await f.ready();
    const persistence=f.events.find(e=>e.type==='session.opened').persistence;
    const g=fixture({}, {store:f.store}); t.after(()=>g.connection.close());
    await g.connection.send({...g.open,persistence}); await until(g.events,e=>e.type==='request.failed'); assert.equal(g.creates.length,0);
});
test('uncertain receipt survives restart and refuses automatic replay', async(t)=>{
    const f=fixture(); await f.ready(); const persistence=f.events.find(e=>e.type==='session.opened').persistence;
    await f.connection.close(); const r=f.store.load(persistence.data.bridgeId); const key=hash('m1');
    r.active={turnId:'old',receiptKey:key};r.receipts[key]={hash:hash({text:'fix code'}),state:'running',turnId:'old',result:{type:'turn',turnId:'old'}};f.store.save(r);
    const g=fixture({}, {store:f.store}); t.after(()=>g.connection.close()); await g.connection.send({...g.open,persistence});await until(g.events,e=>e.type==='session.ready');
    await g.connection.send(g.prompt); const rejected=await until(g.events,e=>e.type==='session.prompt_result'); assert.match(rejected.result.error.message,/uncertain/); assert.equal(g.calls.filter(x=>x.text).length,0);
});
test('restored cwd or system-prompt mismatch never runs an engine', async(t)=>{
    const f=fixture(); await f.ready(); const persistence=f.events.find(e=>e.type==='session.opened').persistence; await f.connection.close();
    for(const changed of [{cwd:'/other'},{systemPrompt:'new rules'}]) {
        const g=fixture({}, {store:f.store}); t.after(()=>g.connection.close()); await g.connection.send({...g.open,persistence,config:{...g.open.config,...changed}});
        await until(g.events,e=>e.type==='request.failed'); assert.equal(g.creates.length,0);
    }
});
test('unknown model and malformed route list fail explicitly',async(t)=>{
    const f=fixture();t.after(()=>f.connection.close());await f.connection.send({...f.open,config:{...f.open.config,model:'unknown'}});await until(f.events,e=>e.type==='request.failed');
    assert.throws(()=>fixture({}, {env:{PASEODOG_MODELS:'{}'}}),/array/);
});
test('image, output schema, steering, unknown command and empty text are rejected',async(t)=>{
    const f=fixture();t.after(()=>f.connection.close());await f.ready();let id=0;
    for(const update of [{input:{type:'message',content:[{type:'image',data:'x'}]}},{outputSchema:{}},{delivery:'steer'}, {input:{type:'command',name:'delete',arguments:''}}, {input:{type:'message',content:[{type:'text',text:' '}]}}]){
        const clientMessageId=`bad${++id}`;await f.connection.send({...f.prompt,prompt:{...f.prompt.prompt,...update,clientMessageId}});
        const event=await until(f.events,e=>e.type==='session.prompt_result'&&e.clientMessageId===clientMessageId);assert.equal(event.result.type,'failed');
    }assert.equal(f.calls.filter(x=>x.text).length,0);
});
test('/compact runs native compaction on same session with no model ask',async(t)=>{
    const f=fixture();t.after(()=>f.connection.close());await f.ready();await f.run({...f.prompt,prompt:{...f.prompt.prompt,input:{type:'command',name:'compact',arguments:''}}});
    assert.equal(f.calls.filter(x=>x.compact).length,1);assert.equal(f.calls.filter(x=>x.text).length,0);
});
test('permission denial and allow-once both return exact native decision',async(t)=>{
    for(const behavior of ['allow','deny']){
        let decision;const f=fixture({async ask(_text,cb){decision=await cb.onToolApproval({name:'shell',args:{command:'pwd'}});return {content:'done'};}});t.after(()=>f.connection.close());
        await f.ready();await f.connection.send(f.prompt);const req=await until(f.events,e=>e.type==='session.permission');
        assert.equal(req.request.input.command,'pwd');await f.connection.send({type:'session.permission',sessionId:'p1',permissionId:req.request.id,response:{behavior,selectedActionId:behavior==='allow'?'allow-once':'deny'}});
        await until(f.events,e=>e.type==='session.turn'&&e.state==='completed');assert.equal(decision.approved,behavior==='allow');
    }
});
test('timeout defaults to denial and leaves no approval pending',async(t)=>{
    let decision;const f=fixture({async ask(_text,cb){decision=await cb.onToolApproval({name:'write',args:{path:'x'}});return {content:'done'};}},{permissionMs:12});t.after(()=>f.connection.close());
    await f.ready();await f.run();assert.equal(decision.approved,false);assert.match(decision.reason,/timed out/);
});
test('edited arguments and allow-always actions cannot bypass approved command',async(t)=>{
    for(const extra of [{updatedInput:{command:'rm'}},{selectedActionId:'allow-always'},{updatedPermissions:[{}]}]){
        let decision;const f=fixture({async ask(_t,cb){decision=await cb.onToolApproval({name:'shell',args:{command:'pwd'}});return {content:'done'};}});t.after(()=>f.connection.close());
        await f.ready();await f.connection.send(f.prompt);const req=await until(f.events,e=>e.type==='session.permission');
        await f.connection.send({type:'session.permission',sessionId:'p1',permissionId:req.request.id,response:{behavior:'allow',...extra}});await until(f.events,e=>e.type==='session.turn'&&e.state==='completed');assert.equal(decision.approved,false);
    }
});
test('foreign-session and oversize approvals are denied without a UI card',async(t)=>{
    for(const info of [{sessionId:'wrong',name:'shell',args:{}},{name:'shell',args:{data:'x'.repeat(140000)}}]){
        let decision;const f=fixture({async ask(_t,cb){cb.onIdentity({id:'sess_test'});decision=await cb.onToolApproval(info);return {content:'done'};}});t.after(()=>f.connection.close());
        await f.ready();await f.run();assert.equal(decision.approved,false);assert.equal(f.events.some(e=>e.type==='session.permission'),false);
    }
});
test('interrupt closes approval, suppresses late data and emits exactly one canceled terminal',async(t)=>{
    let decision;const f=fixture({async ask(_t,cb){decision=await cb.onToolApproval({name:'shell',args:{}});cb.onTextDelta('late');return {content:'late'};}});t.after(()=>f.connection.close());
    await f.ready();await f.connection.send(f.prompt);await until(f.events,e=>e.type==='session.permission');await f.connection.send({type:'session.interrupt',requestId:'stop',sessionId:'p1'});
    await until(f.events,e=>e.type==='request.completed'&&e.requestId==='stop');assert.equal(decision.approved,false);assert.deepEqual(terminal(f.events).map(e=>e.state),['canceled']);assert.equal(f.events.some(e=>e.item?.text==='late'),false);
});
test('noncooperative runtime is force-stopped within deadline and cannot accept more work',async(t)=>{
    const f=fixture({ask(){return new Promise(()=>{});}},{stopMs:10});t.after(()=>f.connection.close());await f.ready();await f.connection.send(f.prompt);await until(f.events,e=>e.type==='session.turn');
    await f.connection.send({type:'session.interrupt',requestId:'stop',sessionId:'p1'});await until(f.events,e=>e.type==='request.completed');assert.ok(f.calls.some(x=>x.kill));assert.equal(terminal(f.events)[0].state,'canceled');
    await f.connection.send({...f.prompt,prompt:{...f.prompt.prompt,clientMessageId:'m2'}});const e=await until(f.events,e=>e.type==='session.prompt_result'&&e.clientMessageId==='m2');assert.equal(e.result.type,'failed');
});
test('text resets trim exact native chars; tool boundaries keep separate assistant snapshots',async(t)=>{
    const f=fixture({async ask(_t,cb){cb.onTextDelta('abXYZ');cb.onTextReset({chars:3});cb.onAssistantText('ab');cb.onToolCall(1,[{id:'tool1',name:'read'}]);cb.onToolResult({toolCallId:'tool1',content:'ok'});cb.onTextDelta('final');return {content:'final'};}});t.after(()=>f.connection.close());await f.ready();await f.run();
    const items=f.store.list()[0].items.filter(x=>x.item.type==='assistant_message');assert.deepEqual(items.map(x=>x.item.text),['ab','final']);
});
test('early tool notifications do not finish a tool; orphan running tools close as failed',async(t)=>{
    const f=fixture({async ask(_t,cb){cb.onToolCall(1,[{id:'a',name:'read'},{id:'b',name:'read'}]);cb.onToolResult({toolCallId:'a',__earlyNotify:true,content:'early'});cb.onToolResult({toolCallId:'a',content:'done'});return {content:'done'};}});t.after(()=>f.connection.close());await f.ready();await f.run();
    const tools=f.store.list()[0].items.filter(x=>x.item.type==='tool_call');assert.deepEqual(tools.map(x=>x.item.status),['completed','failed']);
});
test('NaN and Infinity usage do not contaminate finite counters',async(t)=>{
    const f=fixture({async ask(_t,cb){cb.onUsageDelta({deltaInput:Infinity,deltaOutput:NaN,deltaCachedRead:-1});return {content:'done'};}});t.after(()=>f.connection.close());await f.ready();await f.run();
    assert.deepEqual(f.events.find(e=>e.type==='session.usage').usage,{inputTokens:0,cachedInputTokens:0,outputTokens:0});
});
test('receipt disk failure prevents inference before accepting prompt',async(t)=>{
    const f=fixture();t.after(()=>f.connection.close().catch(()=>{}));await f.ready();f.store.save=()=>{throw new Error('disk full');};
    await f.connection.send(f.prompt);await until(f.events,e=>e.type==='session.prompt_result');assert.equal(f.calls.filter(x=>x.text).length,0);assert.equal(f.events.filter(e=>e.type==='session.turn').length,0);
});
test('close before queued open cannot launch orphan runtime',async()=>{
    let creates=0;const f=fixture({}, {engineFactory:{async create(){creates++;throw new Error('not expected');}}});
    await f.connection.send(f.open);await f.connection.close();await delay(10);assert.equal(creates<=1,true);assert.equal(f.events.some(e=>e.type==='session.ready'),false);
});
test('startup failure has request.failed and no fake ready',async(t)=>{
    const f=fixture({}, {engineFactory:{async create(){throw new Error('No credentials');}}});t.after(()=>f.connection.close());await f.connection.send(f.open);await until(f.events,e=>e.type==='request.failed');assert.equal(f.events.some(e=>e.type==='session.ready'),false);
});
test('session list returns bridge records, filtered by cwd',async(t)=>{
    const f=fixture();t.after(()=>f.connection.close());await f.ready();await f.connection.send({type:'sessions',requestId:'list',cwd:'/work'});const e=await until(f.events,e=>e.type==='sessions');assert.equal(e.sessions.length,1);assert.equal(e.sessions[0].persistence.version,2);
});
test('effective native model echoed by Paseo can be restored without a catalog alias',async(t)=>{
    const f=fixture();await f.ready();await f.run();const persistence=f.events.find(e=>e.type==='session.opened').persistence;await f.connection.close();
    const g=fixture({}, {store:f.store});t.after(()=>g.connection.close());await g.connection.send({...g.open,persistence,config:{...g.open.config,model:'test-model'}});await until(g.events,e=>e.type==='session.ready');assert.equal(g.creates[0].nativeSessionId,'sess_test');
});

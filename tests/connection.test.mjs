import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, until, deferred, delay, terminal } from './helpers.mjs';
import { hash } from '../plugin/server/util.mjs';

// 카탈로그에 Bypass를 노출하고 명시적인 선택만 엔진에 전달한다.
test('bypass is opt-in and exposed in the session mode catalog', async (t) => {
    const regular = fixture();
    t.after(() => regular.connection.close());
    await regular.ready();
    const regularConfig = regular.events.find((event) => event.type === 'session.config').config;
    assert.equal(regularConfig.mode, 'ask');
    assert.deepEqual(regularConfig.modes.find((mode) => mode.id === 'bypass'), { id: 'bypass', label: 'Bypass' });
    const bypass = fixture();
    t.after(() => bypass.connection.close());
    bypass.open.config.mode = 'bypass';
    await bypass.ready();
    assert.equal(bypass.creates[0].config.mode, 'bypass');
    assert.equal(bypass.events.find((event) => event.type === 'session.config').config.mode, 'bypass');
});

// 선택 목록에는 실제 모델만 표시하고 기존 기본 모델 식별자의 복원 호환성은 유지한다.
test('model catalog omits the profile placeholder before and after native refresh', async (t) => {
    const routes = [{ id: 'configured-model', provider: 'local', model: 'configured', label: 'Configured' }];
    const configured = fixture({}, { env: { PASEODOG_MODELS: JSON.stringify(routes) } });
    t.after(() => configured.connection.close());
    await configured.connection.send({ type: 'catalog', requestId: 'configured-catalog' });
    const configuredCatalog = (await until(configured.events, (event) => event.type === 'catalog')).catalog;
    assert.deepEqual(configuredCatalog.models, [{ id: 'configured-model', label: 'Configured' }]);
    assert.equal(configuredCatalog.defaultModel, 'configured-model');

    const native = fixture({}, {
        env: { PASEODOG_MODELS: JSON.stringify(routes) },
        loadCatalog: async () => ({
            route: { provider: 'native', model: 'selected' },
            models: [{ provider: 'native', id: 'other', label: 'Other' },
                { provider: 'native', id: 'selected', label: 'Selected' }],
        }),
    });
    t.after(() => native.connection.close());
    await native.connection.send({ type: 'catalog', requestId: 'native-catalog' });
    const catalog = (await until(native.events, (event) => event.type === 'catalog')).catalog;
    assert.deepEqual(catalog.models.map((row) => row.id), ['native/other', 'native/selected', 'configured-model']);
    assert.equal(catalog.defaultModel, 'native/selected');
    assert.doesNotMatch(JSON.stringify(catalog), /mixdog-default|Mixdog profile default|always allow tools/);

    const empty = fixture();
    t.after(() => empty.connection.close());
    await empty.connection.send({ type: 'catalog', requestId: 'empty-catalog' });
    const emptyCatalog = (await until(empty.events, (event) => event.type === 'catalog')).catalog;
    assert.deepEqual(emptyCatalog.models, []);
    assert.equal(emptyCatalog.defaultModel, undefined);
});

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
// 기본 연결 모델은 절약 설정을 전달하되 명시적인 모델 선택은 우선한다.
test('saved connection defaults select the subscription route with low-cost settings', async(t)=>{
    const env={PASEODOG_PROVIDER:'openai-oauth',PASEODOG_MODEL:'gpt-6-luna',
        PASEODOG_EFFORT:'low',PASEODOG_AUTO_EFFORT:'false',PASEODOG_FAST:'false'};
    const f=fixture({}, {env});t.after(()=>f.connection.close());await f.ready();
    assert.deepEqual(f.creates[0].route,{provider:'openai-oauth',model:'gpt-6-luna',
        effort:'low',autoEffort:false,fast:false});
    const g=fixture({}, {env});t.after(()=>g.connection.close());
    g.open.config.providerOptions={provider:'explicit',model:'chosen',effort:'high'};
    await g.ready();
    assert.equal(g.creates[0].route.provider,'explicit');
    assert.equal(g.creates[0].route.model,'chosen');
    assert.equal(g.creates[0].route.effort,'high');
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
test('malformed image, output schema, steering, unknown command and empty text are rejected',async(t)=>{
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
test('Paseo resets are rejected and native tool boundaries keep monotonic assistant snapshots',async(t)=>{
    let acknowledged;
    const f=fixture({async ask(_t,cb){cb.onTextDelta('abXYZ');acknowledged=cb.onTextReset({chars:3});
        if(acknowledged)cb.onAssistantText('ab');else cb.onAssistantText('abXYZ');
        cb.onToolCall(1,[{id:'tool1',name:'read'}]);cb.onToolResult({toolCallId:'tool1',content:'ok'});
        cb.onTextDelta('final');return {content:'final'};}});
    t.after(()=>f.connection.close());await f.ready();await f.run();
    assert.equal(acknowledged,false);
    const items=f.store.list()[0].items.filter(x=>x.item.type==='assistant_message');
    assert.deepEqual(items.map(x=>x.item.text),['abXYZ','final']);
});
test('incorrect shorter native final cannot shrink already emitted Paseo text',async(t)=>{
    const f=fixture({async ask(_t,cb){cb.onTextDelta('unchanged');cb.onAssistantText('unchange');return {content:'unchange'};}});
    t.after(()=>f.connection.close());await f.ready();await f.run();
    assert.deepEqual(f.store.list()[0].items.filter(x=>x.item.type==='assistant_message').map(x=>x.item.text),['unchanged']);
    assert.equal(f.events.some(x=>x.type==='session.notice'&&x.notice.id.startsWith('assistant-prefix-mismatch:')),false);
});
// 스트리밍 중 조기 감지·결과가 도착해도 부모의 확정 배치 전까지 같은 본문을 이어 쓴다.
test('eager tools keep streamed words intact and confirmed parent batches still close text', async (t) => {
    for (const observed of [true, false]) {
        const f = fixture({ async ask(_text, callbacks) {
            callbacks.onTextDelta('재빌');
            if (observed) callbacks.onAssistantToolCallObserved({ id: 'eager', name: 'read' });
            callbacks.onToolResult({ toolCallId: 'eager', toolName: 'read', content: 'ok' });
            callbacks.onTextDelta('드할');
            callbacks.onAssistantText('재빌드할');
            callbacks.onToolCall(1, [{ id: 'eager', name: 'read' }]);
            callbacks.onTextDelta('게.');
            callbacks.onAssistantText('게.');
            return { content: '게.' };
        } });
        t.after(() => f.connection.close());
        await f.ready(); await f.run();
        const items = f.store.list()[0].items.map((row) => row.item);
        assert.deepEqual(items.filter((item) => item.type === 'assistant_message').map((item) => item.text),
            ['재빌드할', '게.']);
        const tools = items.filter((item) => item.type === 'tool_call');
        assert.equal(tools.length, 1);
        assert.equal(tools[0].status, 'completed');
        const snapshots = f.events.filter((event) => event.item?.type === 'assistant_message');
        assert.equal(new Set(snapshots.filter((event) => event.item.text.startsWith('재빌'))
            .map((event) => event.item.id)).size, 1);
        const rows = f.events.filter((event) => event.item);
        assert.ok(rows.findIndex((event) => event.item.text === '재빌드할')
            < rows.findIndex((event) => event.item.type === 'tool_call'));
    }
});
// 병렬 자식 도구의 감지·배치·결과는 부모 문장과 확정 스냅샷을 분할하거나 중복하지 않는다.
test('child tool batches do not split parent prose or continuation snapshots', async (t) => {
    const f = fixture({ async ask(_text, callbacks) {
        callbacks.onTextDelta('재빌');
        const call = { id: 'child:read', name: 'read', childSessionId: 'child' };
        callbacks.onAssistantToolCallObserved(call);
        callbacks.onTextDelta('드할');
        callbacks.onToolCall(1, [call]);
        callbacks.onToolResult({ toolCallId: call.id, content: 'ok' });
        callbacks.onTextDelta('게.');
        callbacks.onAssistantText('재빌드할게.');
        callbacks.onTextDelta(' 계속.');
        callbacks.onAssistantText(' 계속.');
        return { content: '재빌드할게. 계속.' };
    } });
    t.after(() => f.connection.close());
    await f.ready(); await f.run();
    const items = f.store.list()[0].items.map((row) => row.item);
    assert.deepEqual(items.filter((item) => item.type === 'assistant_message').map((item) => item.text),
        ['재빌드할게. 계속.']);
    assert.equal(items.find((item) => item.type === 'tool_call').status, 'completed');
    assert.equal(new Set(f.events.filter((event) => event.item?.type === 'assistant_message')
        .map((event) => event.item.id)).size, 1);
    const rows = f.events.filter((event) => event.item);
    assert.ok(rows.findLastIndex((event) => event.item.type === 'assistant_message')
        < rows.findIndex((event) => event.item.type === 'tool_call'));
});
// 보류 중 취소·오류가 발생해도 도구 완료 상태와 미완료 도구의 종료 상태를 잃지 않는다.
test('deferred tools retain terminal states when parent streaming fails or is interrupted', async (t) => {
    for (const interrupted of [false, true]) {
        const reached = deferred(), release = deferred();
        const f = fixture({ async ask(_text, callbacks) {
            callbacks.onTextDelta('작성 중');
            callbacks.onAssistantToolCallObserved({ id: 'done', name: 'read' });
            callbacks.onToolResult({ toolCallId: 'done', content: 'ok' });
            callbacks.onAssistantToolCallObserved({ id: 'pending', name: 'read' });
            reached.resolve();
            await release.promise;
            throw new Error('stream failed');
        }, abort() { release.resolve(); } });
        t.after(() => f.connection.close());
        await f.ready();
        await f.connection.send(f.prompt);
        await reached.promise;
        assert.equal(f.events.some((event) => event.item?.type === 'tool_call'), false);
        if (interrupted) {
            await f.connection.send({ type: 'session.interrupt', requestId: 'stop-stream', sessionId: 'p1' });
        } else release.resolve();
        await until(f.events, (event) => event.type === 'session.turn' && event.state !== 'started');
        const tools = f.store.list()[0].items.filter((row) => row.item.type === 'tool_call').map((row) => row.item);
        assert.deepEqual(tools.map((tool) => [tool.callId, tool.status]),
            [['done', 'completed'], ['pending', 'canceled']]);
    }
});
// 최종 응답이 바뀌어도 기존 항목은 보존하고 수정된 문장은 별도 항목으로 표시한다.
test('revised native final uses a new assistant item without a false warning', async (t) => {
    const f = fixture({ async ask(_text, callbacks) {
        callbacks.onTextDelta('Initial answer');
        callbacks.onAssistantText('Revised answer');
        return { content: 'Revised answer' };
    } });
    t.after(() => f.connection.close());
    await f.ready(); await f.run();
    const messages = f.store.list()[0].items.filter((row) => row.item.type === 'assistant_message');
    assert.deepEqual(messages.map((row) => row.item.text), ['Initial answer', 'Revised answer']);
    assert.notEqual(messages[0].item.id, messages[1].item.id);
    assert.equal(f.events.some((event) => event.type === 'session.notice'), false);
    assert.deepEqual(terminal(f.events).map((event) => event.state), ['completed']);
});
// 연속 응답의 개별 확정 콜백과 마지막 합계가 중복 출력되지 않는지 확인한다.
test('native continuation snapshots reconcile with streamed aggregate and duplicate callbacks', async (t) => {
    const f = fixture({ async ask(_text, callbacks) {
        callbacks.onTextDelta('First ');
        callbacks.onAssistantText('First ');
        callbacks.onAssistantText('First ');
        callbacks.onTextDelta('second');
        callbacks.onAssistantText('second');
        callbacks.onAssistantText('');
        callbacks.onAssistantText('second');
        return { content: 'First second' };
    } });
    t.after(() => f.connection.close());
    await f.ready(); await f.run();
    assert.deepEqual(f.store.list()[0].items.filter((row) => row.item.type === 'assistant_message')
        .map((row) => row.item.text), ['First second']);
    assert.equal(f.events.some((event) => event.type === 'session.notice'), false);
});
// 스트림이 없는 연속 메시지도 동일한 네이티브 합계로 전달한다.
test('snapshot-only continuations and final-only revisions retain complete text', async (t) => {
    for (const streamed of [false, true]) {
        const f = fixture({ async ask(_text, callbacks) {
            if (streamed) {
                callbacks.onTextDelta('Draft');
                return { content: 'Final' };
            }
            callbacks.onAssistantText('First ');
            callbacks.onAssistantText('second');
            return { content: 'First second' };
        } });
        t.after(() => f.connection.close());
        await f.ready(); await f.run();
        assert.deepEqual(f.store.list()[0].items.filter((row) => row.item.type === 'assistant_message')
            .map((row) => row.item.text), streamed ? ['Draft', 'Final'] : ['First second']);
        assert.equal(f.events.some((event) => event.type === 'session.notice'), false);
    }
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { scratchPath } from '../scripts/paths.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { processEngineFactory } from '../plugin/server/process-engine.mjs';
import { delay } from './helpers.mjs';
const script=fileURLToPath(new URL('./fixtures/worker-fixture.mjs',import.meta.url));
const processes=[];
function factory(options={}){return processEngineFactory({launch:{command:process.execPath,args:[script],env:{...process.env}},spawnProcess:(...args)=>{const child=spawn(...args);processes.push(child);return child;},terminateProcess:child=>child.kill('SIGKILL'),timeoutMs:5000,stopMs:100,scopeMode:'test-only-process-group',...options});}
const args={config:{cwd:tmpdir(),env:{},mcpServers:{},settings:{},persist:true}};
test('model-switch compaction survives the ordinary RPC timeout and excludes concurrent work', async (t) => {
    const engine = await factory().create({
        ...args, config: { ...args.config, env: { TEST_HOLD_CONFIGURE: 'true' } },
    });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const pending = engine.configure({ route: { provider: 'other', model: 'next' } });
        // 다음 RPC 왕복은 configure가 워커에 도착해 active를 점유했음을 보장한다.
        await assert.rejects(engine.ask('normal', {}), /Worker busy/);
        await assert.rejects(engine.configure({ effort: 'high' }), /Worker busy/);
        await assert.rejects(engine.compact(), /Worker busy/);
        t.mock.timers.tick(5001);
        await engine.auth({});
        assert.deepEqual((await pending).route, { provider: 'other', model: 'next' });
        assert.equal((await engine.ask('normal', {})).result.content, 'child result');
    } finally {
        t.mock.timers.reset();
        await engine.close();
    }
});
// 계승된 자식 ID는 작업 결과로만 전달하고 현재 네이티브 세션 주소는 유지한다.
test('fork result crosses real worker IPC without replacing the source session identity', async () => {
    const engine = await factory().create(args);
    try {
        assert.equal(engine.id, 'sess_child');
        assert.deepEqual(await engine.action({ operation: 'fork', confirmed: true }), { nativeSessionId: 'sess_heir' });
        assert.equal(engine.id, 'sess_child');
        assert.equal((await engine.ask('normal', {})).result.content, 'child result');
    } finally { await engine.close(); }
});
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
// 실제 자식 프로세스의 설정 읽기·쓰기와 활성 턴 거절을 확인한다.
test('session effort preferences cross worker IPC and reject configuration during an active ask', async () => {
    const engine = await factory().create(args);
    try {
        assert.deepEqual(engine.configuration(), { autoEffort: true, effort: 'low' });
        assert.deepEqual(await engine.configure({ autoEffort: false, effort: 'high' }),
            { autoEffort: false, effort: 'high' });
        assert.equal(engine.configuration().autoEffort, false);
        const ask = engine.ask('wait', {});
        const rejection = assert.rejects(ask, /aborted/);
        await assert.rejects(engine.configure({ autoEffort: true }), /Worker busy/);
        assert.equal(engine.configuration().autoEffort, false);
        await engine.abort();
        await rejection;
    } finally { await engine.close(); }
});

// 데몬이 재시작돼 부모가 바뀌면 소켓이 열려 있어도 엔진이 스스로 종료한다.
test('engine stops once its parent process changes and ignores an unchanged parent', async () => {
    const { watchParent } = await import('../engine/src/parent-watch.mjs');
    let parent = 4242;
    const reasons = [];
    const cancel = watchParent((reason) => reasons.push(reason), { ppid: () => parent, intervalMs: 5 });
    await delay(30);
    assert.deepEqual(reasons, []);
    parent = 1413;
    await delay(30);
    assert.deepEqual(reasons, ['Parent process exited']);
    parent = 4242;
    await delay(30);
    assert.equal(reasons.length, 1);
    cancel();
    // 감시 시작 전에 부모가 이미 바뀌었어도 시작 시 기록한 부모와 비교해 종료한다.
    const late = [];
    watchParent((reason) => late.push(reason), { ppid: () => 1413, initial: 4242, intervalMs: 5 });
    await delay(30);
    assert.deepEqual(late, ['Parent process exited']);
    // 소유자 프로세스가 사라지면 부모가 그대로여도 종료한다.
    const ownerGone = [];
    watchParent((reason) => ownerGone.push(reason), { ppid: () => 4242, initial: 4242, owner: 5151, alive: () => false, intervalMs: 5 })();
    const ownerLive = [];
    const stopOwnerWatch = watchParent((reason) => ownerLive.push(reason), { ppid: () => 4242, initial: 4242, owner: 5151, alive: () => true, intervalMs: 5 });
    await delay(30);
    stopOwnerWatch();
    assert.deepEqual(ownerLive, []);
    const orphaned = [];
    watchParent((reason) => orphaned.push(reason), { ppid: () => 1, intervalMs: 5 })();
    await delay(20);
    assert.deepEqual(orphaned, []);
});

// 실제 엔진 프로세스: 표준입력 연결이 끝나지 않아도(다른 프로세스가 쥔 경우) 부모가 종료되면 스스로 종료한다.
test('real engine worker exits after its parent dies even while its stdin never reaches EOF', { skip: process.platform === 'win32', timeout: 30000 }, async (t) => {
    const engine = fileURLToPath(new URL('../engine/bin/paseodog-engine.mjs', import.meta.url));
    const directory = await mkdtemp(scratchPath('paseodog-parent-watch-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const fifo = join(directory, 'stdin');
    execFileSync('mkfifo', [fifo]);
    // 읽기·쓰기 겸용으로 열어 EOF가 오지 않는 표준입력을 만든다. 중간 부모는 엔진을 띄운 뒤 종료한다.
    const launcher = `const { spawn } = require('node:child_process'); const fs = require('node:fs');
        const input = fs.openSync(${JSON.stringify(fifo)}, 'r+');
        const child = spawn(process.execPath, [${JSON.stringify(engine)}, '--stdio'], { stdio: [input, 'ignore', 'ignore'], detached: true, env: { ...process.env, PASEODOG_ENGINE_OWNER_PID: String(process.pid) } });
        fs.closeSync(input); process.stdout.write(String(child.pid) + '\\n', () => process.exit(0));`;
    const { NODE_TEST_CONTEXT: _context, ...env } = process.env;
    const parent = spawn(process.execPath, ['-e', launcher], { stdio: ['ignore', 'pipe', 'ignore'], env });
    processes.push(parent);
    const pid = Number(await new Promise((resolve) => parent.stdout.once('data', (data) => resolve(String(data).trim()))));
    const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
    try {
        await new Promise((resolve) => parent.once('exit', resolve));
        await delay(1000);
        assert.ok(alive(), 'engine must still be running before the parent watch interval');
        const deadline = Date.now() + 25000;
        while (alive() && Date.now() < deadline) await delay(250);
        assert.equal(alive(), false, 'orphaned engine must exit');
    } finally {
        if (alive()) process.kill(pid, 'SIGKILL');
    }
});

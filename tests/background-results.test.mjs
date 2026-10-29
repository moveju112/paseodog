import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { scratchPath } from '../scripts/paths.mjs';
import { JournalStore } from '../plugin/server/journal.mjs';
import { createBackgroundResults, probeRemote, revokeBackgroundWork, shellObservation } from '../plugin/server/background-results.mjs';
import { fixture, until } from './helpers.mjs';

const agentId = '11111111-1111-4111-8111-111111111111';
async function setup(t, options = {}) {
    const root = await mkdtemp(scratchPath('paseodog-background-results-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const stateRoot = join(root, 'sessions'), paseoHome = join(root, 'paseo'), dataRoot = join(root, 'data');
    await mkdir(join(paseoHome, 'agents'), { recursive: true });
    await mkdir(join(dataRoot, 'shell-jobs'), { recursive: true });
    const store = new JournalStore(stateRoot);
    const record = store.create('bridge', '/work', 'prompt');
    record.nativeSessionId = 'sess_owner';
    record.items.push({ item: { type: 'user_message', id: 'user:1', text: 'work' }, timestamp: new Date().toISOString() });
    store.save(record);
    const agent = extra => writeFile(join(paseoHome, 'agents', 'owner.json'), JSON.stringify({
        id: agentId, provider: 'paseodog', persistence: { metadata: {
            pluginProviderPersistence: { data: { bridgeId: 'bridge' } } } }, ...extra }));
    await agent({});
    const job = { jobId: 'job_1_test', ownerSessionId: 'sess_owner', pid: 12, status: 'running' };
    const writeJob = changes => writeFile(join(dataRoot, 'shell-jobs', `${job.jobId}.json`), JSON.stringify({ ...job, ...changes }));
    const config = { stateRoot, paseoHome, dataRoot, store, isAlive: () => true, log() {}, ...options };
    return { store, agent, writeJob, dataRoot, config, service: createBackgroundResults(config) };
}
function reports(store) { return store.load('bridge').items.filter(row => row.item.type === 'notification'); }

for (const [exitCode, expected] of [[0, '성공'], [7, '실패']]) {
    test(`shell terminal ${exitCode} is journaled once without user input or a model`, async t => {
        const f = await setup(t);
        await f.writeJob({}); await f.service.scan();
        assert.equal(reports(f.store).length, 0);
        await f.writeJob({ status: 'completed', exitCode, command: 'secret command', stdoutPreview: 'secret token' });
        await f.service.scan(); await f.service.scan();
        assert.equal(reports(f.store).length, 1);
        assert.match(reports(f.store)[0].item.message, new RegExp(expected));
        assert.doesNotMatch(JSON.stringify(f.store.load('bridge')), /secret/);
        const receipt = Object.values(f.store.load('bridge').receipts)[0];
        assert.equal(receipt.result.ai, 'not-requested');
        assert.equal(receipt.result.clientReceived, null);
    });
}
test('idle session and disconnected client recover after restart; duplicate event remains single-copy', async t => {
    const f = await setup(t);
    await f.writeJob({}); await f.service.scan();
    await f.writeJob({ status: 'completed', exitCode: 0 });
    const restarted = createBackgroundResults(f.config);
    await restarted.scan(); await restarted.scan();
    assert.equal(f.store.load('bridge').active, null);
    assert.equal(reports(f.store).length, 1);
});
test('missing monitor and restart loss mean unknown, not remote failure or replay', async t => {
    const f = await setup(t);
    await f.writeJob({}); await f.service.scan();
    await rm(join(f.dataRoot, 'shell-jobs', 'job_1_test.json'));
    await createBackgroundResults(f.config).scan();
    assert.match(reports(f.store)[0].item.message, /결과 불명/);
    assert.equal(shellObservation({ jobId: 'job_x', ownerSessionId: 'sess_owner', status: 'failed',
        error: 'daemon restarted while this shell task was running; its outcome was lost. Re-run the command' }), 'unknown');
});
test('foreground, foreign, archived and live-locked sessions are not adopted', async t => {
    const f = await setup(t);
    await f.writeJob({ foreground: true, status: 'completed', exitCode: 0 }); await f.service.scan();
    await f.writeJob({ ownerSessionId: 'foreign', status: 'completed', exitCode: 0 }); await f.service.scan();
    await f.writeJob({ status: 'completed', exitCode: 0 });
    const release = f.store.acquire('bridge');
    await f.service.scan(); release();
    await f.agent({ archivedAt: '2026-01-01' }); await f.service.scan();
    assert.equal(reports(f.store).length, 0);
});
test('remote registration is explicit, read-only, durable and bound to the original job ID', async t => {
    const calls = [];
    const f = await setup(t, { fetchStatus: async (url, options) => {
        calls.push({ url, options });
        return new Response(JSON.stringify({ jobId: 'remote-1', status: 'failed' }));
    } });
    const input = { action: 'register', agentId, jobId: 'remote-1', url: 'https://status.invalid/jobs/remote-1', confirmed: true };
    await assert.rejects(f.service.request({ ...input, confirmed: false }));
    await f.service.request(input);
    await createBackgroundResults(f.config).scan();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, 'GET');
    assert.equal(calls[0].options.redirect, 'error');
    assert.match(reports(f.store)[0].item.message, /원격 작업 remote-1: 실패/);
    await f.service.scan();
    assert.equal(calls.length, 1);
    assert.doesNotMatch(JSON.stringify(await f.service.request({ action: 'status', agentId })), /status.invalid/);
    await assert.rejects(probeRemote({ jobId: 'other', url: input.url }, { fetchStatus: f.config.fetchStatus }));
});
test('unresponsive remote produces unknown with backoff and can later reconcile success', async t => {
    let time = 100, calls = 0, online = false;
    const f = await setup(t, { now: () => time, fetchStatus: async () => {
        calls++; if (!online) throw new Error('secret network details');
        return new Response(JSON.stringify({ jobId: 'r1', status: 'completed' }));
    } });
    await f.service.request({ action: 'register', agentId, jobId: 'r1', url: 'https://status.invalid/r1', confirmed: true });
    await f.service.scan(); await f.service.scan();
    assert.equal(calls, 1);
    assert.match(reports(f.store)[0].item.message, /결과 불명/);
    online = true; time += 300000;
    await f.service.scan();
    assert.equal(reports(f.store).length, 2);
    assert.match(reports(f.store)[1].item.message, /성공/);
});
test('cancel and approval generation changes reject an in-flight status and never resume it', async t => {
    let finish, calls = 0;
    const f = await setup(t, { fetchStatus: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
    await f.service.request({ action: 'register', agentId, jobId: 'r1', url: 'https://status.invalid/r1', confirmed: true });
    const scan = f.service.scan();
    while (!finish) await new Promise(resolve => setImmediate(resolve));
    const record = f.store.load('bridge');
    revokeBackgroundWork(record); f.store.save(record);
    finish(new Response(JSON.stringify({ jobId: 'r1', status: 'completed' })));
    await scan; await createBackgroundResults(f.config).scan();
    assert.equal(calls, 1); assert.equal(reports(f.store).length, 0);
    await assert.rejects(f.service.request({ action: 'register', agentId, jobId: 'r1',
        url: 'https://status.invalid/r1', confirmed: true }), /revoked/);
});
test('remote monitoring cancellation does not claim the remote job was canceled', async t => {
    const f = await setup(t, { fetchStatus: () => assert.fail('revoked monitoring must not fetch') });
    await f.service.request({ action: 'register', agentId, jobId: 'r1', url: 'https://status.invalid/r1', confirmed: true });
    assert.deepEqual(await f.service.request({ action: 'cancel', agentId, jobId: 'r1' }),
        { monitoring: 'canceled', remoteCanceled: false });
    await f.service.scan();
});
test('live result persists before publication and replays offline without model execution', async t => {
    const f = fixture();
    t.after(() => f.connection.close());
    await f.ready();
    const record = f.store.list()[0];
    const row = { item: { type: 'notification', id: 'background:test', level: 'info', message: 'done' },
        timestamp: new Date().toISOString() };
    const saved = f.store.save.bind(f.store);
    f.store.save = next => {
        assert.equal(f.events.some(event => event.item?.id === row.item.id), false);
        saved(next);
    };
    f.connection.backgroundRecord(record.id, next => { next.items.push(row); return { changed: true, rows: [row] }; });
    f.store.save = saved;
    assert.equal(f.calls.some(call => call.text), false);
    assert.equal(f.events.filter(event => event.item?.id === row.item.id).length, 1);
    await f.connection.send({ type: 'session.interrupt', sessionId: 'p1', requestId: 'stop' });
    await until(f.events, event => event.type === 'request.completed' && event.requestId === 'stop');
    assert.equal(f.store.load(record.id).backgroundEpoch, 1);
});
test('journal failure does not publish or acknowledge a result', async t => {
    const f = fixture(); t.after(() => f.connection.close()); await f.ready();
    const original = f.store.save;
    f.store.save = () => { throw new Error('ENOSPC'); };
    assert.throws(() => f.connection.backgroundRecord(f.store.list()[0].id, next => {
        const row = { item: { type: 'notification', id: 'unsaved', level: 'info', message: 'done' } };
        next.items.push(row); return { changed: true, rows: [row] };
    }), /ENOSPC/);
    f.store.save = original;
    assert.equal(f.events.some(event => event.item?.id === 'unsaved'), false);
});
test('canceled local task is reported without claiming remote cancellation', async t => {
    const f = await setup(t);
    await f.writeJob({ status: 'canceled' }); await f.service.scan();
    assert.match(reports(f.store)[0].item.message, /취소.*원격 작업의 성공·실패와는 별개/);
});
test('status probes reject redirects, credentials, oversized responses and honor timeout', async t => {
    const f = await setup(t);
    const input = { action: 'register', agentId, jobId: 'r1', confirmed: true };
    await assert.rejects(f.service.request({ ...input, url: 'http://status.invalid/r1' }));
    await assert.rejects(f.service.request({ ...input, url: 'https://user:secret@status.invalid/r1' }));
    await assert.rejects(probeRemote({ jobId: 'r1', url: 'https://status.invalid/r1' },
        { fetchStatus: async () => new Response('x'.repeat(65537)) }), /limit/);
    const hold = setTimeout(() => {}, 1000);
    try {
        await assert.rejects(probeRemote({ jobId: 'r1', url: 'https://status.invalid/r1' },
            { timeoutMs: 5, fetchStatus: async (_url, { signal }) => new Promise((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            }) }), /timeout/i);
    } finally { clearTimeout(hold); }
});
test('model failure cannot suppress the independent journal result, and reconnect replays it', async t => {
    const f = fixture({ async ask() { throw new Error('Model unavailable'); } });
    await f.ready(); await f.run();
    const persistence = f.events.find(event => event.type === 'session.opened').persistence;
    const bridgeId = f.store.list()[0].id;
    const row = { item: { type: 'notification', id: 'result-after-model-failure', level: 'warning', message: 'remote failed' },
        timestamp: new Date().toISOString() };
    f.connection.backgroundRecord(bridgeId, record => { record.items.push(row); return { changed: true, rows: [row] }; });
    await f.connection.close();
    const g = fixture({}, { store: f.store }); t.after(() => g.connection.close());
    await g.connection.send({ ...g.open, persistence, history: 'replay' });
    await until(g.events, event => event.type === 'session.ready');
    assert.equal(g.events.filter(event => event.item?.id === row.item.id).length, 1);
    assert.equal(g.calls.some(call => call.text), false);
});
test('journal failure during cancellation still stops the engine', async t => {
    const f = fixture({ async ask() { return new Promise(() => {}); } });
    t.after(() => f.connection.close());
    await f.ready(); await f.connection.send(f.prompt);
    await until(f.events, event => event.type === 'session.turn' && event.state === 'started');
    const save = f.store.save;
    f.store.save = () => { throw new Error('ENOSPC'); };
    await f.connection.send({ type: 'session.interrupt', sessionId: 'p1', requestId: 'stop' });
    await until(f.events, event => event.type === 'request.completed' && event.requestId === 'stop');
    f.store.save = save;
    assert.ok(f.calls.some(call => call.kill));
});

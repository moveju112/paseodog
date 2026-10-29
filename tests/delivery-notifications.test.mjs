import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { scratchPath } from '../scripts/paths.mjs';
import { registerDeliveryReport, readDeliveryReport, settleDeliveryReport, dispatchDeliveryReports,
    scheduleDeliveryReports, deliveryReportPrompt } from '../plugin/server/delivery-notifications.mjs';
import { sendDeliveryReport } from '../scripts/delivery-notify.mjs';
import { startDelivery, executeDelivery } from '../scripts/release-pipeline.mjs';

const agentId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const commit = 'a'.repeat(40);

async function fixture(t) {
    const root = await mkdtemp(scratchPath('paseodog-delivery-notify-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const stateRoot = join(root, 'sessions'), paseoHome = join(root, 'paseo'), workspace = join(root, 'delivery');
    await mkdir(join(paseoHome, 'agents', 'project'), { recursive: true });
    await mkdir(workspace);
    const agent = async (id = agentId, extra = {}) => writeFile(join(paseoHome, 'agents', 'project', `${id}.json`),
        JSON.stringify({ id, provider: 'paseodog', persistence: {
            metadata: { pluginProviderPersistence: { data: { bridgeId: `bridge-${id}` } } },
        }, ...extra }));
    await agent();
    const snapshot = async (stages = {}) => writeFile(join(workspace, 'release-state.json'),
        JSON.stringify({ identity: { commit }, stages }));
    const register = () => registerDeliveryReport(stateRoot, { workspace, agentId });
    return { root, stateRoot, paseoHome, workspace, agent, snapshot, register };
}

test('the original recipient is captured before detachment and never replaced by later input', async t => {
    const f = await fixture(t);
    const calls = [];
    await startDelivery('/config.json', { workspace: f.workspace, notifyAgentId: agentId }, {
        reportRoot: f.stateRoot, run: async (...args) => calls.push(args),
    });
    const report = await f.register();
    assert.equal(report.agentId, agentId);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'systemd-run');
    await f.agent(otherId);
    await assert.rejects(registerDeliveryReport(f.stateRoot, { workspace: f.workspace, agentId: otherId }), /recipient changed/);
    assert.equal((await readDeliveryReport(f.stateRoot, report.id)).agentId, agentId);
});

test('delivery start failure retains a terminal result without storing raw errors', async t => {
    const f = await fixture(t);
    await assert.rejects(startDelivery('/config.json', { workspace: f.workspace, notifyAgentId: agentId }, {
        reportRoot: f.stateRoot, run: async () => { throw new Error('secret credential'); },
    }), /secret credential/);
    const report = await f.register();
    assert.equal(report.result.status, 'failed');
    assert.equal(report.result.stage, 'preflight');
    assert.doesNotMatch(JSON.stringify(report), /secret|credential/);
});

test('competing registrations cannot overwrite the captured recipient', async t => {
    const f = await fixture(t);
    const results = await Promise.allSettled([agentId, otherId].map(id =>
        registerDeliveryReport(f.stateRoot, { workspace: f.workspace, agentId: id })));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    const winner = results.find(result => result.status === 'fulfilled').value;
    assert.equal((await readDeliveryReport(f.stateRoot, winner.id)).agentId, winner.agentId);
});

test('separate deliveries with identical outcomes never share a deduplication key', async t => {
    const f = await fixture(t);
    const otherWorkspace = join(f.root, 'other-delivery');
    await mkdir(otherWorkspace);
    await f.register();
    await registerDeliveryReport(f.stateRoot, { workspace: otherWorkspace, agentId });
    const first = await settleDeliveryReport(f.stateRoot, f.workspace, 'failed');
    const second = await settleDeliveryReport(f.stateRoot, otherWorkspace, 'failed');
    assert.notEqual(first.eventId, second.eventId);
});

for (const outcome of ['complete', 'failed', 'preflight']) {
    test(`terminal ${outcome} is persisted for a later follow-up, without repeating delivery`, async t => {
        const f = await fixture(t);
        const registered = await f.register();
        let calls = 0;
        const run = executeDelivery({ workspace: f.workspace }, {
            reportRoot: f.stateRoot,
            preflight: async () => {
                if (outcome === 'preflight') throw new Error('preflight failed');
            },
            deliver: async () => {
                calls++;
                await f.snapshot({ 'runtime-update': { status: outcome, attempt: 1 } });
                if (outcome === 'failed') throw new Error('secret daemon error');
                return { commit };
            },
        });
        if (outcome === 'complete') assert.deepEqual(await run, { commit });
        else await assert.rejects(run);
        assert.equal(calls, outcome === 'preflight' ? 0 : 1);
        const report = await readDeliveryReport(f.stateRoot, registered.id);
        assert.equal(report.result.status, outcome === 'complete' ? 'complete' : 'failed');
        assert.doesNotMatch(deliveryReportPrompt(report), /secret daemon error/);
        assert.match(deliveryReportPrompt(report), /재실행하지 마/);
        assert.equal(report.deliveredEventId, null);
    });
}

test('plugin restart and repeated scans deliver a completed result only once to the original agent', async t => {
    const f = await fixture(t);
    const registered = await f.register();
    await f.snapshot({ verify: { status: 'complete', attempt: 1 } });
    await settleDeliveryReport(f.stateRoot, f.workspace, 'complete');
    const sent = [];
    const options = { ...f, send: async (_cli, report) => { sent.push(report); return true; } };
    assert.deepEqual(await dispatchDeliveryReports(options), [registered.id]);
    assert.deepEqual(await dispatchDeliveryReports({ ...options }), []);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].agentId, agentId);
    assert.equal((await readDeliveryReport(f.stateRoot, registered.id)).deliveredEventId, sent[0].eventId);
});

test('lost ACK retries reuse the same persistent message ID instead of creating duplicate reports', async t => {
    const f = await fixture(t);
    const registered = await f.register();
    await f.snapshot();
    await settleDeliveryReport(f.stateRoot, f.workspace, 'complete');
    const receipts = new Set(), ids = [];
    let notifications = 0, loseAck = true;
    const send = async (_cli, report) => {
        ids.push(report.eventId);
        if (!receipts.has(report.eventId)) { receipts.add(report.eventId); notifications++; }
        if (loseAck) throw new Error('ACK lost');
        return true;
    };
    const options = { ...f, send, log() {} };
    assert.deepEqual(await dispatchDeliveryReports(options), []);
    assert.equal((await readDeliveryReport(f.stateRoot, registered.id)).deliveredEventId, null);
    loseAck = false;
    assert.deepEqual(await dispatchDeliveryReports(options), [registered.id]);
    assert.equal(notifications, 1);
    assert.equal(ids.length, 2);
    assert.equal(ids[0], ids[1]);
});

test('an uncertain server receipt is retained for reconciliation and never replayed under a new ID', async t => {
    const f = await fixture(t);
    const registered = await f.register();
    await settleDeliveryReport(f.stateRoot, f.workspace, 'failed');
    let sends = 0;
    const options = { ...f, log() {}, send: async () => {
        sends++;
        throw Object.assign(new Error('secret'), { code: 2 });
    } };
    await dispatchDeliveryReports(options);
    await dispatchDeliveryReports({ ...options });
    assert.equal(sends, 1);
    const report = await readDeliveryReport(f.stateRoot, registered.id);
    assert.equal(report.blockedEventId, report.eventId);
    assert.equal(report.deliveredEventId, null);
});

test('archived or internal agents are not reopened and unrelated conversations are never selected', async t => {
    const f = await fixture(t);
    await f.register();
    await settleDeliveryReport(f.stateRoot, f.workspace, 'complete');
    let sends = 0;
    const options = { ...f, send: async () => { sends++; return true; } };
    await f.agent(otherId);
    await f.agent(agentId, { archivedAt: '2026-01-01T00:00:00Z' });
    await dispatchDeliveryReports(options);
    await f.agent(agentId, { internal: true });
    await dispatchDeliveryReports(options);
    assert.equal(sends, 0);
});

test('an older uncertain send cannot overwrite a newer terminal result', async t => {
    const f = await fixture(t);
    const registered = await f.register();
    await settleDeliveryReport(f.stateRoot, f.workspace, 'failed');
    await dispatchDeliveryReports({ ...f, log() {}, send: async () => {
        await f.snapshot({ publish: { status: 'complete', attempt: 2 } });
        await settleDeliveryReport(f.stateRoot, f.workspace, 'complete');
        throw Object.assign(new Error('uncertain'), { code: 2 });
    } });
    const current = await readDeliveryReport(f.stateRoot, registered.id);
    assert.equal(current.result.status, 'complete');
    assert.notEqual(current.blockedEventId, current.eventId);
});

test('new results after an explicitly retried delivery receive a distinct receipt identity', async t => {
    const f = await fixture(t);
    const registered = await f.register();
    await f.snapshot({ publish: { status: 'failed', attempt: 1 } });
    const failed = await settleDeliveryReport(f.stateRoot, f.workspace, 'failed');
    await dispatchDeliveryReports({ ...f, send: async () => true });
    await f.snapshot({ publish: { status: 'complete', attempt: 2 } });
    const completed = await settleDeliveryReport(f.stateRoot, f.workspace, 'complete');
    assert.notEqual(completed.eventId, failed.eventId);
    assert.notEqual(completed.deliveredEventId, completed.eventId);
    assert.deepEqual(await dispatchDeliveryReports({ ...f, send: async () => true }), [registered.id]);
});

test('result data remains available after the disposable delivery workspace is removed', async t => {
    const f = await fixture(t);
    const registered = await f.register();
    await f.snapshot({ verify: { status: 'complete', attempt: 1 } });
    await settleDeliveryReport(f.stateRoot, f.workspace, 'complete');
    await rm(f.workspace, { recursive: true });
    let result;
    await dispatchDeliveryReports({ ...f, send: async (_cli, report) => { result = report.result; return true; } });
    assert.equal(result.commit, commit);
    assert.equal((await readDeliveryReport(f.stateRoot, registered.id)).result.status, 'complete');
});

test('the dedicated authenticated client sends a stable ID, never interrupts, and closes after failures', async t => {
    const f = await fixture(t);
    const registered = await f.register();
    await settleDeliveryReport(f.stateRoot, f.workspace, 'complete');
    let state = 'running', closed = 0, fail = false;
    const messages = [];
    const client = {
        fetchAgent: async () => ({ agent: { provider: 'paseodog', status: state, pendingPermissions: [] } }),
        sendAgentMessage: async (...args) => { messages.push(args); if (fail) throw new Error('ACK lost'); },
        close: async () => { closed++; },
    };
    const options = { stateRoot: f.stateRoot, home: f.paseoHome, connect: async request => {
        assert.deepEqual(request, { target: { kind: 'instance', home: f.paseoHome } });
        return client;
    } };
    assert.equal(await sendDeliveryReport(registered.id, options), false);
    assert.equal(messages.length, 0);
    state = 'idle';
    assert.equal(await sendDeliveryReport(registered.id, options), true);
    fail = true;
    await assert.rejects(sendDeliveryReport(registered.id, options), /ACK lost/);
    assert.equal(closed, 3);
    assert.equal(messages[0][0], agentId);
    assert.equal(messages[0][2].activeTurnBehavior, 'steer');
    assert.equal(messages[0][2].messageId, messages[1][2].messageId);
});

test('missing or malformed recipients are rejected without creating a report', async t => {
    const f = await fixture(t);
    await assert.rejects(registerDeliveryReport(f.stateRoot, { workspace: f.workspace, agentId: 'latest' }), /exact agent UUID/);
    await assert.rejects(readDeliveryReport(f.stateRoot, '../other'), /Invalid delivery report ID/);
});

test('a damaged deduplication identity is not replaced with a random message ID', async t => {
    const f = await fixture(t);
    await f.register();
    const report = await settleDeliveryReport(f.stateRoot, f.workspace, 'failed');
    delete report.eventId;
    await writeFile(join(f.stateRoot, 'delivery-reports', `${report.id}.json`), JSON.stringify(report));
    let sends = 0;
    await dispatchDeliveryReports({ ...f, log() {}, send: async () => { sends++; return true; } });
    assert.equal(sends, 0);
    await assert.rejects(readDeliveryReport(f.stateRoot, report.id), /Invalid delivery report/);
});

test('the background scanner survives errors, does not overlap scans, and is disposed with the plugin', async t => {
    const f = await fixture(t);
    const cli = join(f.root, 'cli');
    await writeFile(cli, '');
    let calls = 0, release;
    const gate = new Promise(resolve => { release = resolve; });
    const stop = scheduleDeliveryReports({ cli, intervalMs: 5,
        env: { PASEODOG_STATE_DIR: f.stateRoot, PASEO_HOME: f.paseoHome },
        run: async () => { calls++; await gate; throw new Error('secret'); }, log() {} });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(calls, 1);
    stop();
    release();
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(calls, 1);
    scheduleDeliveryReports({ env: {}, run: () => assert.fail('not configured') })();
});

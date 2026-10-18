import test from 'node:test';
import assert from 'node:assert/strict';
import { controlRuntime, modelProjection } from '../engine/src/controls.mjs';
import { createEngineControls } from '../plugin/server/controls.mjs';
import { fixture, until } from './helpers.mjs';

// 네이티브 설정 API만 호출하는 검증용 런타임
function runtime() {
    const calls = [];
    const value = {
        provider: 'subscription', model: 'small', effort: 'low', fast: false, autoEffort: false,
        async listProviderModels() { return [{ provider: 'subscription', id: 'small', name: 'Small', secret: 'never-export' }]; },
        listWorkflows() { return [{ id: 'default', name: 'Default', active: true, body: 'private instructions' }]; },
        listAgents() { return [{ id: 'worker', label: 'Worker', disabled: true, route: { provider: 'subscription', model: 'small' }, definition: 'private' }]; },
        getCompactionSettings() { return { auto: true, onModelChange: true, mainBufferPercent: 0.2, private: 'hidden' }; },
        getAutoClear() { return { enabled: false, idleMs: 3600000, minContextPercent: 15 }; },
        getOrchestrationMode() { return 'focused'; },
        getWorkflowPack(id = 'default') { return { id, name: 'Default', description: 'desc', body: '# Workflow\nStep 1', source: 'builtin', userOverride: false }; },
        setRoute(...args) { calls.push(['main', ...args]); },
        setAgentRoute(...args) { calls.push(['agent', ...args]); },
        setCompactionSettings(...args) { calls.push(['compaction', ...args]); },
        setAutoClear(...args) { calls.push(['autoClear', ...args]); },
        setWorkflow(...args) { calls.push(['workflow', ...args]); },
        saveWorkflowPack(payload) { calls.push(['workflowSave', payload]); return { id: payload.id, name: payload.name || 'Default', body: payload.body }; },
        createWorkflow(payload) { calls.push(['workflowCreate', payload]); return { id: 'fast-tdd', name: payload.name, body: payload.body }; },
        deleteWorkflow(...args) { calls.push(['workflowDelete', ...args]); },
        setOrchestrationMode(...args) { calls.push(['orchestration', ...args]); },
    };
    return { value, calls };
}

test('read projects public settings only without inference or mutation', async () => {
    const { value, calls } = runtime();
    const result = await controlRuntime(value);
    assert.equal(result.route.model, 'small');
    assert.equal(result.appliesTo, 'new-sessions');
    assert.equal(result.compaction.auto, true);
    assert.equal(result.compaction.onModelChange, true);
    assert.equal(result.compaction.mainBufferPercent, 0.2);
    assert.equal(result.autoClear.enabled, false);
    assert.deepEqual(calls, []);
    assert.doesNotMatch(JSON.stringify(result), /never-export|private instructions|definition|hidden/);
});

test('main and agent selections use distinct native persistence APIs', async () => {
    const { value, calls } = runtime();
    await controlRuntime(value, { action: 'main', route: { provider: 'subscription', model: 'small' } });
    await controlRuntime(value, { action: 'agent', agent: 'worker', route: { provider: '' } });
    assert.deepEqual(calls, [
        ['main', { provider: 'subscription', model: 'small' }, { keepMainModel: false }],
        ['agent', 'worker', { provider: '' }],
    ]);
});

test('compaction, autoClear, workflow and orchestration changes use native setters', async () => {
    const { value, calls } = runtime();
    await controlRuntime(value, { action: 'compaction', enabled: false, onModelChange: false, mainBufferPercent: 0.15 });
    await controlRuntime(value, { action: 'autoClear', enabled: true, idleMs: 1800000, minContextPercent: 20 });
    await controlRuntime(value, { action: 'workflow', workflow: 'default' });
    const packRes = await controlRuntime(value, { action: 'workflowPack', workflow: 'default' });
    assert.equal(packRes.workflowPack.body, '# Workflow\nStep 1');
    await controlRuntime(value, { action: 'workflowSave', workflow: 'default', body: '# Updated', activate: true });
    await controlRuntime(value, { action: 'workflowCreate', name: 'Fast TDD', description: 'Quick', body: '# Fast TDD', activate: false });
    await controlRuntime(value, { action: 'orchestration', mode: 'swarm' });
    assert.deepEqual(calls, [
        ['compaction', { enabled: false, onModelChange: false, mainBufferPercent: 0.15 }],
        ['autoClear', { enabled: true, idleMs: 1800000, minContextPercent: 20 }],
        ['workflow', 'default'],
        ['workflowSave', { id: 'default', name: undefined, description: undefined, body: '# Updated' }],
        ['workflow', 'default'],
        ['workflowCreate', { id: undefined, name: 'Fast TDD', description: 'Quick', body: '# Fast TDD' }],
        ['orchestration', 'swarm'],
    ]);
});

test('invalid models, agents, keys and modes fail before saving', async () => {
    const { value, calls } = runtime();
    for (const request of [
        { action: 'main', route: { provider: 'paid', model: 'invented' } },
        { action: 'main', route: { apiKey: 'secret' } },
        { action: 'main', route: { fast: 'yes' } },
        { action: 'agent', agent: 'foreign', route: {} },
        { action: 'workflow', workflow: 'missing' },
        { action: 'orchestration', mode: 'invented' },
        { action: 'compaction', enabled: 'yes' },
        { action: 'delete' },
    ]) await assert.rejects(controlRuntime(value, request));
    assert.deepEqual(calls, []);
});

test('model effort choices preserve catalog options', () => {
    assert.deepEqual(modelProjection({ id: 'm', provider: 'p', effortOptions: ['low', { value: 'high', label: 'High' }] }).effortOptions,
        [{ id: 'low', label: 'low' }, { id: 'high', label: 'High' }]);
});

test('control process reads are cached and writes are serialized and refresh the cache', async () => {
    const calls = [];
    const controls = createEngineControls({ execCommand: async (command, args) => {
        calls.push(JSON.parse(args.at(-1)));
        return { stdout: JSON.stringify({ revision: calls.length }) };
    } });
    controls.bind({ command: '/engine', args: [], env: {} });
    assert.equal((await controls.read()).revision, 1);
    assert.equal((await controls.read()).revision, 1);
    await controls.read({ action: 'compaction', enabled: false });
    assert.equal((await controls.read()).revision, 2);
    await controls.read({ action: 'read', refresh: true });
    assert.equal(calls.length, 3);
});

test('process errors never expose stderr credentials', async () => {
    const controls = createEngineControls({ execCommand: async () => { throw new Error('token=private'); } });
    controls.bind({ command: '/engine', args: [], env: {} });
    await assert.rejects(controls.read(), (error) => !error.message.includes('private'));
});

test('native catalog supplies provider model and effort choices; explicit effort wins', async (t) => {
    const snapshot = {
        route: { provider: 'subscription', model: 'small', effort: 'low', autoEffort: false, fast: false },
        models: [{ provider: 'subscription', id: 'small', label: 'Small', effortOptions: [{ id: 'high', label: 'High' }] }],
    };
    const f = fixture({ async status() { return { compaction: { auto: true }, jobs: [] }; } },
        { loadCatalog: async () => snapshot });
    t.after(() => f.connection.close());
    await f.connection.send({ type: 'catalog', requestId: 'models' });
    const event = await until(f.events, (item) => item.type === 'catalog');
    assert.equal(event.catalog.models[1].id, 'subscription/small');
    assert.equal(event.catalog.models[1].thinkingOptions[0].id, 'high');
    f.open.config.thinkingOption = 'high';
    await f.ready();
    assert.equal(f.creates[0].route.effort, 'high');
    const sessions = await f.connection.engineStatus();
    assert.equal(sessions[0].compaction.auto, true);
});

test('live status distinguishes child approval waiting from running and clears after denial', async (t) => {
    const f = fixture({
        async status() { return { jobs: [{ id: 'job', sessionId: 'child', status: 'running', model: 'small' }] }; },
        async ask(text, callbacks) { await callbacks.onToolApproval({ name: 'shell', childSessionId: 'child', args: {} }); return { content: 'done' }; },
    }, { permissionMs: 5000 });
    t.after(() => f.connection.close());
    await f.ready();
    await f.connection.send(f.prompt);
    const approval = await until(f.events, (event) => event.type === 'session.permission');
    const waiting = (await f.connection.engineStatus())[0];
    assert.equal(waiting.state, 'waiting-approval');
    assert.equal(waiting.approvalCount, 1);
    assert.equal(waiting.jobs[0].waitingApproval, true);
    await f.connection.send({ type: 'session.interrupt', requestId: 'stop', sessionId: 'p1' });
    assert.equal((await f.connection.engineStatus())[0].jobs[0].waitingApproval, false);
    assert.ok(approval.request.id);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
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
    assert.equal(result.orchestration, 'swarm');
    assert.equal(result.orchestrationScope, 'host');
    assert.equal(result.orchestrationAppliesTo, 'next-turn');
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
        ['compaction', { enabled: false, onModelChange: false, mainBufferRatio: 0.15 }],
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
        { action: 'orchestration', mode: 'focused' },
        { action: 'orchestration', mode: 'balanced' },
        { action: 'compaction', enabled: 'yes' },
        { action: 'delete' },
    ]) await assert.rejects(controlRuntime(value, request));
    assert.deepEqual(calls, []);
});

test('workflow creation preserves explicit custom bytes without route changes', async () => {
    const { value, calls } = runtime();
    const body = ' \r\n# Custom 한글\r\nKeep spacing.  \r\n';
    const result = await controlRuntime(value, {
        action: 'workflowCreate', name: 'Different title', description: 'Not template content',
        body, activate: false,
    });
    assert.deepEqual(Buffer.from(calls[0][1].body), Buffer.from(body));
    assert.equal(result.workflowPack.body, body);
    assert.deepEqual(calls.map(([action]) => action), ['workflowCreate']);
});

test('saving an empty active workflow does not reactivate the default document', async () => {
    const { value, calls } = runtime();
    await controlRuntime(value, { action: 'workflowSave', workflow: 'default', body: ' \n', activate: true });
    assert.equal(calls.find(([action]) => action === 'workflow')[1], 'none');
});

test('agent definition cannot be saved without an explicitly selected model', async () => {
    const { value, calls } = runtime();
    value.listAgents = () => [{ id: 'worker', route: {}, disabled: true }];
    value.saveAgentDefinition = () => { throw new Error('must not save'); };
    await assert.rejects(controlRuntime(value, { action: 'agentSave', agent: 'worker', body: '# Worker', expectedRevision: 'a'.repeat(24) }),
        /Select an agent model/);
    assert.deepEqual(calls, []);
});

test('agent definition inspection preserves native body bytes and only returns editor fields without mutation', async () => {
    const { value, calls } = runtime();
    const before = structuredClone(value.listAgents());
    const expected = {
        id: 'worker', name: ' Native Worker ', description: ' Original description\n',
        body: ' \r\n# Original 한글\r\nKeep spacing.  \r\n', custom: true, userOverride: false,
        revision: 'a'.repeat(24),
    };
    const inspections = [];
    value.getAgentDefinition = async (id) => {
        inspections.push(id);
        return { ...expected, route: { provider: 'private-route' }, disabled: true,
            filePath: '/private/profile/AGENT.md', secret: 'never-export' };
    };
    const result = await controlRuntime(value, { action: 'agentDefinition', agent: 'worker' });
    assert.deepEqual(result.agentDefinition, expected);
    assert.deepEqual(Buffer.from(result.agentDefinition.body), Buffer.from(expected.body));
    assert.deepEqual(inspections, ['worker']);
    assert.deepEqual(calls, []);
    assert.deepEqual(value.listAgents(), before);
    assert.doesNotMatch(JSON.stringify(result.agentDefinition), /private-route|private\/profile|never-export|disabled/);
});

test('unknown agent definition is rejected before native inspection without mutation', async () => {
    const { value, calls } = runtime();
    let inspections = 0;
    value.getAgentDefinition = () => { inspections += 1; throw new Error('Must not inspect'); };
    for (const agent of ['unknown', undefined, 'title-agent']) {
        await assert.rejects(controlRuntime(value, { action: 'agentDefinition', agent }), /Unknown agent/);
    }
    assert.equal(inspections, 0);
    assert.deepEqual(calls, []);
});

test('agent definition inspection reports unsupported runtime clearly without mutation', async () => {
    const { value, calls } = runtime();
    await assert.rejects(controlRuntime(value, { action: 'agentDefinition', agent: 'worker' }),
        { message: 'Agent definition inspection not supported' });
    assert.deepEqual(calls, []);
});

test('model effort choices preserve catalog options', () => {
    assert.deepEqual(modelProjection({ id: 'm', provider: 'p', effortOptions: ['low', { value: 'high', label: 'High' }] }).effortOptions,
        [{ id: 'low', label: 'low' }, { id: 'high', label: 'High' }]);
});

test('instruction loading toggles native mode only and preserves selective read settings', async () => {
    const { value, calls } = runtime();
    let mode = 'agents';
    value.getToolModuleSettings = () => ({ instructionFiles: mode, private: 'hidden' });
    value.setInstructionFiles = async (next) => { calls.push(['instructionFiles', next]); mode = next; };
    assert.equal((await controlRuntime(value)).instructionFiles, 'agents');
    assert.deepEqual(calls, []);
    assert.equal((await controlRuntime(value, { action: 'instructionFiles', enabled: true })).instructionFiles, 'all');
    assert.equal((await controlRuntime(value, { action: 'instructionFiles', enabled: false })).instructionFiles, 'off');
    assert.deepEqual(calls, [['instructionFiles', 'all'], ['instructionFiles', 'off']]);
    for (const enabled of [undefined, 'true', 1]) {
        await assert.rejects(controlRuntime(value, { action: 'instructionFiles', enabled }), /enabled must be boolean/);
    }
    delete value.setInstructionFiles;
    await assert.rejects(controlRuntime(value, { action: 'instructionFiles', enabled: true }), /Instruction files not supported/);
});

test('control reads stay fresh and writes remain serialized', async () => {
    const calls = [];
    const controls = createEngineControls({ execCommand: async (command, args) => {
        calls.push(JSON.parse(args.at(-1)));
        return { stdout: JSON.stringify({ revision: calls.length }) };
    } });
    controls.bind({ command: '/engine', args: [], env: {} });
    assert.equal((await controls.read()).revision, 1);
    assert.equal((await controls.read()).revision, 2);
    await controls.read({ action: 'compaction', enabled: false });
    assert.equal((await controls.read()).revision, 4);
    await controls.read({ action: 'read', refresh: true });
    assert.equal(calls.length, 5);
});

test('process errors never expose stderr credentials', async () => {
    const controls = createEngineControls({ execCommand: async () => { throw new Error('token=private'); } });
    controls.bind({ command: '/engine', args: [], env: {} });
    await assert.rejects(controls.read(), (error) => !error.message.includes('private'));
});

test('saving an inactive workflow does not activate it and deactivating the current one selects none', async () => {
    for (const active of [true, false]) {
        const { value, calls } = runtime();
        value.listWorkflows = () => [{ id: 'default', active }];
        await controlRuntime(value, { action: 'workflowSave', workflow: 'default', body: '# Rules', activate: false });
        assert.deepEqual(calls.filter(([name]) => name === 'workflow'), active ? [['workflow', 'none']] : []);
    }
});

test('status failures clear stale jobs without hiding other connections', async () => {
    const controls = createEngineControls({});
    let failed = false;
    const remove = controls.register({ engineStatus: async () => {
        if (failed) throw new Error('Disconnected');
        return [{ bridgeId: 'first', jobs: [{ id: 'child', status: 'running' }] }];
    } });
    controls.register({ engineStatus: async () => [{ bridgeId: 'other', jobs: [] }] });
    await controls.sessions();
    failed = true;
    const rows = await controls.sessions();
    assert.deepEqual(rows.find((row) => row.bridgeId === 'first').jobs, []);
    assert.equal(rows.find((row) => row.bridgeId === 'first').state, 'unavailable');
    assert.deepEqual(rows.find((row) => row.bridgeId === 'other'), { bridgeId: 'other', jobs: [] });
    remove();
    await controls.close();
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
    const selectedModel = event.catalog.models.find((model) => model.id === 'subscription/small');
    assert.ok(selectedModel);
    assert.equal(selectedModel.thinkingOptions[0].id, 'high');
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
    assert.equal(waiting.id, f.open.sessionId);
    assert.equal(waiting.bridgeId, f.store.list()[0].id);
    assert.equal(waiting.state, 'waiting-approval');
    assert.equal(waiting.approvalCount, 1);
    assert.equal(waiting.jobs[0].waitingApproval, true);
    await f.connection.send({ type: 'session.interrupt', requestId: 'stop', sessionId: 'p1' });
    assert.equal((await f.connection.engineStatus())[0].jobs[0].waitingApproval, false);
    assert.ok(approval.request.id);
});

test('newly ported Mixdog settings (features, preferences, compaction extras, agent CRUD, fallbacks) invoke native APIs', async () => {
    const { value, calls } = runtime();
    value.setRecapEnabled = (v) => calls.push(['recap', v]);
    value.setMemoryToolsEnabled = (v) => calls.push(['memoryTools', v]);
    value.setWebSearchEnabled = (v) => calls.push(['webSearch', v]);
    value.setBuiltinToolEnabled = (id, v) => calls.push(['builtinTool', id, v]);
    value.installBuiltinFeature = (id) => calls.push(['installFeature', id]);
    value.setWebSearchRoute = (r) => calls.push(['webSearchRoute', r]);
    value.setOutputStyle = (s) => calls.push(['outputStyle', s]);
    value.setProfile = (p) => calls.push(['profile', p]);
    value.setAiSessionTitles = (v) => calls.push(['aiSessionTitles', v]);
    value.setSystemShell = (s) => calls.push(['shell', s]);
    value.setWorktreeSettings = (w) => calls.push(['worktree', w]);
    value.setDisabledSkills = (d) => calls.push(['disabledSkills', d]);
    value.addHookRule = (r) => calls.push(['addHook', r]);
    value.setHookRuleEnabled = (i, v) => calls.push(['toggleHook', i, v]);
    value.deleteHookRule = (i) => calls.push(['deleteHook', i]);
    value.flushHookRules = () => calls.push(['flushHooks']);
    value.saveAgentDefinition = (p) => { calls.push(['agentSave', p]); return { id: p.id, name: p.name || p.id, body: p.body }; };
    value.createAgentDefinition = (p) => { calls.push(['agentCreate', p]); return { id: 'qa-bot', name: p.name, body: p.body, custom: true }; };
    value.deleteAgentDefinition = (id) => calls.push(['agentDelete', id]);

    await controlRuntime(value, {
        action: 'compaction',
        mainBufferTokens: 32000,
        summaryModel: 'subscription/small',
    });
    await controlRuntime(value, {
        action: 'features',
        recap: false,
        memoryTools: true,
        webSearch: true,
        builtinTool: 'git',
        enabled: true,
        installFeature: 'office',
        webSearchRoute: { inherited: false, provider: 'subscription', model: 'small' },
    });
    await controlRuntime(value, {
        action: 'preferences',
        outputStyle: 'concise',
        profile: { title: 'Staff Eng', language: 'ko', experienceLevel: 'senior' },
        aiSessionTitles: true,
        shellCommand: '/bin/zsh',
        disabledSkills: ['legacy-skill'],
        hookAction: 'add',
        hookRule: { event: 'PreToolUse', matcher: 'Bash', command: 'echo ok' },
    });
    await controlRuntime(value, {
        action: 'agentSave',
        agent: 'worker',
        expectedRevision: 'a'.repeat(24),
        name: 'Worker Pro',
        description: 'Custom worker',
        body: '# Worker Prompt',
        route: { fallbacks: [{ provider: 'subscription', model: 'small', effort: 'low' }] },
    });
    await controlRuntime(value, {
        action: 'agentCreate',
        name: 'QA Bot',
        description: 'Tests code',
        body: '# QA Prompt',
        route: { provider: 'subscription', model: 'small' },
    });
    await controlRuntime(value, { action: 'agentDelete', agent: 'worker' });

    assert.deepEqual(calls, [
        ['compaction', { mainBufferTokens: 32000, summaryModel: 'subscription/small' }],
        ['recap', false],
        ['memoryTools', true],
        ['webSearch', true],
        ['builtinTool', 'git', true],
        ['installFeature', 'office'],
        ['webSearchRoute', { inherited: false, provider: 'subscription', model: 'small' }],
        ['outputStyle', 'concise'],
        ['profile', { title: 'Staff Eng', language: 'ko', experienceLevel: 'senior' }],
        ['aiSessionTitles', true],
        ['shell', { command: '/bin/zsh' }],
        ['disabledSkills', ['legacy-skill']],
        ['addHook', { event: 'PreToolUse', matcher: 'Bash', command: 'echo ok' }],
        ['flushHooks'],
        ['agentSave', {
            id: 'worker',
            name: 'Worker Pro',
            description: 'Custom worker',
            body: '# Worker Prompt',
            expectedRevision: 'a'.repeat(24),
            route: { fallbacks: [{ provider: 'subscription', model: 'small', effort: 'low' }] },
        }],
        ['agentSave', {
            id: undefined,
            name: 'QA Bot',
            description: 'Tests code',
            body: '# QA Prompt',
            createOnly: true,
            route: { provider: 'subscription', model: 'small' },
        }],
        ['agentDelete', 'worker'],
    ]);
});


// 제어 프로세스가 먼저 stdin을 닫으면 EPIPE를 소비하고 쓰기 요청을 재전송하지 않는다.
test('control daemon stdin failures reject uncertain writes without retrying mutations', async () => {
    const children = [];
    let fallbacks = 0;
    const controls = createEngineControls({
        spawnProcess() {
            const child = new EventEmitter();
            child.stdin = new PassThrough();
            child.stdout = new PassThrough();
            child.stderr = new PassThrough();
            child.kill = () => {};
            children.push(child);
            return child;
        },
        execCommand: async () => {
            fallbacks++;
            throw new Error('Must not retry a mutation');
        },
    });
    controls.bind({ command: '/engine', args: [], env: {} });
    try {
        const request = controls.read({ action: 'compaction', enabled: false });
        // 실제 stream 이벤트에서 발생하는 비동기 EPIPE도 예외 없이 정리해야 한다.
        while (children.length === 0) await new Promise(resolve => setImmediate(resolve));
        children[0].stdin.destroy(Object.assign(new Error('broken pipe'), { code: 'EPIPE' }));
        await assert.rejects(request, /설정 저장 결과를 확인할 수 없어요/);
        assert.equal(fallbacks, 0);
        // 처리 완료된 이전 프로세스의 늦은 이벤트가 새 프로세스에 영향을 주지 않는다.
        const next = controls.read({ action: 'compaction', enabled: true });
        while (children.length < 2) await new Promise(resolve => setImmediate(resolve));
        const old = children[0], fresh = children[1];
        old.emit('exit', 1);
        old.stdout.emit('error', new Error('old stdout error'));
        fresh.stdout.write(JSON.stringify({ id: 'ctl_2', ok: true, value: { saved: true } }) + '\n');
        assert.deepEqual(await next, { saved: true });
        assert.equal(fallbacks, 0);
    } finally {
        await controls.close();
        for (const child of children) {
            child.stdin.destroy();
            child.stdout.destroy();
            child.stderr.destroy();
        }
    }
});

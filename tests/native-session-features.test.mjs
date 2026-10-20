import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeEngine } from '../engine/src/native-engine.mjs';
import { nativeSessionAction } from '../engine/src/session-actions.mjs';
import { resourceControls } from '../engine/src/resource-controls.mjs';
import { fixture, deferred, until } from './helpers.mjs';

// 네이티브 API 호출과 세션 주소를 기록하는 무과금 런타임을 만든다.
async function nativeFixture() {
    const calls = [];
    const session = { id: 'native-original', provider: 'first', model: 'one', messages: [] };
    const runtime = {
        id: session.id, session, provider: 'first', model: 'one',
        ask() {}, abort() {}, close() {}, resume() {},
        compact(options) { calls.push(['compact', options]); return { changed: true }; },
        setRoute(route, options) { calls.push(['route', route, options]); Object.assign(session, route); },
        readModelMessages() { return { messageCount: 1, messages: [{ role: 'user', content: 'kept' }] }; },
        inheritToNewSession(id, options) { calls.push(['fork', id, options]); return { sessionId: 'native-heir', messages: session.messages }; },
        getTurnChanges(options) { calls.push(['changes', options]); return { files: [], revision: 4 }; },
        revertTurnChanges(...args) { calls.push(['undo', ...args]); return { ok: true }; },
        reapplyTurnChanges(...args) { calls.push(['redo', ...args]); return { ok: true }; },
    };
    const engine = await createNativeEngine({
        config: { cwd: '/work', mode: 'ask', mcpServers: {}, settings: {} },
        effortOptions: ['low'],
    }, { modules: { loadConfig: () => ({}), createMixdogSessionRuntime: async () => runtime } });
    return { engine, runtime, session, calls };
}

// 모델과 컨텍스트를 바꿔도 같은 세션을 유지하고 프로필 기본값은 저장하지 않는다.
test('native model switch and tuning are session-only; compact matches native chat', async () => {
    const f = await nativeFixture();
    try {
        const result = await f.engine.configure({ route: { provider: 'second', model: 'two', fast: true, contextPercent: 70 }, effortOptions: ['high'] });
        assert.equal(f.engine.id, 'native-original');
        assert.equal(result.route.model, 'two');
        assert.equal(result.route.contextPercent, 70);
        assert.deepEqual(f.calls[0][2], { applyToCurrentSession: true, sessionOnly: true, keepMainModel: true });
        await f.engine.compact();
        assert.deepEqual(f.calls[1], ['compact', { recoverAgent: true }]);
    } finally { await f.engine.close(); }
});

// 계승·복구·조회는 원본 구현에 전달하고 확인 없는 파일 변경은 거절한다.
test('native session actions delegate fork, checkpoint undo/redo and bounded model-message reads', async () => {
    const f = await nativeFixture();
    try {
        await assert.rejects(f.engine.action({ operation: 'fork' }), /확인/);
        assert.equal((await f.engine.action({ operation: 'fork', confirmed: true })).nativeSessionId, 'native-heir');
        assert.equal(f.engine.id, 'native-original');
        await f.engine.action({ operation: 'changes', checkpointId: 'checkpoint', file: 'file.txt' });
        await f.engine.action({ operation: 'undo', checkpointId: 'checkpoint', file: 'file.txt', revision: 4, confirmed: true });
        await f.engine.action({ operation: 'redo', checkpointId: 'checkpoint', file: 'file.txt', revision: 5, confirmed: true });
        assert.deepEqual(f.calls.find(([name]) => name === 'undo'), ['undo', 'checkpoint', 'file.txt', 4]);
        assert.deepEqual(f.calls.find(([name]) => name === 'redo'), ['redo', 'checkpoint', 'file.txt', 5]);
        const result = await f.engine.action({ operation: 'context' });
        assert.deepEqual(result.messages, [{ role: 'user', text: 'kept' }]);
        await assert.rejects(nativeSessionAction(f.runtime, { operation: 'context', messageStart: -1 }), /offset/);
        await assert.rejects(f.engine.action({ operation: 'undo', confirmed: false }), /확인/);
    } finally { await f.engine.close(); }
});

// 저장된 MCP는 이름을 직접 선택한 작업으로만 연결하고 전체 재연결은 허용하지 않는다.
test('session MCP connection requires an explicit named server and confirmation', async () => {
    const names = [];
    const runtime = {
        async reconnectMcp(name) {
            names.push(name);
            return { servers: [{ name, connected: true, token: 'never-export' }] };
        },
    };
    await assert.rejects(nativeSessionAction(runtime, { operation: 'mcpConnect', confirmed: true }), /직접 선택/);
    await assert.rejects(nativeSessionAction(runtime, { operation: 'mcpConnect', name: 'tools' }), /확인/);
    const value = await nativeSessionAction(runtime, { operation: 'mcpConnect', name: 'tools', confirmed: true });
    assert.deepEqual(names, ['tools']);
    assert.deepEqual(value, { name: 'tools', connected: true });
});

// 브리지 모델 선택을 실제 엔진 설정과 영속 경로에 연결하고 재개 시 유지한다.
test('bridge model changes preserve session and journal route; fork is discoverable', async (t) => {
    const configurations = [];
    const f = fixture({
        async configure(changes) {
            configurations.push(changes);
            return { route: changes.route, autoEffort: false, effort: 'high' };
        },
        async action(request) {
            assert.equal(request.operation, 'fork');
            return { nativeSessionId: 'heir-native' };
        },
    }, {
        loadCatalog: async () => ({
            route: { provider: 'first', model: 'one' },
            models: [{ id: 'one', provider: 'first', label: 'One', effortOptions: ['low'] },
                { id: 'two', provider: 'second', label: 'Two', effortOptions: ['high'] }],
        }),
    });
    t.after(() => f.connection.close());
    await f.ready();
    const id = f.events.find((event) => event.type === 'session.opened').persistence.data.bridgeId;
    await f.connection.sessionAction({ sessionId: 'p1', operation: 'configure', changes: { model: 'second/two' } });
    assert.equal(f.store.load(id).nativeRoute.model, 'two');
    assert.equal(f.events.findLast((event) => event.type === 'session.config').config.model, 'second/two');
    assert.deepEqual(configurations[0].route, { provider: 'second', model: 'two' });
    const fork = await f.connection.sessionAction({ sessionId: 'p1', operation: 'fork', confirmed: true });
    assert.equal(f.store.load(fork.persistence.data.bridgeId).nativeSessionId, 'heir-native');
    assert.equal(f.store.load(id).nativeRoute.model, 'two');
});

// Main 기본 모델이 그대로여도 복원은 승인된 세션 모델·추론 카탈로그를 따른다.
test('restoring a switched session uses its saved route rather than the unchanged main default', async (t) => {
    const loadCatalog = async () => ({
        route: { provider: 'first', model: 'one' },
        models: [{ id: 'one', provider: 'first', label: 'One', effortOptions: ['low'] },
            { id: 'two', provider: 'second', label: 'Two', effortOptions: ['high'] }],
    });
    const first = fixture({
        async configure(changes) { return { route: changes.route, effort: 'high', autoEffort: false }; },
    }, { loadCatalog });
    t.after(() => first.connection.close());
    await first.ready();
    await first.run();
    await first.connection.sessionAction({ sessionId: 'p1', operation: 'configure', changes: { model: 'second/two' } });
    const persistence = first.events.find((event) => event.type === 'session.opened').persistence;
    await first.connection.close();
    const restored = fixture({}, { loadCatalog, store: first.store });
    t.after(() => restored.connection.close());
    restored.open.persistence = persistence;
    await restored.ready();
    assert.equal(restored.creates[0].route.provider, 'second');
    assert.equal(restored.creates[0].route.model, 'two');
    assert.deepEqual(restored.creates[0].effortOptions, ['high']);
    assert.equal(restored.events.findLast((event) => event.type === 'session.config').config.model, 'second/two');
});

// 실행 중이거나 소유하지 않은 세션에서는 복구 API를 호출하지 않는다.
test('session actions reject active turns and unknown session addresses', async (t) => {
    const gate = deferred();
    let actions = 0;
    const f = fixture({
        async ask() { await gate.promise; return { content: 'done' }; },
        action() { actions++; },
    });
    t.after(() => f.connection.close());
    await f.ready();
    await assert.rejects(f.connection.sessionAction({ sessionId: 'foreign', operation: 'context' }), /not ready/);
    await f.connection.send(f.prompt);
    await until(f.events, (event) => event.type === 'session.turn' && event.state === 'started');
    await assert.rejects(f.connection.sessionAction({ sessionId: 'p1', operation: 'undo', confirmed: true }), /응답/);
    assert.equal(actions, 0);
    gate.resolve();
});

// quota는 타입이 확인된 실패에서만 노출하며 기존 명령 대신 계속하기만 새 턴으로 보낸다.
test('quota resume requires a confirmed quota failure and never replays the original prompt', async (t) => {
    const received = [];
    const f = fixture({
        async status() { return {}; },
        async ask(text, callbacks, source, retry) {
            received.push({ text, retry });
            if (received.length === 1) {
                const error = new Error('quota exhausted');
                error.quota = { provider: 'first', model: 'one', resetAt: Date.now() + 60000 };
                throw error;
            }
            return { content: 'continued' };
        },
    });
    t.after(() => f.connection.close());
    await f.ready();
    await assert.rejects(f.connection.sessionAction({ sessionId: 'p1', operation: 'quotaRetry', confirmed: true }), /확인/);
    await f.run();
    assert.ok((await f.connection.engineStatus())[0].quota);
    await assert.rejects(f.connection.sessionAction({ sessionId: 'p1', operation: 'quotaSchedule' }), /실패/);
    assert.equal((await f.connection.sessionAction({ sessionId: 'p1', operation: 'quotaSchedule', confirmed: true })).scheduled, true);
    await f.connection.sessionAction({ sessionId: 'p1', operation: 'quotaCancel' });
    assert.equal((await f.connection.engineStatus())[0].quotaResume, null);
    const result = await f.connection.sessionAction({ sessionId: 'p1', operation: 'quotaRetry', confirmed: true });
    assert.equal(result.state, 'completed');
    assert.equal(received[1].retry, true);
    assert.equal(received[1].text, 'Continue from where you left off.');
    assert.notEqual(received[1].text, f.prompt.prompt.input.content[0].text);
});

// 확장 CRUD는 이름이 지정된 네이티브 API만 호출하며 목록에는 비밀 필드를 내보내지 않는다.
test('resource management delegates native APIs, requires confirmation and projects public fields', async () => {
    const calls = [];
    const runtime = {
        mcpStatus: () => ({ servers: [{ name: 'tools', enabled: true, connected: true, headers: { secret: 'never-export' } }] }),
        skillsStatus: () => ({ skills: [{ name: 'skill', filePath: '/private', description: 'description' }] }),
        pluginsStatus: () => ({ plugins: [{ id: 'plugin', name: 'Plugin', secret: 'never-export' }] }),
        addMcpServer: (...args) => { calls.push(['mcp', ...args]); return {}; },
        addSkill: (...args) => { calls.push(['skill', ...args]); return {}; },
        updatePlugin: (...args) => { calls.push(['plugin', ...args]); return {}; },
        beginMcpOAuthLogin: (...args) => { calls.push(['login', ...args]); return { flowId: 'flow', state: 'pending', url: 'https://example.com/oauth' }; },
    };
    const result = await resourceControls(runtime, { operation: 'read' });
    assert.doesNotMatch(JSON.stringify(result), /never-export|\/private/);
    await assert.rejects(resourceControls(runtime, { operation: 'mcpAdd', data: {} }), /확인/);
    await resourceControls(runtime, { operation: 'mcpAdd', confirmed: true, data: { name: 'tools', type: 'stdio', command: 'tool' } });
    await resourceControls(runtime, { operation: 'skillAdd', confirmed: true, data: { name: 'skill', body: 'instructions' } });
    await resourceControls(runtime, { operation: 'pluginUpdate', confirmed: true, name: 'plugin' });
    await resourceControls(runtime, { operation: 'mcpLogin', confirmed: true, name: 'tools' });
    assert.deepEqual(calls.map(([name]) => name), ['mcp', 'skill', 'plugin', 'login']);
    assert.deepEqual(calls[3], ['login', 'tools', { openBrowser: false }]);
    await assert.rejects(resourceControls(runtime, { operation: 'arbitraryMethod', confirmed: true }), /Unsupported/);
});

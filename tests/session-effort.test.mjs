import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture as sharedFixture, until, deferred } from './helpers.mjs';
import { MemoryJournalStore } from '../plugin/server/journal.mjs';
import { createNativeEngine, loadNativeModules } from '../engine/src/native-engine.mjs';

// 지원하는 네이티브 엔진만 자동 노력도 기능을 확인해 주는 테스트 경계를 만든다.
function fixture(overrides = {}, options = {}) {
    return sharedFixture({ configuration: () => ({ autoEffortAvailable: true }), ...overrides }, options);
}

// 실제 카탈로그 형식으로 다음 턴 선택 목록과 기본 경로를 제공한다.
function loadCatalog() {
    return { route: { provider: 'test', model: 'model', effort: 'low', autoEffort: true },
        models: [{ provider: 'test', id: 'model', label: 'Model',
            effortOptions: [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High' }] }] };
}

// 설정 이벤트에서 SDK의 세션 자동 노력도 값을 읽는다.
function autoEffort(events) {
    return events.findLast((event) => event.type === 'session.config')
        .config.settings.find((setting) => setting.id === 'autoEffort').value;
}

// 완료·실패 응답까지 기다려 세션 변경을 실행한다.
async function configure(f, requestId, changes, failed = false) {
    await f.connection.send({ type: 'session.configure', sessionId: 'p1', requestId, changes });
    return until(f.events, (event) => event.requestId === requestId
        && event.type === (failed ? 'request.failed' : 'request.completed'));
}

// 수동 선택은 해당 세션만 자동을 끄고 저장한 다음 턴 설정으로 복원된다.
test('manual session effort disables only session auto effort and persists before any native identity', async (t) => {
    const catalog = loadCatalog();
    const calls = [];
    const store = new MemoryJournalStore();
    const f = fixture({ async configure(changes) { calls.push(changes); } },
        { loadCatalog: () => catalog, store });
    t.after(() => f.connection.close());
    await f.ready();
    assert.equal(autoEffort(f.events), true);
    await configure(f, 'manual', { thinkingOption: 'high' });
    assert.deepEqual(calls, [{ effort: 'high', autoEffort: false }]);
    assert.equal(autoEffort(f.events), false);
    assert.equal(catalog.route.autoEffort, true);
    const saved = f.store.list()[0];
    assert.deepEqual(saved.effortSettings, { effort: 'high', autoEffort: false });
    const persistence = f.events.find((event) => event.type === 'session.opened').persistence;
    await f.connection.close();
    const resumed = fixture({}, { loadCatalog: () => catalog, store });
    t.after(() => resumed.connection.close());
    resumed.open.persistence = persistence;
    await resumed.ready();
    assert.equal(autoEffort(resumed.events), false);
    assert.equal(resumed.creates[0].route.effort, 'high');
    assert.equal(resumed.creates[0].route.autoEffort, false);
    assert.equal(resumed.events.findLast((event) => event.type === 'session.config').config.thinkingOption, 'high');
});

// 자동만 다시 켜거나 명시적으로 함께 고른 값은 같은 세션에만 반영한다.
test('session auto effort toggles preserve manual baseline and explicit combined selections', async (t) => {
    const calls = [];
    const f = fixture({ async configure(changes) { calls.push(changes); } }, { loadCatalog });
    t.after(() => f.connection.close());
    await f.ready();
    await configure(f, 'manual', { thinkingOption: 'high' });
    await configure(f, 'auto', { settings: { autoEffort: true } });
    assert.equal(autoEffort(f.events), true);
    assert.equal(f.events.findLast((event) => event.type === 'session.config').config.thinkingOption, 'high');
    await configure(f, 'both', { thinkingOption: 'low', settings: { autoEffort: true } });
    assert.deepEqual(calls, [{ effort: 'high', autoEffort: false }, { autoEffort: true },
        { effort: 'low', autoEffort: true }]);
    assert.deepEqual(f.store.list()[0].effortSettings, { effort: 'low', autoEffort: true });
});

// 기존 네이티브 세션을 같은 ID로 복원하고 호스트 기본값 대신 실제 자동 상태를 읽는다.
test('existing native session reads actual auto effort and retains native identity across resume', async (t) => {
    const store = new MemoryJournalStore();
    const f = fixture({
        configuration: () => ({ effort: 'low', autoEffort: false, autoEffortAvailable: true }),
        async ask(text, callbacks) {
            callbacks.onIdentity({ id: 'existing-native', state: { provider: 'test', model: 'model', effort: 'low' } });
            return { content: text };
        },
        async configure() {},
    }, { loadCatalog, store });
    t.after(() => f.connection.close());
    await f.ready();
    assert.equal(autoEffort(f.events), false);
    await f.run();
    await configure(f, 'manual', { thinkingOption: 'high' });
    const originalHistory = structuredClone(store.list()[0].items);
    const persistence = f.events.find((event) => event.type === 'session.opened').persistence;
    await f.connection.close();
    const resumed = fixture({}, { loadCatalog, store });
    t.after(() => resumed.connection.close());
    resumed.open.persistence = persistence;
    resumed.open.config.providerOptions = { provider: 'test', model: 'model', effort: 'low' };
    await resumed.ready();
    assert.equal(resumed.creates[0].nativeSessionId, 'existing-native');
    assert.equal(resumed.creates[0].route.effort, 'high');
    assert.equal(autoEffort(resumed.events), false);
    assert.deepEqual(store.list()[0].items, originalHistory);
});

// 다른 모델의 기본 카탈로그 노력도를 현재 모델의 지원 목록처럼 노출하지 않는다.
test('unknown current native model cannot borrow the default model effort options', async (t) => {
    let calls = 0;
    const f = fixture({ async configure() { calls++; } }, { loadCatalog });
    t.after(() => f.connection.close());
    f.open.config.providerOptions = { provider: 'test', model: 'uncataloged' };
    await f.ready();
    await configure(f, 'wrong-catalog', { thinkingOption: 'high' }, true);
    assert.equal(calls, 0);
    assert.deepEqual(f.events.findLast((event) => event.type === 'session.config').config.thinkingOptions, []);
});

// 모델 선택지가 없거나 네이티브 모듈이 비활성 상태면 자동 켜기와 기능 노출을 거절한다.
test('auto effort is not advertised or enabled without model effort choices and native availability', async (t) => {
    for (const [hasOptions, available] of [[false, true], [true, false], [false, false]]) {
        const catalog = loadCatalog();
        if (!hasOptions) catalog.models[0].effortOptions = [];
        const calls = [];
        const f = fixture({
            configuration: () => ({ autoEffortAvailable: available }),
            async configure(changes) { calls.push(changes); },
        }, { loadCatalog: () => catalog });
        t.after(() => f.connection.close());
        await f.ready();
        assert.deepEqual(f.events.findLast((event) => event.type === 'session.config').config.settings, []);
        await configure(f, 'unavailable-auto', { settings: { autoEffort: true } }, true);
        assert.deepEqual(calls, []);
        if (hasOptions) {
            await configure(f, 'manual-still-supported', { thinkingOption: 'high' });
            assert.deepEqual(calls, [{ effort: 'high', autoEffort: false }]);
        }
        const fresh = fixture({ configuration: () => ({ autoEffortAvailable: available }) },
            { loadCatalog: () => catalog });
        t.after(() => fresh.connection.close());
        fresh.open.config.settings.autoEffort = true;
        await fresh.connection.send(fresh.open);
        const failure = await until(fresh.events, (event) => event.type === 'request.failed');
        assert.match(failure.error.message, /Auto effort is unavailable/);
        assert.equal(fresh.events.some((event) => event.type === 'session.ready'), false);
    }
});

// 실제 설치된 네이티브의 진단 모드·모듈 활성화와 모델별 지원 판정을 그대로 따른다.
test('installed native auto effort gates reject disabled, observe, and unsupported routes without inference', async () => {
    const native = await loadNativeModules();
    const previousMode = process.env.MIXDOG_AUTO_EFFORT;
    const previousFeature = process.env.MIXDOG_FEATURE_AUTO_EFFORT;
    const session = { provider: 'openai', model: 'gpt-6.1-sol', modelParameters: {} };
    try {
        process.env.MIXDOG_AUTO_EFFORT = 'off';
        assert.equal(native.autoEffortAvailable(session), false);
        process.env.MIXDOG_AUTO_EFFORT = 'observe';
        assert.equal(native.autoEffortAvailable(session), false);
        delete process.env.MIXDOG_AUTO_EFFORT;
        process.env.MIXDOG_FEATURE_AUTO_EFFORT = 'false';
        assert.equal(native.autoEffortAvailable(session), false);
        process.env.MIXDOG_AUTO_EFFORT = 'on';
        assert.equal(native.autoEffortAvailable(session), true);
        assert.equal(native.autoEffortAvailable({ ...session, model: 'gpt-4' }), false);
        assert.equal(native.autoEffortAvailable({ ...session, modelParameters: { multi_agent: true } }), false);
    } finally {
        if (previousMode === undefined) delete process.env.MIXDOG_AUTO_EFFORT;
        else process.env.MIXDOG_AUTO_EFFORT = previousMode;
        if (previousFeature === undefined) delete process.env.MIXDOG_FEATURE_AUTO_EFFORT;
        else process.env.MIXDOG_FEATURE_AUTO_EFFORT = previousFeature;
    }
});

// 잘못된 노력도·설정·모델 변경과 엔진 실패는 선택값이나 기본 경로를 바꾸지 않는다.
test('invalid or failed session selections do not mutate defaults or publish a selected value', async (t) => {
    const catalog = loadCatalog();
    let calls = 0;
    const f = fixture({ async configure() { calls++; throw new Error('native selection failed'); } },
        { loadCatalog: () => catalog });
    t.after(() => f.connection.close());
    await f.ready();
    const count = f.events.filter((event) => event.type === 'session.config').length;
    const changes = [{ thinkingOption: 'invented' }, { thinkingOption: null },
        { settings: { autoEffort: 'false' } }, { settings: { autoEffort: false, arbitrary: true } },
        { model: 'test/other' }, { mode: 'bypass', thinkingOption: 'low' }, { thinkingOption: 'high' }];
    for (const [index, change] of changes.entries()) await configure(f, `bad-${index}`, change, true);
    assert.equal(calls, 1);
    assert.equal(autoEffort(f.events), true);
    assert.equal(f.events.filter((event) => event.type === 'session.config').length, count);
    assert.equal(catalog.route.autoEffort, true);
    assert.deepEqual(f.store.list()[0].effortSettings, { autoEffort: true, effort: 'low' });
});

// 저장 실패 후에는 성공 상태를 알리거나 불확실한 엔진으로 다음 턴을 시작하지 않는다.
test('journal failure after native preference admission fails closed without publishing success', async (t) => {
    const f = fixture({ async configure() {} }, { loadCatalog });
    t.after(() => f.connection.close());
    await f.ready();
    const count = f.events.filter((event) => event.type === 'session.config').length;
    const save = f.store.save;
    f.store.save = () => { throw new Error('effort journal unavailable'); };
    try {
        const failure = await configure(f, 'disk-failed', { thinkingOption: 'high' }, true);
        assert.match(failure.error.message, /effort journal unavailable/);
        assert.equal(f.events.filter((event) => event.type === 'session.config').length, count);
        assert.equal(f.events.some((event) => event.type === 'request.completed' && event.requestId === 'disk-failed'), false);
        await f.connection.send(f.prompt);
        await until(f.events, (event) => event.type === 'session.prompt_result');
        assert.equal(f.calls.some((call) => call.text), false);
    } finally { f.store.save = save; }
});

// 활성 턴 중 자동·수동 변경은 모두 거절하며 원래 턴과 승인은 그대로 둔다.
test('active turn rejects effort settings without forwarding configuration', async (t) => {
    const gate = deferred();
    let calls = 0;
    const f = fixture({ async ask() { await gate.promise; return { content: 'done' }; },
        async configure() { calls++; } }, { loadCatalog });
    t.after(() => f.connection.close());
    await f.ready();
    await f.connection.send(f.prompt);
    await until(f.events, (event) => event.type === 'session.turn' && event.state === 'started');
    await configure(f, 'busy-auto', { settings: { autoEffort: false } }, true);
    await configure(f, 'busy-effort', { thinkingOption: 'high' }, true);
    assert.equal(calls, 0);
    gate.resolve();
    await until(f.events, (event) => event.type === 'session.turn' && event.state === 'completed');
});

// 새 세션의 명시적 자동 설정과 카탈로그 수동 노력도를 검증한다.
test('new sessions accept boolean auto effort and validate manual effort against their model catalog', async (t) => {
    const f = fixture({}, { loadCatalog });
    t.after(() => f.connection.close());
    f.open.config.settings = { autoEffort: false };
    f.open.config.thinkingOption = 'high';
    await f.ready();
    assert.equal(autoEffort(f.events), false);
    assert.equal(f.creates[0].route.effort, 'high');
    const bad = fixture({}, { loadCatalog });
    t.after(() => bad.connection.close());
    bad.open.config.thinkingOption = 'invented';
    await bad.connection.send(bad.open);
    await until(bad.events, (event) => event.type === 'request.failed');
    assert.equal(bad.creates.length, 0);
});

// 실제 네이티브 추론 경계의 세션 필드를 바꾸되 전역 경로 API는 호출하지 않는다.
test('native session preferences apply at next-turn boundary without route writes or session recreation', async () => {
    const session = { id: 'same-native', provider: 'test', model: 'model', effort: 'low',
        autoEffort: false, messages: [{ role: 'user', content: 'history' }] };
    const observed = [];
    let available = true;
    const runtime = {
        id: session.id, session, autoEffort: true, effort: 'low', effortOptions: ['low', 'high'],
        // 네이티브 요청 직전 상태를 기록해 실제 전달 필드를 검사한다.
        async ask(text, options) {
            options.beforeSessionAsk(session);
            observed.push({ effort: session.effort, autoEffort: session.autoEffort !== false });
            return { content: text };
        },
        // 전역 저장 API를 쓰면 테스트를 실패시킨다.
        async setEffort() { assert.fail('host effort route must not change'); },
        // 전역 모델 경로 API도 이 세션 설정에서 호출하지 않는다.
        async setRoute() { assert.fail('host model route must not change'); },
        abort() {}, close() {}, resume() {}, compact() {},
    };
    const engine = await createNativeEngine({ config: { cwd: '/work', mode: 'ask', mcpServers: {}, settings: {} } }, {
        modules: { loadConfig: () => ({}), autoEffortAvailable: () => available,
            // 기존 협업 표면 초기화만 흉내 내고 추론은 수행하지 않는다.
            createMixdogSessionRuntime: async (options) => {
                options.agentSessionSurface({ mgr: {}, getAgentTool: () => ({
                    getStatus: () => ({ jobs: [] }), onStatusChange: () => () => {},
                    closeAll: async () => ({ failed: [] }),
                }) });
                return runtime;
            } },
    });
    try {
        assert.deepEqual(engine.configuration(), { effort: 'low', autoEffort: false, autoEffortAvailable: true });
        await engine.configure({ effort: 'high' });
        assert.deepEqual(engine.configuration(), { effort: 'high', autoEffort: false, autoEffortAvailable: true });
        assert.equal(session.effort, 'low');
        await engine.ask('first', {});
        await engine.configure({ autoEffort: true });
        await engine.ask('second', {});
        assert.deepEqual(observed, [{ effort: 'high', autoEffort: false }, { effort: 'high', autoEffort: true }]);
        assert.equal(engine.id, 'same-native');
        assert.deepEqual(session.messages, [{ role: 'user', content: 'history' }]);
        await assert.rejects(engine.configure({ effort: 'invented' }), /Unsupported effort/);
        await assert.rejects(engine.configure({ autoEffort: 'true' }), /Invalid autoEffort/);
        available = false;
        await assert.rejects(engine.configure({ autoEffort: true }), /Auto effort is unavailable/);
        assert.equal(engine.configuration().autoEffortAvailable, false);
        await engine.configure({ effort: 'low' });
        assert.equal(engine.configuration().autoEffort, false);
        available = true;
        runtime.effortOptions = [];
        await assert.rejects(engine.configure({ autoEffort: true }), /Auto effort is unavailable/);
    } finally { await engine.close('test'); }
});

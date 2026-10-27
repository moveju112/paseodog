import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fixture, until } from './helpers.mjs';
import { runSharedAppTests } from './shared-app-tests.mjs';
import {
    AUTO_EFFORT_ID, AUTO_EFFORT_SOURCE, AUTO_EFFORT_SOURCE_ANCHOR, AUTO_EFFORT_EDITS,
    createAutoEffortState, withoutAutoEffort,
} from '../patches/paseo-auto-effort.mjs';

const require = createRequire(new URL('../plugin/package.json', import.meta.url));
const React = require('react');
const { create, act } = require('react-test-renderer');
// 현재 공유 컨트롤의 실제 렌더링·호스트/세션 격리·불확실한 저장 방지를 검증한다.
// 아래 기존 provider 연결 시나리오도 유지해 전송 계약 회귀를 계속 확인한다.
test('shared controls preserve draft/live effort isolation and confirmed writes', () =>
    runSharedAppTests(['src/composer/agent-controls/paseodog-controls.test.tsx']));

// 주입 소스를 실제 번들과 같은 이름(s=React, J=jsx, O=세션 저장소, ve=컨트롤 바)으로 평가한다.
// AgentControls(Te)처럼 컨트롤 바 요소를 agentId 없는 의존성으로 캐시하고, 캐시 밖에서 주입된 에이전트 범위 식을 그대로 적용한다.
const SCOPE_EDIT = AUTO_EFFORT_EDITS.find(([before]) => before === '):Co=o[131],');
const SCOPE_EXPRESSION = SCOPE_EDIT[1].slice(SCOPE_EDIT[0].length, -1);
function wrapper(store, seen) {
    const Controls = (props) => { seen.push(props); return null; };
    const { PaseodogEffortControls, PaseodogAgentScope } = new Function('s', 'J', 'O', 've',
        AUTO_EFFORT_SOURCE.replace(AUTO_EFFORT_SOURCE_ANCHOR, '') + ';return { PaseodogEffortControls, PaseodogAgentScope };')(
        React, { jsx: React.createElement }, { useSessionStore: (selector) => selector(store) }, Controls);
    const scope = new Function('J', 'PaseodogAgentScope', 't', 'Co', `return (${SCOPE_EXPRESSION},Co);`);
    return function AgentControlsHost({ agentId = null, ...props }) {
        const cached = React.useMemo(() => React.createElement(PaseodogEffortControls, props),
            [props.paseodogScope, props.provider, props.modelSelectorServerId, props.features, props.thinkingOptions,
                props.selectedThinkingOptionId, props.onSelectThinkingOption]);
        return scope({ jsx: React.createElement }, PaseodogAgentScope, agentId, cached);
    };
}

function hostClient(initial, { failWrite = false, model = 'small' } = {}) {
    const calls = [];
    let autoEffort = initial;
    return { calls, client: { async invokePluginRpc(plugin, method, input) {
        calls.push({ plugin, method, input });
        if (input.action === 'main') {
            autoEffort = input.route.autoEffort;
            if (failWrite) throw new Error('ack lost');
        }
        return { route: { autoEffort, model }, toolModules: { autoEffort: { enabled: true, installed: true, supported: true } } };
    } } };
}

// 데몬 plugin-provider와 같은 방식으로 SDK 호출을 실제 provider 연결의 session.configure로 보낸다.
function sdkOverConnection(f, hostCalls) {
    let next = 0;
    // 완료·실패 응답을 SDK의 성공·거절로 바꾼다.
    async function configure(changes) {
        const requestId = `ui-${next++}`;
        await f.connection.send({ type: 'session.configure', sessionId: 'p1', requestId, changes });
        const done = await until(f.events, (event) => event.requestId === requestId
            && (event.type === 'request.completed' || event.type === 'request.failed'));
        if (done.type === 'request.failed') throw new Error(done.error?.message || 'configure rejected');
    }
    return {
        setAgentThinkingOption: (agentId, id) => configure({ thinkingOption: id }),
        setAgentFeature: (agentId, id, value) => configure({ settings: { [id]: value } }),
        async invokePluginRpc(plugin, method, input) {
            hostCalls.push(input);
            return { route: { autoEffort: true, model: 'model' }, toolModules: { autoEffort: { enabled: true, supported: true } } };
        },
    };
}

// 마지막 session.config를 데몬 agent 상태(features·thinking)처럼 컨트롤 바 props로 바꾼다.
function liveProps(f, sdk, selected) {
    const config = f.events.findLast((event) => event.type === 'session.config').config;
    return { paseodogScope: 'live', agentId: 'agent-1', provider: 'paseodog', modelSelectorServerId: 'host',
        features: config.settings.map((setting) => ({ ...setting })),
        thinkingOptions: config.thinkingOptions.map((option) => ({ id: option.id, label: option.label })),
        selectedThinkingOptionId: config.thinkingOption,
        // 원본 AgentControls의 onSelectThinkingOption처럼 setAgentThinkingOption만 부르고 실패는 삼킨다.
        onSelectThinkingOption: (id) => { selected.push(id); sdk.setAgentThinkingOption('agent-1', id).catch(() => {}); } };
}

test('live auto effort reads and writes only the session through the real provider connection', async (t) => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const catalog = { route: { provider: 'test', model: 'model', effort: 'low', autoEffort: true },
        models: [{ provider: 'test', id: 'model', label: 'Model',
            effortOptions: [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High' }] }] };
    let fail = false;
    const engineCalls = [], hostCalls = [], selected = [], seen = [];
    const f = fixture({ configuration: () => ({ autoEffortAvailable: true }),
        async configure(changes) { engineCalls.push(changes); if (fail) throw new Error('engine busy'); } },
        { loadCatalog: () => catalog });
    t.after(() => f.connection.close());
    await f.ready();
    const sdk = sdkOverConnection(f, hostCalls);
    const Component = wrapper({ sessions: { host: { client: sdk } } }, seen);
    const live = () => seen.filter((props) => Array.isArray(props.features) && props.thinkingOptions?.[0]?.id === AUTO_EFFORT_ID).at(-1);
    const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
    let tree;
    try {
        await act(async () => { tree = create(React.createElement(Component, liveProps(f, sdk, selected))); });
        assert.equal(live().selectedThinkingOptionId, AUTO_EFFORT_ID);
        assert.ok(!live().features.some((feature) => feature.id === 'autoEffort'));
        // 수동 선택: 세션 한 번 저장, 그 세션만 자동 끔, 호스트 기본값 그대로.
        await act(async () => { live().onSelectThinkingOption('high'); await settle(); });
        await act(async () => tree.update(React.createElement(Component, liveProps(f, sdk, selected))));
        assert.deepEqual(engineCalls, [{ effort: 'high', autoEffort: false }]);
        assert.equal(live().selectedThinkingOptionId, 'high');
        // 같은 호스트의 새 에이전트 입력창은 여전히 호스트 기본(자동)을 보여 값이 갈라진다.
        let draft;
        await act(async () => { draft = create(React.createElement(Component, { paseodogScope: 'draft', provider: 'paseodog',
            modelSelectorServerId: 'host', thinkingOptions: [{ id: 'low', label: 'Low' }], selectedThinkingOptionId: 'low' })); });
        assert.equal(seen.filter((props) => !props.features && props.thinkingOptions?.[0]?.id === AUTO_EFFORT_ID).at(-1).selectedThinkingOptionId, AUTO_EFFORT_ID);
        await act(async () => draft.unmount());
        // 자동 선택: SDK setAgentFeature 한 번으로 세션 설정만 켠다.
        await act(async () => { live().onSelectThinkingOption(AUTO_EFFORT_ID); await settle(); });
        await act(async () => tree.update(React.createElement(Component, liveProps(f, sdk, selected))));
        assert.deepEqual(engineCalls.at(-1), { autoEffort: true });
        assert.equal(live().selectedThinkingOptionId, AUTO_EFFORT_ID);
        // 엔진이 거절하면 세션 값·호스트 값 모두 그대로이고 재전송하지 않는다.
        fail = true;
        await act(async () => { live().onSelectThinkingOption('low'); await settle(); });
        await act(async () => tree.update(React.createElement(Component, liveProps(f, sdk, selected))));
        assert.equal(live().selectedThinkingOptionId, AUTO_EFFORT_ID);
        await act(async () => tree.update(React.createElement(Component, { ...liveProps(f, sdk, selected),
            features: [{ type: 'toggle', id: 'autoEffort', label: 'Auto effort', value: false }] })));
        await act(async () => { live().onSelectThinkingOption(AUTO_EFFORT_ID); await settle(); });
        assert.match(live().thinkingOptions[0].label, /저장 실패/);
        assert.equal(engineCalls.length, 4);
        assert.deepEqual(selected, ['high', 'low']);
        assert.equal(catalog.route.autoEffort, true);
        assert.ok(hostCalls.every((input) => input.action === 'read'));
    } finally {
        await act(async () => tree?.unmount());
        delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    }
});

test('switching agents behind a cached control bar writes only the current agent and shows no previous save state', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const writes = [];
    let fail = true;
    const client = { async setAgentFeature(agentId, id, value) {
        writes.push({ agentId, id, value });
        if (fail) throw new Error('busy');
    }, async invokePluginRpc() { throw new Error('host must not be read for live controls'); } };
    const seen = [];
    const Component = wrapper({ sessions: { host: { client } } }, seen);
    // 두 에이전트가 완전히 같은 참조의 props를 공유해 캐시가 무효화되지 않는 최악의 경우를 만든다.
    const shared = { paseodogScope: 'live', provider: 'paseodog', modelSelectorServerId: 'host',
        features: [{ type: 'toggle', id: 'autoEffort', label: 'Auto effort', value: false }],
        thinkingOptions: [{ id: 'low', label: 'Low' }], selectedThinkingOptionId: 'low', onSelectThinkingOption: () => {} };
    const last = () => seen.at(-1);
    let tree;
    try {
        await act(async () => { tree = create(React.createElement(Component, { ...shared, agentId: 'agent-a' })); });
        await act(async () => { last().onSelectThinkingOption(AUTO_EFFORT_ID); await Promise.resolve(); });
        assert.match(last().thinkingOptions[0].label, /저장 실패/);
        await act(async () => tree.update(React.createElement(Component, { ...shared, agentId: 'agent-b' })));
        // 이전 에이전트의 실패 표시가 남지 않는다.
        assert.equal(last().thinkingOptions[0].label, 'Auto');
        fail = false;
        await act(async () => { last().onSelectThinkingOption(AUTO_EFFORT_ID); await Promise.resolve(); });
        assert.deepEqual(writes, [{ agentId: 'agent-a', id: 'autoEffort', value: true }, { agentId: 'agent-b', id: 'autoEffort', value: true }]);
        // 공급자 전환: 다른 공급자는 원본 목록, 다시 PaseoDog로 와도 숨은 저장 상태가 이어지지 않는다.
        await act(async () => tree.update(React.createElement(Component, { ...shared, provider: 'codex', agentId: 'agent-c' })));
        assert.equal(last().thinkingOptions, shared.thinkingOptions);
        assert.deepEqual(last().features, shared.features);
        await act(async () => tree.update(React.createElement(Component, { ...shared, agentId: 'agent-c' })));
        assert.equal(last().thinkingOptions[0].label, 'Auto');
        assert.equal(writes.length, 2);
    } finally {
        await act(async () => tree?.unmount());
        delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    }
});

test('live controls stay original when the real provider connection does not advertise the session toggle', async (t) => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const catalog = { route: { provider: 'test', model: 'model', effort: 'low', autoEffort: true },
        models: [{ provider: 'test', id: 'model', label: 'Model',
            effortOptions: [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High' }] }] };
    const hostCalls = [], seen = [];
    const f = fixture({ configuration: () => ({ autoEffortAvailable: false }), async configure() {} }, { loadCatalog: () => catalog });
    t.after(() => f.connection.close());
    await f.ready();
    const sdk = sdkOverConnection(f, hostCalls);
    const Component = wrapper({ sessions: { host: { client: sdk } } }, seen);
    let tree;
    try {
        const props = liveProps(f, sdk, []);
        assert.deepEqual(props.features, []);
        await act(async () => { tree = create(React.createElement(Component, props)); });
        assert.deepEqual(seen.at(-1).thinkingOptions.map((option) => option.id), ['low', 'high']);
        assert.deepEqual(hostCalls, []);
    } finally {
        await act(async () => tree?.unmount());
        delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    }
});

test('live controls without a session autoEffort toggle never fall back to the host default', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const { client, calls } = hostClient(true);
    const seen = [];
    const Component = wrapper({ sessions: { host: { client } } }, seen);
    const options = [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High' }];
    let tree;
    try {
        await act(async () => { tree = create(React.createElement(Component, { paseodogScope: 'live', agentId: 'a',
            provider: 'paseodog', modelSelectorServerId: 'host', thinkingOptions: options, selectedThinkingOptionId: 'high', features: [] })); });
        assert.equal(seen.at(-1).thinkingOptions, options);
        assert.equal(seen.at(-1).selectedThinkingOptionId, 'high');
        assert.ok(seen.every((props) => !('paseodogScope' in props) && !('paseodogAgentId' in props)));
        assert.deepEqual(calls, []);
    } finally {
        await act(async () => tree?.unmount());
        delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    }
});

test('draft manual choice whose host save fails keeps the existing selection untouched', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const { client, calls } = hostClient(true, { failWrite: true });
    const seen = [], selected = [];
    const Component = wrapper({ sessions: { host: { client } } }, seen);
    let tree;
    try {
        await act(async () => { tree = create(React.createElement(Component, { paseodogScope: 'draft', provider: 'paseodog',
            modelSelectorServerId: 'host', thinkingOptions: [{ id: 'low', label: 'Low' }], selectedThinkingOptionId: 'low',
            onSelectThinkingOption: (id) => selected.push(id) })); });
        await act(async () => seen.at(-1).onSelectThinkingOption('low'));
        assert.deepEqual(selected, []);
        assert.match(seen.at(-1).thinkingOptions[0].label, /확인 필요/);
        // 불확실한 상태의 재선택은 저장을 다시 보내지 않고 읽기만 한다.
        await act(async () => seen.at(-1).onSelectThinkingOption('low'));
        assert.equal(calls.filter(({ input }) => input.action === 'main').length, 1);
    } finally {
        await act(async () => tree?.unmount());
        delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    }
});

test('draft auto entry reflects the real host default, manual choice turns it off before the existing selection path', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const { client, calls } = hostClient(true);
    const seen = [], selected = [];
    const Component = wrapper({ sessions: { host: { client } } }, seen);
    const options = [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High' }];
    const base = { paseodogScope: 'draft', provider: 'paseodog', modelSelectorServerId: 'host', thinkingOptions: options,
        selectedThinkingOptionId: 'low', onSelectThinkingOption: (id) => selected.push(id) };
    let tree;
    try {
        await act(async () => { tree = create(React.createElement(Component, base)); });
        let props = seen.at(-1);
        assert.deepEqual(props.thinkingOptions.map((option) => option.id), [AUTO_EFFORT_ID, 'low', 'high']);
        assert.equal(props.thinkingOptions[0].label, 'Auto');
        assert.equal(props.selectedThinkingOptionId, AUTO_EFFORT_ID);
        await act(async () => props.onSelectThinkingOption('high'));
        props = seen.at(-1);
        assert.deepEqual(selected, ['high']);
        assert.equal(props.selectedThinkingOptionId, 'low');
        await act(async () => props.onSelectThinkingOption('low'));
        await act(async () => seen.at(-1).onSelectThinkingOption(AUTO_EFFORT_ID));
        assert.equal(seen.at(-1).selectedThinkingOptionId, AUTO_EFFORT_ID);
        assert.deepEqual(selected, ['high', 'low']);
        assert.deepEqual(calls.map(({ input }) => input), [
            { action: 'read' }, { action: 'main', route: { autoEffort: false } }, { action: 'main', route: { autoEffort: true } },
        ]);
        assert.ok(calls.every(({ plugin, method }) => plugin === 'paseodog-provider' && method === 'engine-controls'));
    } finally {
        await act(async () => tree?.unmount());
        delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    }
});

test('draft without a Main model keeps manual effort usable without a host mutation', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const { client, calls } = hostClient(true, { model: '' });
    const seen = [], selected = [];
    const Component = wrapper({ sessions: { host: { client } } }, seen);
    const options = [{ id: 'low', label: 'Low' }];
    let tree;
    try {
        await act(async () => {
            tree = create(React.createElement(Component, {
                paseodogScope: 'draft', provider: 'paseodog', modelSelectorServerId: 'host',
                thinkingOptions: options, onSelectThinkingOption: (id) => selected.push(id),
            }));
        });
        assert.equal(seen.at(-1).thinkingOptions, options);
        await act(async () => seen.at(-1).onSelectThinkingOption('low'));
        assert.deepEqual(selected, ['low']);
        assert.deepEqual(calls.map(({ input }) => input), [{ action: 'read' }]);
    } finally {
        await act(async () => tree?.unmount());
        delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    }
});

test('other providers, models without effort levels and disabled modules keep the original controls untouched', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const { client, calls } = hostClient(true);
    const seen = [];
    const Component = wrapper({ sessions: { host: { client } } }, seen);
    const options = [{ id: 'low', label: 'Low' }];
    const trees = [];
    try {
        await act(async () => {
            trees.push(create(React.createElement(Component, { provider: 'codex', modelSelectorServerId: 'host', thinkingOptions: options })));
            trees.push(create(React.createElement(Component, { paseodogScope: 'draft', provider: 'paseodog', modelSelectorServerId: 'host', thinkingOptions: [] })));
        });
        assert.equal(seen.filter((props) => props.provider === 'codex').every((props) => props.thinkingOptions === options), true);
        assert.equal(seen.filter((props) => props.provider === 'paseodog').every((props) => props.thinkingOptions.length === 0), true);
        assert.ok(calls.every(({ input }) => input.action === 'read'));
        const off = { async invokePluginRpc() {
            return { route: { autoEffort: true, model: 'small' }, toolModules: { autoEffort: { enabled: false, supported: true } } };
        } };
        const disabled = [];
        const Disabled = wrapper({ sessions: { host: { client: off } } }, disabled);
        await act(async () => { trees.push(create(React.createElement(Disabled, { paseodogScope: 'draft', provider: 'paseodog', modelSelectorServerId: 'host', thinkingOptions: options }))); });
        assert.equal(disabled.at(-1).thinkingOptions, options);
    } finally {
        await act(async () => { for (const tree of trees) tree.unmount(); });
        delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    }
});

test('an uncertain auto effort write is never replayed and blocks the manual selection until refreshed', async () => {
    const { client, calls } = hostClient(true, { failWrite: true });
    const state = createAutoEffortState(client);
    assert.equal(await state.refresh(), true);
    assert.equal(state.getSnapshot().enabled, true);
    assert.equal(await state.setEnabled(false), false);
    assert.equal(state.getSnapshot().enabled, null);
    assert.match(state.getSnapshot().error, /새로고침/);
    assert.equal(calls.filter(({ input }) => input.action === 'main').length, 1);
    assert.equal(await state.refresh(), true);
    assert.equal(state.getSnapshot().enabled, false);
});

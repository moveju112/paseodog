import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createFastControl } from '../android/packages/app/src/utils/paseodog-fast-control.mjs';
import { COLLABORATION_SOURCE, COLLABORATION_SOURCE_ANCHOR, PREVIOUS_FAST_SOURCES } from '../patches/paseo-collaboration.mjs';
import { fixture, until, deferred } from './helpers.mjs';

const require = createRequire(new URL('../plugin/package.json', import.meta.url));
const React = require('react');
const { create, act } = require('react-test-renderer');

test('previous Fast bundles retain their exact reviewed bytes', () => {
    assert.deepEqual(PREVIOUS_FAST_SOURCES.map((source) => createHash('sha256').update(source).digest('hex')), [
        '03fc4867e115fcabe8898b3ad76ca7a79418dcde0d7deb57ea2c60f6f2e7d222',
        'e8e1028cae59384075c02a78e85ab19786f900c357d96440354af734b751e826',
    ]);
});

test('first native identity preserves Fast across a turn and reconnect, honoring explicit native values', async (t) => {
    for (const nativeFast of [undefined, true, false]) {
        const catalog = { route: { provider: 'test', model: 'model', fast: true },
            models: [{ provider: 'test', id: 'model', fastCapable: true }] };
        const f = fixture({
            async ask(text, callbacks) {
                callbacks.onIdentity({ id: 'native-fast', state: { provider: 'test', model: 'model',
                    ...(nativeFast === undefined ? {} : { fast: nativeFast }) } });
                return { content: text };
            },
        }, { loadCatalog: () => catalog });
        t.after(() => f.connection.close());
        await f.ready();
        assert.equal(f.events.findLast((event) => event.type === 'session.config')
            .config.settings.find((setting) => setting.id === 'fast').value, true);
        await f.run();
        const expected = nativeFast ?? true;
        assert.equal(f.events.findLast((event) => event.type === 'session.config')
            .config.settings.find((setting) => setting.id === 'fast').value, expected);
        assert.equal(f.store.list()[0].nativeRoute.fast, expected);
        const persistence = f.events.find((event) => event.type === 'session.opened').persistence;
        await f.connection.close();
        const resumed = fixture({}, { loadCatalog: () => catalog, store: f.store });
        t.after(() => resumed.connection.close());
        resumed.open.persistence = persistence;
        await resumed.ready();
        assert.equal(resumed.creates[0].route.fast, expected);
        assert.equal(catalog.route.fast, true);
    }
});

test('forked sessions accept copied Fast and auto effort values without changing host defaults', async (t) => {
    for (const fast of [false, true]) {
        for (const autoEffort of [false, true]) {
            const catalog = { route: { provider: 'test', model: 'model', fast: !fast, autoEffort: !autoEffort },
                models: [{ provider: 'test', id: 'model', label: 'Model', fastCapable: true,
                    effortOptions: [{ id: 'high', label: 'High' }] }] };
            const f = fixture({ configuration: () => ({ autoEffortAvailable: true }) },
                { loadCatalog: () => catalog });
            t.after(() => f.connection.close());
            f.open.config.settings = { fast, autoEffort };
            f.open.config.thinkingOption = 'high';
            await f.ready();
            assert.equal(f.creates[0].route.fast, fast);
            assert.equal(f.creates[0].route.autoEffort, autoEffort);
            assert.equal(f.creates[0].route.effort, 'high');
            const config = f.events.findLast((event) => event.type === 'session.config').config;
            assert.deepEqual(Object.fromEntries(config.settings.map((setting) => [setting.id, setting.value])),
                { autoEffort, fast });
            assert.equal(config.mode, 'ask');
            assert.equal(catalog.route.fast, !fast);
            assert.equal(catalog.route.autoEffort, !autoEffort);
        }
    }
});

test('session creation rejects invalid settings and unsupported Fast before starting an engine', async (t) => {
    const catalog = { route: { provider: 'test', model: 'main', fast: false },
        models: [{ provider: 'test', id: 'main', fastCapable: true },
            { provider: 'test', id: 'other', fastCapable: false }] };
    for (const [settings, message] of [
        [{ fast: 'true' }, 'Unsupported session settings; fast must be boolean'],
        [{ fast: null }, 'Unsupported session settings; fast must be boolean'],
        [{ autoEffort: 'false' }, 'Unsupported session settings; autoEffort must be boolean'],
        [{ unknown: false }, 'Unsupported session settings'],
        [{ fast: true }, 'Fast is unavailable for the current model'],
    ]) {
        const f = fixture({}, { loadCatalog: () => catalog });
        t.after(() => f.connection.close());
        f.open.config.model = 'test/other';
        f.open.config.settings = settings;
        await f.connection.send(f.open);
        const failed = await until(f.events, (event) => event.type === 'request.failed');
        assert.equal(failed.error.message, message);
        assert.equal(f.creates.length, 0);
    }
    const disabled = fixture({}, { loadCatalog: () => catalog });
    t.after(() => disabled.connection.close());
    disabled.open.config.model = 'test/other';
    disabled.open.config.settings = { fast: false };
    await disabled.ready();
    assert.equal(disabled.creates[0].route.fast, false);
});

test('restoring a fork keeps the saved Fast selection rather than its stale creation setting', async (t) => {
    const catalog = { route: { provider: 'test', model: 'model', fast: true },
        models: [{ provider: 'test', id: 'model', fastCapable: true }] };
    const f = fixture({
        async ask(text, callbacks) {
            callbacks.onIdentity({ id: 'fork-native', state: { provider: 'test', model: 'model', fast: true } });
            return { content: text };
        },
        async configure(changes) { return { route: changes.route }; },
    }, { loadCatalog: () => catalog });
    t.after(() => f.connection.close());
    f.open.config.settings = { fast: true, autoEffort: false };
    await f.ready();
    await f.run();
    await f.connection.send({ type: 'session.configure', sessionId: 'p1', requestId: 'disable-fast',
        changes: { settings: { fast: false } } });
    await until(f.events, (event) => event.type === 'request.completed' && event.requestId === 'disable-fast');
    const persistence = f.events.find((event) => event.type === 'session.opened').persistence;
    await f.connection.close();
    const resumed = fixture({}, { loadCatalog: () => catalog, store: f.store });
    t.after(() => resumed.connection.close());
    resumed.open.config.settings = { fast: true, autoEffort: false };
    resumed.open.persistence = persistence;
    await resumed.ready();
    assert.equal(resumed.creates[0].nativeSessionId, 'fork-native');
    assert.equal(resumed.creates[0].route.fast, false);
    assert.equal(resumed.events.findLast((event) => event.type === 'session.config')
        .config.settings.find((setting) => setting.id === 'fast').value, false);
});

test('Fast changes only the selected session route and exposes confirmed values through SDK settings', async (t) => {
    const calls = [];
    const catalog = { route: { provider: 'test', model: 'model', fast: false },
        models: [{ provider: 'test', id: 'model', label: 'Model', fastCapable: true, effortOptions: [] }] };
    const f = fixture({ async configure(changes) { calls.push(changes); return { route: changes.route }; } },
        { loadCatalog: () => catalog });
    t.after(() => f.connection.close());
    await f.ready();
    const config = () => f.events.findLast((event) => event.type === 'session.config').config;
    assert.equal(config().settings.find((item) => item.id === 'fast').value, false);
    for (const fast of [true, false]) {
        const requestId = `fast-${fast}`;
        await f.connection.send({ type: 'session.configure', sessionId: 'p1', requestId, changes: { settings: { fast } } });
        await until(f.events, (event) => event.type === 'request.completed' && event.requestId === requestId);
        assert.equal(config().settings.find((item) => item.id === 'fast').value, fast);
        assert.equal(config().mode, 'ask');
        assert.equal(f.store.list()[0].nativeRoute.fast, fast);
    }
    assert.deepEqual(calls, [{ route: { fast: true } }, { route: { fast: false } }]);
    assert.equal(catalog.route.fast, false);
    // Fast 노출을 autoEffort 지원으로 오인하지 않는다.
    await f.connection.send({ type: 'session.configure', sessionId: 'p1', requestId: 'auto',
        changes: { settings: { autoEffort: true } } });
    const rejected = await until(f.events, (event) => event.type === 'request.failed' && event.requestId === 'auto');
    assert.match(rejected.error.message, /Auto effort is unavailable/);
    assert.equal(calls.length, 2);
});

test('unsupported Fast and mixed settings cannot reach the engine', async (t) => {
    const calls = [];
    const f = fixture({ async configure(changes) { calls.push(changes); } });
    t.after(() => f.connection.close());
    await f.ready();
    for (const [index, changes] of [
        { settings: { fast: true } }, { settings: { fast: 'true' } },
        { settings: { fast: true, autoEffort: false } },
        { settings: { fast: true }, thinkingOption: 'high' },
    ].entries()) {
        const requestId = `invalid-fast-${index}`;
        await f.connection.send({ type: 'session.configure', sessionId: 'p1', requestId, changes });
        await until(f.events, (event) => event.type === 'request.failed' && event.requestId === requestId);
    }
    assert.deepEqual(calls, []);
});

test('shared Fast state serializes writes, reads after uncertain acknowledgment, and never queues offline writes', async () => {
    const writes = [];
    let enabled = false;
    const gate = deferred();
    const client = {
        isConnected: true,
        async fetchAgent() { return { agent: { features: [{ id: 'fast', type: 'toggle', value: enabled }] } }; },
        async setAgentFeature(...args) { writes.push(args); enabled = true; await gate.promise; throw new Error('ack lost'); },
    };
    const state = createFastControl(client, 'one');
    await state.refresh();
    const saving = state.toggle();
    await state.toggle();
    assert.equal(state.getSnapshot().busy, true);
    gate.resolve();
    await saving;
    assert.equal(state.getSnapshot().enabled, false);
    assert.ok(state.getSnapshot().error);
    await state.toggle();
    assert.equal(state.getSnapshot().enabled, true);
    assert.deepEqual(writes, [['one', 'fast', true]]);
    client.isConnected = false;
    await state.toggle();
    assert.equal(writes.length, 1);
    assert.ok(state.getSnapshot().error);
});

test('Fast retains its last confirmed state after a failed read or rejected write without replay', async () => {
    const writes = [];
    let readError = null;
    const activeTurnError = '응답 중에는 모델·추론 수준·설정을 바꿀 수 없어요. 응답이 끝날 때까지 기다리거나 응답을 중지한 뒤 다시 선택해 주세요.';
    const client = {
        isConnected: true,
        async fetchAgent() {
            if (readError) throw readError;
            return { agent: { features: [{ id: 'fast', type: 'toggle', value: true }] } };
        },
        async setAgentFeature(...args) { writes.push(args); throw new Error(activeTurnError); },
    };
    const control = createFastControl(client, 'one');
    await control.refresh();
    readError = new Error('private transport detail');
    await control.refresh();
    assert.equal(control.getSnapshot().enabled, true);
    assert.ok(control.getSnapshot().error);
    assert.ok(!control.getSnapshot().error.includes(readError.message));
    readError = null;
    await control.toggle();
    assert.equal(control.getSnapshot().enabled, true);
    assert.equal(control.getSnapshot().error, '');
    assert.deepEqual(writes, []);
    await control.toggle();
    assert.equal(control.getSnapshot().enabled, true);
    assert.ok(control.getSnapshot().error.includes(activeTurnError));
    await control.toggle();
    assert.equal(control.getSnapshot().enabled, true);
    assert.equal(control.getSnapshot().error, '');
    assert.deepEqual(writes, [['one', 'fast', false]]);
});

test('draft Fast checks the selected model capability instead of borrowing the Main model capability', async () => {
    const calls = [];
    const client = { isConnected: true, async invokePluginRpc(plugin, method, input) {
        calls.push(input);
        return { route: { provider: 'test', model: 'main', fast: false },
            models: [{ provider: 'test', id: 'main', fastCapable: true }, { provider: 'test', id: 'other', fastCapable: false }] };
    } };
    const control = createFastControl(client, null, 'test/other');
    await control.refresh();
    assert.equal(control.getSnapshot().available, false);
    await control.toggle();
    assert.ok(calls.every((input) => input.action === 'read'));
});

test('draft Fast requires a configured Main even when the draft model supports Fast', async () => {
    const calls = [];
    let model = '';
    const client = { isConnected: true, async invokePluginRpc(plugin, method, input) {
        calls.push(input);
        return { route: { provider: 'test', model, fast: false },
            models: [{ provider: 'test', id: 'main', fastCapable: true }] };
    } };
    const control = createFastControl(client, null, 'test/main');
    await control.refresh();
    assert.equal(control.getSnapshot().available, false);
    await control.toggle();
    assert.ok(calls.every((input) => input.action === 'read'));
    model = 'main';
    await control.refresh();
    assert.equal(control.getSnapshot().available, true);
    await control.toggle();
    assert.deepEqual(calls.filter((input) => input.action !== 'read'), [
        { action: 'main', route: { fast: true } },
    ]);
});

test('injected web UI renders only a lightning switch, toggles the live session, and gates disconnected hosts', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    let enabled = false, connectionListener;
    const writes = [];
    const client = {
        isConnected: true,
        subscribeConnectionStatus(listener) { connectionListener = listener; listener({ status: 'connected' }); return () => {}; },
        async fetchAgent() { return { agent: { features: [{ id: 'fast', type: 'toggle', value: enabled }] } }; },
        async setAgentFeature(...args) { writes.push(args); enabled = args[2]; },
    };
    const { Component, Controls } = new Function('s', 'J', 't', 'K', 'b', 'f', 've',
        COLLABORATION_SOURCE.replace(COLLABORATION_SOURCE_ANCHOR, '') + ';return {Component:PaseodogCollaboration,Controls:PaseodogFastControls};')(
        React, { jsx: React.createElement, jsxs: React.createElement }, { Text: 'text' },
        { AgentControlTrigger: (props) => React.createElement('trigger', props,
            React.createElement(props.icon, { size: 16, color: props.iconColor })) }, { Zap: 'zap' },
        { useUnistyles: () => ({ theme: { colors: { accent: 'green', foregroundMuted: 'gray', destructive: 'red' } } }) },
        'controls',
    );
    const features = [{ id: 'fast' }, { id: 'autoEffort' }];
    assert.deepEqual(Controls({ provider: 'paseodog', features }).props.features, [{ id: 'autoEffort' }]);
    assert.equal(Controls({ provider: 'codex', features }).props.features, features);
    let renderer;
    try {
        await act(async () => { renderer = create(React.createElement(Component, { client, provider: 'paseodog', agentId: 'one' })); });
        const trigger = () => renderer.root.findByType('trigger');
        assert.equal(trigger().props.icon, 'zap');
        assert.equal(trigger().props.showToolbarLabel, false);
        assert.equal(trigger().props.showCaret, false);
        assert.equal(trigger().props.accessibilityState.checked, false);
        assert.equal(renderer.root.findByType('zap').props.fill, undefined);
        await act(async () => { trigger().props.onPress(); trigger().props.onPress(); });
        assert.equal(trigger().props.accessibilityState.checked, true);
        assert.equal(trigger().props.iconColor, 'green');
        assert.equal(renderer.root.findByType('zap').props.fill, 'green');
        assert.deepEqual(writes, [['one', 'fast', true]]);
        client.fetchAgent = async () => { throw new Error('temporary disconnect'); };
        await act(async () => connectionListener({ status: 'connected' }));
        assert.equal(trigger().props.accessibilityState.checked, 'mixed');
        assert.equal(renderer.root.findByType('zap').props.fill, 'red');
        assert.deepEqual(writes, [['one', 'fast', true]]);
        await act(async () => { client.isConnected = false; connectionListener({ status: 'disconnected' }); });
        assert.equal(trigger().props.disabled, true);
        await act(async () => trigger().props.onPress());
        assert.equal(writes.length, 1);
    } finally {
        await act(async () => renderer?.unmount());
        delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    }
});

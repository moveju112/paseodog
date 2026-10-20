import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, until, deferred } from './helpers.mjs';
import { createNativeEngine } from '../engine/src/native-engine.mjs';

// 클라이언트 모드 변경을 실제 엔진까지 전달한 뒤 완료 응답을 보낸다.
test('session.configure advertises support and applies bypass and ask on the same session', async (t) => {
    const modes = [];
    const f = fixture({ async configure({ mode }) { modes.push(mode); } });
    t.after(() => f.connection.close());
    await f.ready();
    assert.ok(f.events.find((e) => e.type === 'session.opened').capabilities.includes('session.configure'));
    for (const mode of ['bypass', 'review', 'ask']) {
        await f.connection.send({ type: 'session.configure', sessionId: 'p1', requestId: mode, changes: { mode } });
        await until(f.events, (e) => e.type === 'request.completed' && e.requestId === mode);
        assert.equal(f.events.findLast((e) => e.type === 'session.config').config.mode, mode);
    }
    assert.deepEqual(modes, ['bypass', 'review', 'ask']);
});

// 지원하지 않는 변경이나 엔진 실패는 성공 응답·화면 상태 변경 없이 거절한다.
test('invalid changes and engine failures leave the mode unchanged', async (t) => {
    let calls = 0;
    const f = fixture({ async configure() { calls++; throw new Error('engine failed'); } });
    t.after(() => f.connection.close());
    await f.ready();
    const changes = [{ mode: 'invalid' }, { model: 'other' }, { mode: 'bypass' }];
    for (const [index, change] of changes.entries()) {
        const requestId = `invalid-${index}`;
        await f.connection.send({ type: 'session.configure', sessionId: 'p1', requestId, changes: change });
        await until(f.events, (e) => e.type === 'request.failed' && e.requestId === requestId);
    }
    assert.equal(calls, 1);
    assert.equal(f.events.findLast((e) => e.type === 'session.config').config.mode, 'ask');
});

// 모드 변경 중에는 새 턴이나 다른 모드 변경을 시작하지 않는다.
test('configuration serializes against prompts and other configuration requests', async (t) => {
    const gate = deferred();
    const f = fixture({ async configure() { await gate.promise; } });
    t.after(() => f.connection.close());
    await f.ready();
    await f.connection.send({ type: 'session.configure', sessionId: 'p1', requestId: 'first', changes: { mode: 'bypass' } });
    await f.connection.send({ type: 'session.configure', sessionId: 'p1', requestId: 'second', changes: { mode: 'ask' } });
    const busy = await until(f.events, (e) => e.type === 'request.failed' && e.requestId === 'second');
    assert.equal(busy.error.message, '이전 설정 변경을 저장하는 중이에요. 저장이 끝난 뒤 다시 선택해 주세요.');
    await f.connection.send(f.prompt);
    await until(f.events, (e) => e.type === 'session.prompt_result');
    assert.equal(f.calls.filter((c) => c.text).length, 0);
    gate.resolve();
    await until(f.events, (e) => e.type === 'request.completed' && e.requestId === 'first');
});

// 응답 중 설정 변경은 엔진에 전달하지 않고 대기·중지 안내만 돌려준다.
test('configuration during an active turn is rejected with a localized wait-or-stop notice', async (t) => {
    const gate = deferred();
    let configures = 0;
    const f = fixture({
        async ask(text, callbacks) { f.calls.push({ text, callbacks }); await gate.promise; return { result: { content: 'done' } }; },
        async configure() { configures++; },
    });
    t.after(() => f.connection.close());
    await f.ready();
    await f.connection.send(f.prompt);
    await until(f.calls, (c) => c.text);
    for (const [requestId, changes] of [['mode', { mode: 'bypass' }], ['effort', { thinkingOption: 'high' }], ['model', { model: 'other' }]]) {
        await f.connection.send({ type: 'session.configure', sessionId: 'p1', requestId, changes });
        const failed = await until(f.events, (e) => e.type === 'request.failed' && e.requestId === requestId);
        assert.equal(failed.error.message,
            '응답 중에는 모델·추론 수준·설정을 바꿀 수 없어요. 응답이 끝날 때까지 기다리거나 응답을 중지한 뒤 다시 선택해 주세요.');
    }
    assert.equal(configures, 0);
    assert.equal(f.events.findLast((e) => e.type === 'session.config').config.mode, 'ask');
    gate.resolve();
    await until(f.events, (e) => e.type === 'session.prompt_result');
});

// 네이티브 엔진은 같은 문맥에서 도구 표면과 다음 턴의 승인 정책을 함께 변경한다.
test('native configure changes tool surface and the next turn host policy', async () => {
    const session = { id: 'configured', messages: [] };
    const modes = [];
    const engine = await createNativeEngine({ config: { cwd: '/work', mode: 'ask', mcpServers: {} } }, {
        modules: {
            loadConfig: () => ({}),
            createMixdogSessionRuntime: async (options) => {
                const tool = { getStatus: () => ({ jobs: [] }), onStatusChange: () => () => {},
                    closeAll: async () => ({ failed: [] }) };
                options.agentSessionSurface({ mgr: {}, getAgentTool: () => tool });
                return {
                id: session.id,
                async setToolMode(mode) { modes.push(mode); },
                async ask(text, options) { options.beforeSessionAsk(session); return { content: text }; },
                abort() {}, close() {}, resume() {}, compact() {},
                };
            },
        },
    });
    try {
        for (const [mode, expected] of [['bypass', 'rewrite'], ['review', 'deny'], ['ask', 'ask']]) {
            await engine.configure({ mode });
            await engine.ask('test', {});
            assert.equal((await session.beforeToolHook({ name: 'shell', args: {} })).action, expected);
        }
        assert.deepEqual(modes, ['full', 'readonly', 'full']);
    } finally { await engine.close('done'); }
});

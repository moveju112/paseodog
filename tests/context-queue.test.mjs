import test from 'node:test';
import assert from 'node:assert/strict';
import { contextUsage } from '../plugin/server/util.mjs';
import { fixture, until, deferred } from './helpers.mjs';
import { runSharedAppTests } from './shared-app-tests.mjs';

// 공유 소스의 큐·첨부·steer 계약을 실행한다. 서버 전송과 컨텍스트 측정 검사는 아래에 유지한다.
test('shared composer preserves explicit queue attachments separately from native steering', () =>
    runSharedAppTests(['src/composer/actions.test.ts']));

test('context projection keeps real zero and unknowns without summing cumulative usage', () => {
    assert.deepEqual(contextUsage({ usedTokens: 0, effectiveContextWindow: 100 }), {
        contextWindowMaxTokens: 100, contextWindowUsedTokens: 0,
    });
    assert.deepEqual(contextUsage({ usedTokens: 42, contextWindow: 100, totalInputTokens: 99999 }), {
        contextWindowMaxTokens: 100, contextWindowUsedTokens: 42,
    });
    assert.deepEqual(contextUsage({ usedTokens: NaN, contextWindow: null }), {});
    assert.deepEqual(contextUsage({ usedTokens: -1, contextWindow: Infinity }), {});
});

test('chat context is published on open, response and compact without replacing token counts', async (t) => {
    let usedTokens = 40;
    const f = fixture({
        async status() { return { context: { usedTokens, effectiveContextWindow: 1000 } }; },
        async compact() { usedTokens = 10; return { changed: true }; },
    });
    t.after(() => f.connection.close());
    await f.ready();
    assert.deepEqual(f.events.find((event) => event.type === 'session.usage').usage, {
        contextWindowMaxTokens: 1000, contextWindowUsedTokens: 40,
    });
    await f.run();
    const usage = f.events.filter((event) => event.type === 'session.usage').at(-1).usage;
    assert.equal(usage.inputTokens, 12);
    assert.equal(usage.contextWindowUsedTokens, 40);
    const command = { ...f.prompt, prompt: { ...f.prompt.prompt, clientMessageId: 'compact-1',
        input: { type: 'command', name: 'compact' } } };
    await f.connection.send(command);
    await until(f.events, (event) => event.type === 'session.prompt_result' && event.clientMessageId === 'compact-1');
    // 다음 상태 조회가 완료되었음을 마지막 컨텍스트 이벤트로 확인한다.
    await until(f.events, (event) => event.type === 'session.usage' && event.usage.contextWindowUsedTokens === 10);
});

test('late context measurements cannot overwrite a canceled turn', async (t) => {
    const gate = deferred(), started = deferred();
    let reads = 0;
    const f = fixture({
        async status() {
            if (++reads > 1) { started.resolve(); await gate.promise; }
            return { context: { usedTokens: reads > 1 ? 999 : 40, contextWindow: 1000 } };
        },
    });
    t.after(async () => { gate.resolve(); await f.connection.close(); });
    await f.ready();
    await f.connection.send(f.prompt);
    await started.promise;
    await f.connection.send({ type: 'session.interrupt', requestId: 'stop', sessionId: 'p1' });
    await until(f.events, (event) => event.type === 'request.completed' && event.requestId === 'stop');
    gate.resolve();
    await f.connection.close();
    assert.equal(f.events.some((event) => event.type === 'session.usage' && event.usage.contextWindowUsedTokens === 999), false);
});

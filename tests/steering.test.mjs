import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, until, deferred } from './helpers.mjs';

// 지시를 별도 턴으로 바꾸지 않고 현재 턴에 한 번만 반영한다.
test('A plus B steering keeps the same active turn and is idempotent', async (t) => {
    const gate = deferred(), messages = [];
    let aborted = 0;
    const f = fixture({
        async ask(text) { await gate.promise; return { content: text + '+' + messages.join('+') }; },
        async steer(text) { messages.push(text); return { accepted: true }; },
        abort() { aborted++; },
    });
    t.after(async () => { gate.resolve(); await f.connection.close(); });
    await f.ready();
    f.prompt.prompt.input.content[0].text = 'A';
    await f.connection.send(f.prompt);
    const started = await until(f.events, (event) => event.type === 'session.turn' && event.state === 'started');
    const steer = { ...f.prompt, prompt: { ...f.prompt.prompt, clientMessageId: 'B', delivery: 'steer',
        input: { type: 'message', content: [{ type: 'text', text: 'B' }] } } };
    await f.connection.send(steer);
    const accepted = await until(f.events, (event) => event.type === 'session.prompt_result' && event.clientMessageId === 'B');
    assert.deepEqual(accepted.result, { type: 'steer', turnId: started.turnId });
    await f.connection.send(steer);
    gate.resolve();
    await until(f.events, (event) => event.type === 'session.turn' && event.state === 'completed');
    assert.deepEqual(messages, ['B']);
    assert.equal(aborted, 0);
    assert.equal(f.events.filter((event) => event.type === 'session.turn' && event.state === 'started').length, 1);
    assert.equal(f.events.findLast((event) => event.item?.type === 'assistant_message').item.text, 'A+B');
});

// 지시 전송 결과가 불명확해도 기존 작업은 유지하고 같은 메시지를 재실행하지 않는다.
test('uncertain steering is never automatically replayed', async (t) => {
    const gate = deferred();
    let injections = 0;
    const f = fixture({
        async ask() { await gate.promise; return { content: 'A complete' }; },
        async steer() { injections++; throw new Error('transport lost'); },
    });
    t.after(async () => { gate.resolve(); await f.connection.close(); });
    await f.ready(); await f.connection.send(f.prompt);
    await until(f.events, (event) => event.type === 'session.turn' && event.state === 'started');
    const steer = { ...f.prompt, prompt: { ...f.prompt.prompt, clientMessageId: 'B', delivery: 'steer' } };
    await f.connection.send(steer);
    const answer = await until(f.events, (event) => event.type === 'session.prompt_result' && event.clientMessageId === 'B');
    assert.equal(answer.result.type, 'failed');
    await f.connection.send(steer);
    gate.resolve();
    await until(f.events, (event) => event.type === 'session.turn' && event.state === 'completed');
    assert.equal(injections, 1);
    assert.ok(Object.values(f.store.list()[0].receipts).some((receipt) => receipt.state === 'uncertain'));
});

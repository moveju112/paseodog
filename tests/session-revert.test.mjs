import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nativeSessionAction } from '../engine/src/session-actions.mjs';
import { patchPaseoSteer } from '../scripts/patch-paseo-steer.mjs';
import { fixture, until } from './helpers.mjs';

const message = (id, text) => ({ type: 'session.prompt', sessionId: 'p1',
    prompt: { clientMessageId: id, delivery: 'auto', input: { type: 'message', content: [{ type: 'text', text }] } } });
const userItems = (events) => events.filter((event) => event.type === 'timeline.item' && event.item.type === 'user_message');
const finished = (events) => events.filter((event) => event.type === 'session.turn' && event.state !== 'started').length;

// 이번 턴의 종료 이벤트까지 기다린다 (헬퍼 run은 첫 종료 이벤트만 찾는다).
async function runTurn(f, prompt) {
    const before = finished(f.events);
    await f.connection.send(prompt);
    await until(f.events, () => finished(f.events) > before);
}

// 되돌리기 요청을 보내고 완료·실패 응답을 기다린다.
async function revert(f, requestId, messageId, scope) {
    await f.connection.send({ type: 'session.revert', requestId, sessionId: 'p1', token: { messageId }, scope });
    return until(f.events, (event) => ['request.completed', 'request.failed'].includes(event.type) && event.requestId === requestId);
}

// 사람 텍스트 턴에만 토큰을 붙이고 대화 범위 되돌리기는 엔진 절단 뒤 저널도 같은 지점에서 자른다.
test('revert tokens mark human text turns and conversation revert truncates the journal', async (t) => {
    const actions = [];
    const f = fixture({ async action(request) { actions.push(request); return { turns: 0, removed: 2 }; } });
    t.after(() => f.connection.close());
    await f.ready();
    await runTurn(f, message('m1', 'first'));
    await runTurn(f, { type: 'session.prompt', sessionId: 'p1', prompt: { clientMessageId: 'm2', delivery: 'auto',
        input: { type: 'message', content: [{ type: 'text', text: 'see image' }, { type: 'image', mimeType: 'image/png', data: 'AAAA' }] } } });
    await runTurn(f, { type: 'session.prompt', sessionId: 'p1', prompt: { clientMessageId: 'm3', delivery: 'auto',
        input: { type: 'command', name: 'compact', arguments: '' } } });
    await runTurn(f, message('m4', 'second'));
    const users = userItems(f.events);
    assert.deepEqual(users.map(({ item }) => Boolean(item.revertToken)), [true, false, false, true]);
    const second = users[3].item;
    assert.deepEqual(second.revertToken, { messageId: second.id });
    const done = await revert(f, 'r1', second.id, 'conversation');
    assert.equal(done.type, 'request.completed');
    assert.equal(actions.length, 2);
    assert.equal(actions[0].validateOnly, true);
    assert.equal(actions[1].validateOnly, undefined);
    assert.equal(actions[0].operation, 'rewind');
    assert.equal(actions[0].scope, 'conversation');
    assert.equal(actions[0].text, 'second');
    assert.equal(actions[0].confirmed, true);
    assert.equal(actions[0].since, undefined);
    const bridgeId = f.events.find((event) => event.type === 'session.opened').persistence.data.bridgeId;
    const items = f.store.load(bridgeId).items.map(({ item }) => item.id);
    assert.ok(!items.includes(second.id));
    assert.ok(items.includes(users[0].item.id));
});

// 시각 기반 파일 복구와 중복·타 세션 메시지는 엔진 호출 전에 거절한다.
test('file scopes and ambiguous or foreign targets are refused without mutation', async (t) => {
    const actions = [];
    const f = fixture({ async action(request) { actions.push(request); return { turns: 1 }; } });
    t.after(() => f.connection.close());
    await f.ready();
    await runTurn(f, message('m1', 'same'));
    const first = userItems(f.events)[0].item;
    assert.match((await revert(f, 'files', first.id, 'files')).error.message, /not negotiated/);
    assert.match((await revert(f, 'both', first.id, 'both')).error.message, /not negotiated/);
    const bridgeId = f.events.find((event) => event.type === 'session.opened').persistence.data.bridgeId;
    assert.ok(f.store.load(bridgeId).items.some(({ item }) => item.id === first.id));
    await runTurn(f, message('m2', ' same '));
    const ambiguous = await revert(f, 'dup', first.id, 'conversation');
    assert.match(ambiguous.error.message, /같은 내용/);
    assert.match((await revert(f, 'dup-last', userItems(f.events).at(-1).item.id, 'conversation')).error.message, /같은 내용/);
    assert.match((await revert(f, 'unknown', 'user:missing', 'conversation')).error.message, /되돌릴 수 없어요/);
    assert.equal(actions.length, 0);
    await assert.rejects(f.connection.sessionAction({ sessionId: 'p1', operation: 'rewind', scope: 'files', confirmed: true }),
        /session\.revert/);
});

// 협상하지 않은 되돌리기는 광고·실행하지 않는다.
test('revert is neither advertised nor executed without negotiation', async (t) => {
    const f = fixture({ async action() { throw new Error('must not run'); } },
        { capabilities: ['prompt.message', 'session.persistence'] });
    t.after(() => f.connection.close());
    await f.ready();
    await runTurn(f, message('m1', 'text'));
    const item = userItems(f.events)[0].item;
    assert.equal(item.revertToken, undefined);
    assert.match((await revert(f, 'r1', item.id, 'conversation')).error.message, /not negotiated/);
});

// 네이티브 대화의 유일한 본문만 절단하고 파일·중복·누락 대상을 거절한다.
test('native rewind requires a unique retained message and never guesses file checkpoints', async () => {
    const calls = [];
    const messages = [{ role: 'user', content: 'older' },
        { role: 'user', content: [{ type: 'text', text: 'target' }] }];
    const runtime = {
        id: 'native-rewind',
        readModelMessages: () => ({ messages }),
        async revertTurnChanges(...args) { calls.push(['undo', ...args]); },
        async rewindMessages(options) { calls.push(['rewind', options]); return { removed: 3 }; },
    };
    const request = { operation: 'rewind', scope: 'conversation', text: 'target', confirmed: true };
    await assert.rejects(nativeSessionAction(runtime, { ...request, confirmed: false }), /확인/);
    await assert.rejects(nativeSessionAction(runtime, { ...request, text: 'gone' }), /찾지 못했어요/);
    for (const scope of ['files', 'both'])
        await assert.rejects(nativeSessionAction(runtime, { ...request, scope, since: 0 }), /턴별 Undo/);
    assert.equal(calls.length, 0);
    assert.deepEqual(await nativeSessionAction(runtime, request), { turns: 0, removed: 3 });
    assert.deepEqual(calls, [['rewind', { text: 'target' }]]);
    calls.length = 0;
    messages.push({ role: 'user', content: ' target ' });
    await assert.rejects(nativeSessionAction(runtime, request), /같은 내용/);
    assert.equal(calls.length, 0);
});

// 모델 호출 전에 실패한 중복 메시지가 이전 정상 모델 기록을 지우지 못하게 한다.
test('failed duplicate prompts cannot rewind an earlier successful model turn', async (t) => {
    const modelMessages = [];
    let attempts = 0, rewinds = 0;
    const f = fixture({
        async ask(text) {
            if (++attempts === 2) throw new Error('Unable to refresh engine settings before turn');
            modelMessages.push({ role: 'user', content: text });
            return { content: 'ok' };
        },
        async action() { rewinds++; modelMessages.length = 0; },
    });
    t.after(() => f.connection.close());
    await f.ready();
    await runTurn(f, message('first', 'same'));
    await runTurn(f, message('failed', 'same'));
    const result = await revert(f, 'failed-revert', userItems(f.events).at(-1).item.id, 'conversation');
    assert.match(result.error.message, /정상 완료/);
    assert.equal(modelMessages.length, 1);
    assert.equal(rewinds, 0);
});

// 네이티브 변경 전 영속 마커를 남기고 실패·재접속 때 변경을 다시 실행하지 않는다.
test('uncertain rewind is durable and blocks reuse without replay', async (t) => {
    let attempts = 0, persistence;
    const f = fixture({ async action(request) {
        if (request.validateOnly) return { ready: true };
        attempts++;
        assert.ok(f.store.load(persistence.data.bridgeId).pendingRevert);
        throw new Error('worker disconnected after native save');
    } });
    t.after(() => f.connection.close());
    await f.ready();
    persistence = f.events.find((event) => event.type === 'session.opened').persistence;
    await runTurn(f, message('first', 'unique'));
    const id = userItems(f.events)[0].item.id;
    assert.match((await revert(f, 'fault', id, 'conversation')).error.message, /결과 확인/);
    assert.match((await revert(f, 'retry', id, 'conversation')).error.message, /not ready/);
    await f.connection.close();
    const resumed = fixture({}, { store: f.store });
    t.after(() => resumed.connection.close());
    await resumed.connection.send({ ...resumed.open, persistence });
    const failure = await until(resumed.events, (event) => event.type === 'request.failed');
    assert.match(failure.error.message, /이전 되돌리기 결과가 불확실/);
    assert.equal(attempts, 1);
    assert.equal(resumed.creates.length, 0);
    assert.ok(f.store.load(persistence.data.bridgeId).items.some(({ item }) => item.id === id));
});

// 변경 전 압축 누락 거부는 영속 마커나 세션 잠금을 남기지 않는다.
test('read-only rewind validation failure leaves the session usable', async (t) => {
    const f = fixture({ async action(request) {
        assert.equal(request.validateOnly, true);
        throw new Error('모델 대화에서 되돌릴 메시지를 찾지 못했어요.');
    } });
    t.after(() => f.connection.close());
    await f.ready();
    await runTurn(f, message('first', 'compacted'));
    const id = userItems(f.events)[0].item.id;
    assert.match((await revert(f, 'missing', id, 'conversation')).error.message, /찾지 못했어요/);
    const persistence = f.events.find((event) => event.type === 'session.opened').persistence;
    assert.equal(f.store.load(persistence.data.bridgeId).pendingRevert, undefined);
    await runTurn(f, message('next', 'still usable'));
    assert.equal(f.events.filter((event) => event.type === 'session.turn').at(-1).state, 'completed');
});

// 설치한 데몬 어댑터가 대화 되돌리기 뒤 대상 메시지부터 재수화 기록을 버린다.
test('installed daemon adapter drops rewound history only for conversation scopes', async () => {
    const root = new URL('../tools/node_modules/@getpaseo/server/', import.meta.url);
    patchPaseoSteer(root.pathname, { check: true });
    const source = readFileSync(new URL('dist/server/server/agent/plugin-provider.js', root), 'utf8');
    const start = source.indexOf('    async revert(messageId, scope) {');
    const method = source.slice(start, source.indexOf('    publish(event) {', start));
    const revertMethod = new Function('randomUUID', `return ({${method}}).revert;`)(() => 'request');
    for (const [scope, kept] of [['files', 4], ['conversation', 2], ['both', 2]]) {
        const sent = [];
        const history = [
            { type: 'timeline', item: { type: 'user_message', messageId: 'user:a', text: 'a' } },
            { type: 'turn_completed', turnId: 't1' },
            { type: 'timeline', item: { type: 'user_message', messageId: 'user:b', text: 'b' } },
            { type: 'timeline', item: { type: 'assistant_message', messageId: 'assistant:b', text: 'reply' } },
        ];
        const self = { history, revertTokens: new Map([['user:b', { messageId: 'user:b' }]]),
            bridge: { providerId: 'provider', async revert(input) { sent.push(input); } } };
        await revertMethod.call(self, 'user:b', scope);
        assert.equal(history.length, kept);
        assert.deepEqual(sent, [{ type: 'session.revert', requestId: 'request', sessionId: 'provider',
            token: { messageId: 'user:b' }, scope }]);
    }
});

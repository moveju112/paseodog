import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeSessionAction } from '../engine/src/session-actions.mjs';
import { _setTurnSnapshotStoreRootForTest, upsertTurnChangeRecord }
    from '../engine/node_modules/mixdog/src/runtime/shared/turn-snapshot-store.mjs';
import { patchPaseoSteer } from '../scripts/patch-paseo-steer.mjs';
import { fixture, until, delay } from './helpers.mjs';

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
    assert.equal(actions.length, 1);
    assert.equal(actions[0].operation, 'rewind');
    assert.equal(actions[0].scope, 'conversation');
    assert.equal(actions[0].text, 'second');
    assert.equal(actions[0].confirmed, true);
    assert.ok(Number.isFinite(actions[0].since));
    const bridgeId = f.events.find((event) => event.type === 'session.opened').persistence.data.bridgeId;
    const items = f.store.load(bridgeId).items.map(({ item }) => item.id);
    assert.ok(!items.includes(second.id));
    assert.ok(items.includes(users[0].item.id));
});

// 파일 범위는 저널을 유지하고, 위치가 모호하거나 노출하지 않은 대상은 엔진 호출 전에 거절한다.
test('files revert keeps the journal and ambiguous or foreign targets are refused', async (t) => {
    const actions = [];
    const f = fixture({ async action(request) { actions.push(request); return { turns: 1 }; } });
    t.after(() => f.connection.close());
    await f.ready();
    await runTurn(f, message('m1', 'same'));
    const first = userItems(f.events)[0].item;
    assert.equal((await revert(f, 'files', first.id, 'files')).type, 'request.completed');
    const bridgeId = f.events.find((event) => event.type === 'session.opened').persistence.data.bridgeId;
    assert.ok(f.store.load(bridgeId).items.some(({ item }) => item.id === first.id));
    await runTurn(f, message('m2', ' same '));
    const ambiguous = await revert(f, 'dup', first.id, 'both');
    assert.match(ambiguous.error.message, /같은 내용/);
    assert.match((await revert(f, 'unknown', 'user:missing', 'conversation')).error.message, /되돌릴 수 없어요/);
    assert.equal(actions.length, 1);
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

// 실제 변경 기록 저장소에서 대상 이후 턴만 최신순으로 복구한 뒤 대화를 자른다.
test('native rewind reverts later turn checkpoints newest first, then truncates the conversation', async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'paseodog-rewind-'));
    _setTurnSnapshotStoreRootForTest(root);
    t.after(() => { _setTurnSnapshotStoreRootForTest(''); rmSync(root, { recursive: true, force: true }); });
    const calls = [];
    const runtime = {
        id: 'native-rewind',
        readModelMessages: () => ({ messages: [{ role: 'user', content: 'older' },
            { role: 'user', content: [{ type: 'text', text: 'target' }] }] }),
        async revertTurnChanges(...args) { calls.push(['undo', ...args]); },
        async rewindMessages(options) { calls.push(['rewind', options]); return { removed: 3 }; },
    };
    const file = (path) => ({ path, status: 'modified' });
    await upsertTurnChangeRecord(runtime.id, { checkpointId: 'before', root, files: [file('a.txt')] });
    await delay(5);
    const since = Date.now();
    await delay(5);
    await upsertTurnChangeRecord(runtime.id, { checkpointId: 'target-turn', root, files: [file('b.txt')] });
    await delay(5);
    await upsertTurnChangeRecord(runtime.id, { checkpointId: 'later-turn', root, files: [file('c.txt')] });
    await assert.rejects(nativeSessionAction(runtime, { operation: 'rewind', scope: 'both', text: 'target', since }), /확인/);
    await assert.rejects(nativeSessionAction(runtime, { operation: 'rewind', scope: 'both', text: 'gone', since, confirmed: true }),
        /찾지 못했어요/);
    assert.equal(calls.length, 0);
    const result = await nativeSessionAction(runtime, { operation: 'rewind', scope: 'both', text: ' target ', since, confirmed: true });
    assert.deepEqual(calls, [['undo', 'later-turn', null, 1], ['undo', 'target-turn', null, 1], ['rewind', { text: 'target' }]]);
    assert.deepEqual(result, { turns: 2, removed: 3 });
    calls.length = 0;
    runtime.revertTurnChanges = async (id) => { calls.push(id); if (id === 'target-turn') throw new Error('conflict'); };
    await assert.rejects(nativeSessionAction(runtime, { operation: 'rewind', scope: 'both', text: 'target', since, confirmed: true }),
        /최근 1개 턴까지만.*대화는 바꾸지 않았어요: conflict/);
    assert.deepEqual(calls, ['later-turn', 'target-turn']);
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

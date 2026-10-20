import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, until } from './helpers.mjs';

// 저장된 사용자 메시지로 가져오기 목록을 채우고 실제 메시지 전송 경로까지 확인한다.
test('session list exposes the first saved user prompt without changing history', async (t) => {
    const f = fixture();
    t.after(() => f.connection.close());
    await f.ready();
    await f.run();
    const before = f.store.list();
    await f.connection.send({ type: 'sessions', requestId: 'preview', cwd: '/work' });
    const event = await until(f.events, (row) => row.type === 'sessions');
    assert.equal(event.sessions[0].title, 'fix code');
    assert.equal(event.sessions[0].description, 'fix code');
    assert.deepEqual(event.sessions[0].persistence, { version: 2, data: { bridgeId: before[0].id } });
    assert.deepEqual(f.store.list(), before);
});

// 기존 저널의 빈 메시지·에이전트 알림은 건너뛰고 첫 사용자 요청을 검색한다.
test('session previews normalize saved text and retain cwd, search and limit filtering', async (t) => {
    const f = fixture();
    t.after(() => f.connection.close());
    const populated = f.store.create('populated', '/work/project', 'hash');
    populated.items = [
        { item: { type: 'notification', message: 'agent-only' } },
        { item: { type: 'assistant_message', text: 'assistant-only' } },
        { item: { type: 'user_message', text: ' \n ' } },
        { item: { type: 'user_message', text: '  장비 해제\n  오류 수정  ' } },
        { item: { type: 'user_message', text: 'later-only' } },
    ];
    populated.updatedAt = 20;
    f.store.save(populated);
    f.store.create('empty', '/work/empty', 'hash');
    await f.connection.send({ type: 'sessions', requestId: 'search', query: '오류', cwd: '/work/project', limit: 1 });
    const event = await until(f.events, (row) => row.requestId === 'search');
    assert.equal(event.sessions.length, 1);
    assert.equal(event.sessions[0].title, '장비 해제 오류 수정');
    assert.equal(event.sessions[0].description, '장비 해제 오류 수정');
    await f.connection.send({ type: 'sessions', requestId: 'empty', cwd: '/work/empty' });
    const empty = await until(f.events, (row) => row.requestId === 'empty');
    assert.equal(empty.sessions[0].title, 'empty');
    assert.equal(empty.sessions[0].description, undefined);
    await f.connection.send({ type: 'sessions', requestId: 'excluded', query: 'assistant-only' });
    assert.deepEqual((await until(f.events, (row) => row.requestId === 'excluded')).sessions, []);
});

// 긴 요청은 목록에서만 제한하고 원본 메시지는 그대로 유지한다.
test('session list bounds title and preview without truncating stored prompts', async (t) => {
    const f = fixture();
    t.after(() => f.connection.close());
    const record = f.store.create('long', '/work', 'hash');
    const text = '가'.repeat(600);
    record.items = [{ item: { type: 'user_message', text } }];
    f.store.save(record);
    await f.connection.send({ type: 'sessions', requestId: 'long' });
    const event = await until(f.events, (row) => row.requestId === 'long');
    assert.equal(event.sessions[0].title, text.slice(0, 100));
    assert.equal(event.sessions[0].description, text.slice(0, 500));
    assert.equal(f.store.load('long').items[0].item.text, text);
});

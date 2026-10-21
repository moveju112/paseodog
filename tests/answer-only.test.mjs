import test from 'node:test';
import assert from 'node:assert/strict';
import { answerOnlyRows } from '../patches/answer-only.mjs';

// 여러 턴·도구 경계·분할 본문을 섞어 최종 답변과 안전 알림만 남는지 확인한다.
test('answer-only projection preserves completed turns and every final Markdown block', () => {
    const tail = Object.freeze([
        { kind: 'user_message', id: 'q1', turnId: 't1' },
        { kind: 'assistant_message', id: 'intro', turnId: 't1', text: 'checking' },
        { kind: 'tool_call', id: 'tool', turnId: 't1' },
        { kind: 'assistant_message', id: 'a:0', blockGroupId: 'a', turnId: 't1', text: 'first paragraph' },
        { kind: 'assistant_message', id: 'a:1', blockGroupId: 'a', turnId: 't1', text: 'second paragraph' },
        { kind: 'user_message', id: 'q2', turnId: 't2' },
    ]);
    const head = Object.freeze([
        { kind: 'assistant_message', id: 'progress', turnId: 't2', text: 'working' },
        { kind: 'tool_call', id: 'tool2', turnId: 't2' },
        { kind: 'thought', id: 'thought', turnId: 't2' },
        { kind: 'notification', id: 'info', turnId: 't2', level: 'info' },
        { kind: 'notification', id: 'error', turnId: 't2', level: 'error' },
        { kind: 'notification', id: 'warning', turnId: 't2', level: 'warning' },
        { kind: 'assistant_message', id: 'final', turnId: 't2', text: 'done' },
    ]);
    const active = answerOnlyRows(tail, head, true);
    assert.deepEqual(active.tail.map((item) => item.id), ['q1', 'a:0', 'a:1', 'q2']);
    assert.deepEqual(active.head.map((item) => item.id), ['error', 'warning']);
    assert.deepEqual(answerOnlyRows(tail, head, false).head.map((item) => item.id), ['error', 'warning', 'final']);
    assert.deepEqual(answerOnlyRows(tail, head.slice(0, 2), false).head, []);
    assert.equal(tail.length, 6);
    assert.equal(head.length, 7);
});

// turnId가 없는 이전 기록은 사용자 메시지 경계로 구분하고 빈 본문은 행도 만들지 않는다.
test('legacy user boundaries and empty responses do not leak progress or blank rows', () => {
    const tail = [
        { kind: 'user_message', id: 'q1' },
        { kind: 'assistant_message', id: 'a1', text: 'old answer' },
        { kind: 'user_message', id: 'q2' },
        { kind: 'assistant_message', id: 'a2', text: '  \n' },
    ];
    assert.deepEqual(answerOnlyRows(tail, [], false).tail.map((item) => item.id), ['q1', 'a1', 'q2']);
    assert.deepEqual(answerOnlyRows([], [], true), { tail: [], head: [] });
});

// 불러온 꼬리 범위가 모두 숨겨지면 완료된 턴의 마지막 답변 묶음만 남기고, 진행 중 턴은 계속 숨긴다.
test('fully hidden loaded windows keep the last completed answer block instead of an empty chat', () => {
    const tail = [
        { kind: 'tool_call', id: 'tool1', turnId: 't1' },
        { kind: 'assistant_message', id: 'b:0', blockGroupId: 'b', turnId: 't1', text: 'part one' },
        { kind: 'assistant_message', id: 'b:1', blockGroupId: 'b', turnId: 't1', text: 'part two' },
        { kind: 'assistant_message', id: 'blank', turnId: 't1', text: ' ' },
        { kind: 'tool_call', id: 'tool2', turnId: 't1' },
    ];
    assert.deepEqual(answerOnlyRows(tail, [], false).tail.map((item) => item.id), ['b:0', 'b:1']);
    assert.deepEqual(answerOnlyRows(tail.slice(0, 2), tail.slice(2), false).head.map((item) => item.id), ['b:1']);
    assert.deepEqual(answerOnlyRows(tail, [], true), { tail: [], head: [] });
    assert.deepEqual(answerOnlyRows([tail[0]], [], false), { tail: [], head: [] });
});

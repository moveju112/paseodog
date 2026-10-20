import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { fixture, until } from './helpers.mjs';
import { processEngineFactory } from '../plugin/server/process-engine.mjs';
import { questionRequestInput, questionAnswers } from '../plugin/server/question.mjs';

const option = (label) => ({ label, description: `${label} option` });
const single = { question: 'Which path?', header: 'Path', options: [option('Fast'), option('Safe')], recommended: 0 };
const multi = { question: 'Which checks?', header: 'Checks', options: [option('Lint'), option('Test'), option('Lint, Test')], multi_select: true };
const askInfo = (questions) => ({ name: 'ask_user', kind: 'question', reason: '', args: { questions } });

// 네이티브 ask_user를 띄우고 Paseo 질문 카드 이벤트까지 기다린다.
async function openQuestion(t, questions, options) {
    const state = {};
    const f = fixture({ async ask(_text, cb) { state.decision = await cb.onToolApproval(askInfo(questions)); return { content: 'done' }; } }, options);
    t.after(() => f.connection.close());
    await f.ready(); await f.connection.send(f.prompt);
    const request = (await until(f.events, (e) => e.type === 'session.permission')).request;
    return { f, state, request };
}
// 공용 질문 UI처럼 request.input에 answers를 덧붙여 응답한다.
const answer = (f, request, response) => f.connection.send({ type: 'session.permission', sessionId: 'p1', permissionId: request.id, response });

// 질문 요청 -> Paseo 공용 질문 입력(kind:'question', header/options/multiSelect/allowOther).
test('native ask_user becomes a shared question card, not an allow-once approval', async (t) => {
    const { request } = await openQuestion(t, [single, multi]);
    assert.equal(request.kind, 'question');
    assert.equal(request.actions, undefined);
    assert.deepEqual(request.input.questions, [
        { id: '0', header: 'Path', question: 'Which path?', options: [option('Fast'), option('Safe')], multiSelect: false, allowOther: true },
        { id: '1', header: 'Checks', question: 'Which checks?', options: [option('Lint'), option('Test'), option('Lint, Test')], multiSelect: true, allowOther: true },
    ]);
});

// 선택 라벨·직접 입력·다중 선택 답을 네이티브 answers 순서로 전달한다.
test('header-keyed answers reach the native callback as selected labels and typed text', async (t) => {
    for (const [answers, expected] of [
        [{ Path: 'Safe', Checks: 'Test, Lint' }, [{ selected: ['Safe'] }, { selected: ['Test', 'Lint'] }]],
        [{ Path: 'use staging', Checks: 'Lint, Test' }, [{ selected: [], text: 'use staging' }, { selected: [], text: 'Lint, Test' }]],
        [{ Path: 'use staging', Checks: 'Test' }, [{ selected: [], text: 'use staging' }, { selected: ['Test'] }]],
        [{ Path: 'Safe', Checks: 'Lint, staging only' }, [{ selected: ['Safe'] }, { selected: [], text: 'Lint, staging only' }]],
        [{ Path: 'Safe', Checks: 'run only smoke' }, [{ selected: ['Safe'] }, { selected: [], text: 'run only smoke' }]],
    ]) {
        const { f, state, request } = await openQuestion(t, [single, multi]);
        await answer(f, request, { behavior: 'allow', updatedInput: { ...request.input, answers } });
        await until(f.events, (e) => e.type === 'session.turn' && e.state === 'completed');
        assert.deepEqual(state.decision, { approved: true, answers: expected });
    }
});

// 누락·알 수 없는·과대·allow 액션/권한 변경 답은 질문을 유지한 채 거부하고, 닫기는 미응답으로 전달한다.
test('invalid question responses are rejected and dismiss stays a denial', async (t) => {
    for (const response of [
        { behavior: 'allow' },
        { behavior: 'allow', updatedInput: { answers: {} } },
        { behavior: 'allow', updatedInput: { answers: { Path: 'Fast', Other: 'x' } } },
        { behavior: 'allow', updatedInput: { answers: { Path: 'x'.repeat(4001) } } },
        { behavior: 'allow', selectedActionId: 'allow-once', updatedInput: { answers: { Path: 'Fast' } } },
        { behavior: 'allow', updatedPermissions: [{}], updatedInput: { answers: { Path: 'Fast' } } },
    ]) {
        const { f, state, request } = await openQuestion(t, [single]);
        await answer(f, request, response);
        await until(f.events, (e) => e.type === 'session.notice' && e.notice.id === `permission-rejected:${request.id}`);
        assert.equal(state.decision, undefined);
        assert.equal(f.events.some((e) => e.type === 'session.permission_resolved'), false);
    }
    const { f, state, request } = await openQuestion(t, [single]);
    await answer(f, request, { behavior: 'deny', message: 'Dismissed by user' });
    await until(f.events, (e) => e.type === 'session.turn' && e.state === 'completed');
    assert.deepEqual(state.decision, { approved: false, reason: 'Dismissed by user' });
});

// 헤더 중복·세션 불일치는 카드 없이 거부하고, 기존 승인 타임아웃은 질문에도 그대로 적용된다.
test('duplicate headers and foreign sessions fail closed; question keeps the approval timeout', async (t) => {
    const duplicate = { ...single, question: 'Other?' };
    for (const info of [askInfo([single, duplicate]), { ...askInfo([single]), sessionId: 'wrong' }]) {
        let decision;
        const f = fixture({ async ask(_t, cb) { cb.onIdentity({ id: 'sess_test' }); decision = await cb.onToolApproval(info); return { content: 'done' }; } });
        t.after(() => f.connection.close());
        await f.ready(); await f.run();
        assert.equal(decision.approved, false);
        assert.equal(f.events.some((e) => e.type === 'session.permission'), false);
    }
    const { f, state } = await openQuestion(t, [single], { permissionMs: 12 });
    await until(f.events, (e) => e.type === 'session.turn' && e.state === 'completed');
    assert.equal(state.decision.approved, false);
    assert.match(state.decision.reason, /timed out/);
});

// 일반 도구 승인에는 질문 답(updatedInput)을 보내도 여전히 거부된다.
test('regular tool approvals still reject updatedInput answers', async (t) => {
    let decision;
    const f = fixture({ async ask(_t, cb) { decision = await cb.onToolApproval({ name: 'shell', args: { command: 'pwd' } }); return { content: 'done' }; } });
    t.after(() => f.connection.close());
    await f.ready(); await f.connection.send(f.prompt);
    const request = (await until(f.events, (e) => e.type === 'session.permission')).request;
    assert.equal(request.kind, 'tool');
    await answer(f, request, { behavior: 'allow', updatedInput: { answers: { Path: 'Fast' } } });
    await until(f.events, (e) => e.type === 'session.turn' && e.state === 'completed');
    assert.equal(decision.approved, false);
});

// 순수 변환: 확실한 선택은 라벨로, 구분할 수 없는 다중 선택·직접 입력은 원문으로 보존한다.
test('question mapping helpers follow the shared UI serialization', () => {
    const questions = [single, multi];
    assert.equal(questionRequestInput({ questions }).questions.length, 2);
    assert.throws(() => questionRequestInput({ questions: [single, { ...multi, header: 'Path' }] }), /Duplicate/);
    // "Lint, Test, Lint"는 중복 라벨을 제외하면 ["Lint, Test", "Lint"] 하나로만 분해된다.
    assert.deepEqual(questionAnswers(questions, { answers: { Path: 'Fast', Checks: 'Lint, Test, Lint' } }),
        [{ selected: ['Fast'] }, { selected: ['Lint, Test', 'Lint'] }]);
    assert.deepEqual(questionAnswers(questions, { answers: { Path: 'Fast', Checks: 'Lint, Lint' } }),
        [{ selected: ['Fast'] }, { selected: [], text: 'Lint, Lint' }]);
    assert.deepEqual(questionAnswers(questions, { answers: { Path: 'Fast', Checks: 'Build' } }),
        [{ selected: ['Fast'] }, { selected: [], text: 'Build' }]);
    assert.deepEqual(questionAnswers(questions, { answers: { Path: 'Safe, then Fast', Checks: 'Test' } }),
        [{ selected: [], text: 'Safe, then Fast' }, { selected: ['Test'] }]);
});

// 실제 자식 프로세스 JSONL: permission 이벤트 -> 질문 답 -> worker -> 네이티브 콜백 결과.
test('question answers round-trip through an actual worker child process', async (t) => {
    const script = fileURLToPath(new URL('./fixtures/worker-fixture.mjs', import.meta.url));
    const children = [];
    t.after(() => { for (const child of children) child.kill('SIGKILL'); });
    const factory = processEngineFactory({ launch: { command: process.execPath, args: [script], env: { ...process.env } },
        spawnProcess: (...args) => { const child = spawn(...args); children.push(child); return child; },
        terminateProcess: (child) => child.kill('SIGKILL'), timeoutMs: 5000, stopMs: 100, scopeMode: 'test-only-process-group' });
    const args = { config: { cwd: tmpdir(), env: {}, mcpServers: {}, settings: {}, persist: true } };
    for (const [reply, expected] of [
        [{ approved: true, answers: [{ selected: ['B'] }] }, { approved: true, answers: [{ selected: ['B'] }] }],
        [{ approved: true }, { approved: false, reason: 'Invalid question answers' }],
        [{ approved: true, answers: [{ selected: 'B' }] }, { approved: false, reason: 'Invalid question answers' }],
        [{ approved: true, answers: [{ selected: [], text: 'x'.repeat(4001) }] }, { approved: false, reason: 'Invalid question answers' }],
        [{ approved: false, reason: 'Dismissed by user' }, { approved: false, reason: 'Dismissed by user' }],
    ]) {
        const engine = await factory.create(args);
        try {
            let seen;
            const result = await engine.ask('question', { onToolApproval: async (info) => { seen = info; return reply; } });
            assert.equal(seen.kind, 'question');
            assert.equal(seen.name, 'ask_user');
            assert.deepEqual(JSON.parse(result.result.content), expected);
        } finally { await engine.close(); }
    }
    // 일반 도구 승인에 answers가 섞이면 worker가 거부한다.
    const engine = await factory.create(args);
    try {
        const result = await engine.ask('permission', { onToolApproval: async () => ({ approved: true, answers: [{ selected: ['A'] }] }) });
        assert.equal(result.result.content, 'denied');
    } finally { await engine.close(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, until } from './helpers.mjs';

const takeover = {
    kind: 'takeover',
    surface: 'browser',
    target: 'Project settings',
    instructions: 'Settings → General에서 Project ID를 확인해 줘.\n확인한 값을 알려 줘.',
    need: 'action',
};
async function openHandoff(t, handoff = takeover, options) {
    const state = {};
    const input = { handoff };
    const f = fixture({ async ask(_text, cb) {
        state.decision = await cb.onToolApproval({ name: 'handoff_user', args: input });
        return { content: 'done' };
    } }, { permissionMs: 1000, ...options });
    t.after(() => f.connection.close());
    await f.ready();
    await f.connection.send(f.prompt);
    const request = (await until(f.events, (event) => event.type === 'session.permission')).request;
    return { f, state, request, input };
}
async function respond({ f, request }, response) {
    await f.connection.send({ type: 'session.permission', sessionId: 'p1', permissionId: request.id, response });
    await until(f.events, (event) => event.type === 'session.turn' && event.state === 'completed');
}

test('handoff presents Korean guidance through the existing app/web plain-text detail instead of JSON', async (t) => {
    const { request, state, input } = await openHandoff(t);
    assert.equal(request.name, 'handoff_user');
    assert.equal(request.kind, 'tool');
    assert.equal(request.title, '직접 확인이 필요해');
    assert.equal(request.description, '브라우저에서 직접 처리해야 하는 단계야. 아래 요청을 확인하고 허용해 줘.');
    assert.deepEqual(request.detail, {
        type: 'plain_text',
        text: `대상: Project settings\n\n작업: 직접 작업\n\n${takeover.instructions}`,
    });
    assert.deepEqual(request.input, input);
    assert.deepEqual(request.actions, [
        { id: 'allow-once', label: '한 번 허용', behavior: 'allow', variant: 'primary' },
        { id: 'deny', label: '거절', behavior: 'deny', variant: 'danger' },
    ]);
    assert.equal(state.decision, undefined);
});

test('secret handoff explains direct entry and preserves all screen/field context as readable text', async (t) => {
    const { request } = await openHandoff(t, {
        kind: 'secret', surface: 'computer', target: 'Account sign-in', app: 'Browser',
        field: 'Password', window_id: 'window-1', ref: 'field-1',
    });
    assert.equal(request.title, '직접 입력이 필요해');
    assert.equal(request.description, '컴퓨터 화면에 직접 입력하는 단계야. 비밀번호나 인증 코드는 채팅으로 보내지 마.');
    assert.equal(request.detail.text, '대상: Account sign-in\n\n앱: Browser\n\n입력 항목: Password\n\n창: window-1\n\n입력 위치: field-1');
});

test('browser login context and confirmation are readable without opening a URL or auto-approving', async (t) => {
    const { request, state } = await openHandoff(t, {
        ...takeover, purpose: 'login', need: 'confirmation', url: 'https://example.com/login', tab: 'tab-1',
    });
    assert.equal(request.detail.text,
        `대상: Project settings\n\n페이지: https://example.com/login\n\n브라우저 탭: tab-1\n\n작업: 본인·결제 확인\n\n목적: 로그인\n\n${takeover.instructions}`);
    assert.equal(state.decision, undefined);
    const login = await openHandoff(t, { ...takeover, need: 'sign_in' });
    assert.match(login.request.detail.text, /작업: 로그인·인증/);
});

test('minimal handoffs still show guidance rather than an empty tool detail', async (t) => {
    for (const [kind, text] of [
        ['secret', '요청한 입력 항목을 해당 화면에 직접 입력해 줘.'],
        ['takeover', '요청한 화면에서 작업을 마친 뒤 알려 줘.'],
    ]) {
        const { request } = await openHandoff(t, { kind, surface: 'browser' });
        assert.deepEqual(request.detail, { type: 'plain_text', text });
    }
});

test('handoff keeps allow-once, denial, timeout, and argument-edit protection', async (t) => {
    for (const response of [
        { behavior: 'allow', selectedActionId: 'allow-once' },
        { behavior: 'deny', selectedActionId: 'deny', message: '사용자 거절' },
        { behavior: 'allow', selectedActionId: 'allow-always' },
        { behavior: 'allow', updatedInput: { handoff: { ...takeover, target: 'Other' } } },
        { behavior: 'allow', updatedPermissions: [{}] },
    ]) {
        const pending = await openHandoff(t);
        await respond(pending, response);
        assert.equal(pending.state.decision.approved, response.selectedActionId === 'allow-once');
        assert.ok(pending.f.events.some((event) => event.type === 'session.permission_resolved' && event.permissionId === pending.request.id));
    }
    const pending = await openHandoff(t, takeover, { permissionMs: 20 });
    await until(pending.f.events, (event) => event.type === 'session.turn' && event.state === 'completed');
    assert.equal(pending.state.decision.approved, false);
    assert.match(pending.state.decision.reason, /timed out/);
});

test('malformed or unpresentable handoffs fail closed without hiding arguments in a friendly card', async (t) => {
    for (const args of [
        {}, { handoff: null }, { handoff: [] },
        { handoff: { ...takeover, kind: 'other' } },
        { handoff: { ...takeover, surface: 'other' } },
        { handoff: { ...takeover, instructions: {} } },
        { handoff: { ...takeover, hidden: 'unshown operation' } },
        { handoff: { ...takeover, need: 'other' } },
        { handoff: { ...takeover, purpose: 'other' } },
        { handoff: takeover, hidden: 'unshown operation' },
    ]) {
        let decision;
        const f = fixture({ async ask(_text, cb) {
            decision = await cb.onToolApproval({ name: 'handoff_user', args });
            return { content: 'done' };
        } });
        t.after(() => f.connection.close());
        await f.ready();
        await f.run();
        assert.equal(decision.approved, false);
        assert.equal(f.events.some((event) => event.type === 'session.permission'), false);
    }
});

test('ordinary tools keep their original input and approval presentation', async (t) => {
    const f = fixture({ async ask(_text, cb) {
        await cb.onToolApproval({ name: 'shell', args: { command: 'pwd' } });
        return { content: 'done' };
    } });
    t.after(() => f.connection.close());
    await f.ready();
    await f.connection.send(f.prompt);
    const { request } = await until(f.events, (event) => event.type === 'session.permission');
    assert.equal(request.title, 'Allow shell once?');
    assert.equal(request.detail, undefined);
    assert.deepEqual(request.input, { command: 'pwd' });
});

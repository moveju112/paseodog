import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestrationBridge } from '../engine/src/orchestration.mjs';
import { attachHostPolicy } from '../engine/src/policy.mjs';
import { patchedAgentSource, gitBlob, AGENT_PATCHES } from '../scripts/patch-mixdog.mjs';
import { deferred } from './helpers.mjs';

// 실제 네이티브 계약과 같은 소유권·이벤트 인터페이스로 호스트 경계를 검사한다.
function fixture({ mode = 'ask', ask, callbacks = {}, pendingMessages } = {}) {
    const listeners = new Set(), calls = [], jobs = new Map();
    const lead = { id: 'lead', messages: [] };
    const child = { id: 'child', parentSessionId: 'lead', messages: [], agentTag: 'worker' };
    const sessions = new Map([[lead.id, lead], [child.id, child]]);
    const tool = {
        getStatus: ({ callerSessionId }) => ({ jobs: jobs.get(callerSessionId) || [] }),
        onStatusChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        async closeAll(reason, scope) {
            calls.push({ close: scope.callerSessionId });
            jobs.set(scope.callerSessionId, []);
            for (const listener of [...listeners]) listener();
            return { failed: [] };
        },
    };
    const manager = {
        getSession: (id) => sessions.get(id),
        askSession: ask || (async (...args) => { calls.push(args); return { content: 'child result' }; }),
        enqueuePendingMessage: (...args) => { calls.push({ queue: args }); return 1; },
        updateSessionRoute: (...args) => { calls.push({ route: args }); return child; },
    };
    const bridge = createOrchestrationBridge({ config: { mode }, pendingMessages });
    const surface = bridge.surface({ mgr: manager, getAgentTool: () => tool });
    bridge.begin(callbacks); bridge.bind(lead);
    return { bridge, surface, lead, child, calls, sessions, jobs, listeners,
        changed() { for (const listener of [...listeners]) listener(); } };
}

test('managed agent/task still require approval and never permit cross-session scope', async () => {
    for (const mode of ['ask', 'review']) {
        const session = { id: 'lead', messages: [] };
        attachHostPolicy(session, { mode, orchestration: true });
        for (const name of ['agent', 'task']) {
            assert.equal((await session.beforeToolHook({ name, args: { type: 'spawn' } })).action, 'ask');
            assert.equal((await session.beforeToolHook({ name, args: { allTerminals: true } })).action, 'deny');
        }
        assert.equal((await session.beforeToolHook({ name: 'automation', args: {} })).action, mode === 'ask' ? 'ask' : 'deny');
    }
});

test('live job projection preserves native task ids, model and terminal states without prompts', () => {
    const f = fixture();
    f.jobs.set('lead', [{ task_id: 'task_1', sessionId: 'child', agent: 'worker', tag: 'review',
        provider: 'subscription', model: 'small', effort: 'low', status: 'completed',
        worker_stage: 'done', prompt: 'private prompt', result: 'private output' }]);
    const status = f.bridge.status();
    assert.equal(status[0].id, 'task_1');
    assert.equal(status[0].model, 'small');
    assert.equal(status[0].status, 'completed');
    assert.doesNotMatch(JSON.stringify(status), /private/);
    f.bridge.finish();
});

test('child approvals retain full arguments, identity and denials; usage and tool ids are scoped', async () => {
    const seen = [], results = [], usage = [], upstream = [];
    const f = fixture({
        callbacks: {
            onToolApproval: async (info) => { seen.push(info); return { approved: false }; },
            onToolResult: (result) => results.push(result),
            onUsageDelta: (value) => usage.push(value),
        },
        ask: async (id, text, context, planned, cwd, prefetch, hooks) => {
            assert.equal(id, 'child');
            assert.equal((await f.child.beforeToolHook({ name: 'read', args: {} })).action, 'ask');
            const answer = await hooks.onToolApproval({ sessionId: id, name: 'shell',
                args: { command: 'printf complete-command' }, reason: 'review' });
            assert.equal(answer.approved, false);
            hooks.onToolResult({ toolCallId: 'same', content: 'denied' });
            hooks.onUsageDelta({ deltaInput: 3 });
            return { content: 'done' };
        },
    });
    await f.surface.runTurn({ session: f.child, prompt: 'work',
        onToolResult: (result) => upstream.push(result) });
    assert.equal(seen[0].sessionId, 'lead');
    assert.equal(seen[0].childSessionId, 'child');
    assert.equal(seen[0].args.command, 'printf complete-command');
    assert.match(seen[0].reason, /worker/);
    assert.equal(results[0].toolCallId, 'child:same');
    assert.equal(upstream[0].toolCallId, 'same');
    assert.deepEqual(usage, [{ deltaInput: 3 }]);
    f.bridge.finish();
});

// 하위 도구의 관측·계획에는 출처를 붙이고 네이티브 원본과 부모 텍스트는 보존한다.
test('child observed and planned calls carry scoped identity without forwarding child prose', async () => {
    const observed = [], planned = [], nativeObserved = [], parentText = [], nativeText = [];
    const call = { id: 'same', name: 'read', args: { path: 'child.txt' } };
    const secondCall = { id: 'second', name: 'shell', args: { command: 'pwd' } };
    const nativeCalls = [call, secondCall];
    const f = fixture({
        callbacks: {
            onAssistantToolCallObserved: (value) => observed.push(value),
            onToolCall: (iteration, calls) => planned.push({ iteration, calls }),
            onTextDelta: (text) => parentText.push(text),
            onAssistantText: (text) => parentText.push(text),
        },
        ask: async (id, text, context, onToolCall, cwd, prefetch, hooks) => {
            hooks.onTextDelta('child delta');
            hooks.onAssistantToolCallObserved(call);
            onToolCall(3, nativeCalls);
            hooks.onAssistantText('child answer');
            return { content: 'child result' };
        },
    });
    await f.surface.runTurn({ session: f.child, prompt: 'work',
        onAssistantToolCallObserved: (value) => nativeObserved.push(value),
        onTextDelta: (text) => nativeText.push(text),
        onAssistantText: (text) => nativeText.push(text) });
    assert.equal(nativeObserved.length, 1);
    assert.strictEqual(nativeObserved[0], call);
    assert.deepEqual(call, { id: 'same', name: 'read', args: { path: 'child.txt' } });
    assert.deepEqual(secondCall, { id: 'second', name: 'shell', args: { command: 'pwd' } });
    assert.deepEqual(observed, [{ ...call, id: 'child:same', childSessionId: 'child' }]);
    assert.notStrictEqual(observed[0], call);
    assert.strictEqual(observed[0].args, call.args);
    assert.deepEqual(planned, [{ iteration: 3, calls: [
        { ...call, id: 'child:same', childSessionId: 'child' },
        { ...secondCall, id: 'child:second', childSessionId: 'child' },
    ] }]);
    assert.notStrictEqual(planned[0].calls, nativeCalls);
    for (const [index, forwarded] of planned[0].calls.entries()) {
        assert.notStrictEqual(forwarded, nativeCalls[index]);
        assert.strictEqual(forwarded.args, nativeCalls[index].args);
    }
    assert.deepEqual(nativeText, ['child delta', 'child answer']);
    assert.deepEqual(parentText, []);
    f.bridge.finish();
});

// 하위 에이전트도 부모가 선택한 Bypass를 상속한다.
test('bypass policy is inherited by child agents', async () => {
    const f = fixture({ mode: 'bypass' });
    await f.surface.runTurn({ session: f.child, prompt: 'work' });
    assert.equal((await f.child.beforeToolHook({ name: 'shell', args: { command: 'printf child' } })).action, 'rewrite');
    assert.equal((await f.child.beforeToolHook({ name: 'task', args: { global: true } })).action, 'deny');
    f.bridge.finish();
});

test('review policy is inherited by nested agents; foreign and cyclic ownership fail closed', async () => {
    const f = fixture({ mode: 'review' });
    const nested = { id: 'nested', parentSessionId: 'child', messages: [] };
    f.sessions.set('nested', nested);
    await f.surface.runTurn({ session: nested, prompt: 'review' });
    assert.equal((await nested.beforeToolHook({ name: 'shell', args: {} })).action, 'deny');
    for (const session of [
        { id: 'foreign', parentSessionId: 'other', messages: [] },
        { id: 'cycle', parentSessionId: 'cycle', messages: [] },
    ]) {
        f.sessions.set(session.id, session);
        await assert.rejects(f.surface.runTurn({ session, prompt: 'escape' }), /Foreign/);
    }
    f.bridge.finish();
});

test('parallel children keep distinct display ids and approvals', async () => {
    const ids = [];
    const f = fixture({
        callbacks: { onToolResult: (result) => ids.push(result.toolCallId) },
        ask: async (id, text, context, planned, cwd, prefetch, hooks) => {
            hooks.onToolResult({ toolCallId: 'collision' }); return { content: id };
        },
    });
    const second = { id: 'second', parentSessionId: 'lead', messages: [] };
    f.sessions.set(second.id, second);
    await Promise.all([f.child, second].map((session) => f.surface.runTurn({ session, prompt: 'work' })));
    assert.deepEqual(ids.sort(), ['child:collision', 'second:collision']);
    f.bridge.finish();
});

test('parent waits for queued jobs, drains native completions, and removes subscription', async () => {
    let pending = false, resumed = 0;
    const f = fixture({ pendingMessages: () => pending ? ['completion'] : [] });
    f.jobs.set('lead', [{ status: 'running' }]);
    const draining = f.bridge.drainLead(async () => { resumed++; pending = false; return 'final'; }, 'early');
    assert.equal(f.listeners.size, 1);
    pending = true;
    f.jobs.set('lead', []);
    f.changed();
    assert.equal(await draining, 'final');
    assert.equal(resumed, 1);
    assert.equal(f.listeners.size, 0);
    f.bridge.finish();
});

test('native no-op completion drain preserves the last real result', async () => {
    const f = fixture({ pendingMessages: () => ['already delivered ledger entry'] });
    const previous = { result: { content: 'final answer' } };
    assert.equal(await f.bridge.drainLead(async () => ({ result: undefined }), previous), previous);
    f.bridge.finish();
});

test('cancellation rejects waits and late approval, including nested owner cleanup', async () => {
    const approval = deferred(), reached = deferred();
    const f = fixture({
        callbacks: { onToolApproval: () => { reached.resolve(); return approval.promise; } },
        ask: async (id, text, context, planned, cwd, prefetch, hooks) =>
            hooks.onToolApproval({ sessionId: id, name: 'shell', args: { command: 'never' } }),
    });
    const child = f.surface.runTurn({ session: f.child, prompt: 'work' });
    const childRejected = assert.rejects(child, /no longer active/);
    await reached.promise;
    f.jobs.set('lead', [{ status: 'running' }]);
    const parentRejected = assert.rejects(f.bridge.drainLead(async () => {}, null), /interrupted/);
    await f.bridge.abort('stop');
    approval.resolve({ approved: true });
    await Promise.all([childRejected, parentRejected]);
    assert.deepEqual(f.calls, [{ close: 'child' }, { close: 'lead' }]);
    assert.equal(f.listeners.size, 0);
    f.bridge.finish();
});

test('same-tag queue and route changes use native APIs, no work is admitted after turn end', async () => {
    const f = fixture();
    assert.deepEqual(f.surface.enqueueTurn({ session: f.child, prompt: 'follow up' }), { queueDepth: 1 });
    f.surface.setRoute({ session: f.child, route: { model: 'selected' } });
    assert.deepEqual(f.calls[0], { queue: ['child', 'follow up'] });
    assert.equal(f.calls[1].route[1].model, 'selected');
    f.bridge.finish();
    await assert.rejects(f.surface.runTurn({ session: f.child, prompt: 'late' }), /no longer active/);
    assert.throws(() => f.surface.enqueueTurn({ session: f.child, prompt: 'late' }), /no longer active/);
});

test('agent patch rejects drift and partial patches, accepts only exact idempotent output', () => {
    for (const spec of AGENT_PATCHES) {
        const source = spec.edits.map(([before]) => before).join('\n');
        const fixtureSpec = { ...spec, blob: gitBlob(source) };
        const patched = patchedAgentSource(source, fixtureSpec);
        assert.equal(patchedAgentSource(patched, fixtureSpec), patched);
        assert.throws(() => patchedAgentSource(source + 'drift', fixtureSpec), /hash mismatch/);
        if (spec.edits.length > 1) {
            const previousCounts = (spec.previousEditCounts || [spec.previousEditCount]).filter(Boolean);
            const unsupportedEdit = previousCounts.includes(1) ? spec.edits[1] : spec.edits[0];
            assert.throws(() => patchedAgentSource(source.replace(...unsupportedEdit), fixtureSpec), /Partial/);
            for (const count of previousCounts) {
                const previous = spec.edits.slice(0, count).reduce((text, edit) => text.replace(...edit), source);
                assert.equal(patchedAgentSource(previous, fixtureSpec), patched);
            }
        }
    }
});

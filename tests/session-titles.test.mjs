import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { generateConversationTitle } from '../engine/src/session-title.mjs';
import { SESSION_TITLE_PATCHES, patchedSessionTitleSource, patchPaseoSessionTitles } from '../scripts/patch-paseo-session-titles.mjs';

const observerSource = stripTypeScriptTypes(readFileSync(new URL('../android/packages/server/src/server/conversation-titles.ts', import.meta.url), 'utf8'));
const { startConversationTitles, conversationTitleSource } = await import(
    `data:text/javascript;base64,${Buffer.from(observerSource).toString('base64')}`);

// 실제 이벤트 계약과 저장 출처를 메모리로 구성하며 모델은 호출하지 않는다.
function harness({ origin = 'provisional', workspaceOrigin = origin, generate = async () => ({ title: '사용량 자동 갱신·도넛 개선' }) } = {}) {
    let listener;
    let session = { title: 'https://github.com/example/widget', titleOrigin: origin };
    let workspace = { workspaceId: 'workspace', title: 'PaseoDog', titleOrigin: workspaceOrigin };
    const agent = { id: 'agent', provider: 'paseodog', workspaceId: 'workspace', lifecycle: 'idle' };
    const items = [
        { type: 'user_message', text: '이 위젯의 사용량 조회를 PaseoDog에 적용해줘' },
        { type: 'assistant_message', text: '코드를 확인할게.' },
        { type: 'tool_call', name: 'shell', detail: { text: 'secret output' } },
        { type: 'assistant_message', text: '사용량 자동 갱신과 도넛 표시를 구현했어.' },
    ];
    const calls = [], updates = [], warnings = [];
    const stop = startConversationTitles({
        agentManager: {
            subscribe(callback) { listener = callback; return () => { listener = null; }; },
            getAgent(id) { return { ...agent, id }; },
            getTimeline() { return items; },
            async setGeneratedTitle(_id, title, expected, isCurrent) {
                if (isCurrent() && session.title === expected && ['provisional', 'generated'].includes(session.titleOrigin))
                    session = { ...session, title, titleOrigin: 'generated' };
            },
        },
        agentStorage: { async get() { return session; } },
        workspaceRegistry: {
            async get() { return workspace; },
            async update(_id, apply) { workspace = apply(workspace); return workspace; },
        },
        async generateTitle(input) { calls.push(input); return generate(input); },
        async emitWorkspaceUpdate(id) { updates.push(id); },
        logger: { warn(...args) { warnings.push(args); } },
    });
    return {
        agent, items, calls, updates, warnings, stop,
        event(type, agentId = 'agent') { listener?.({ type: 'agent_stream', agentId, event: { type } }); },
        manualSession(title) { session = { ...session, title, titleOrigin: 'user' }; },
        manualWorkspace(title) { workspace = { ...workspace, title, titleOrigin: 'user' }; },
        archiveWorkspace() { workspace = { ...workspace, archivedAt: '2026-01-01' }; },
        get session() { return session; }, get workspace() { return workspace; },
    };
}

test('completed conversation updates session and sidebar, using the final answer rather than tool chatter', async () => {
    const h = harness();
    h.event('turn_started');
    assert.equal(h.calls.length, 0);
    h.event('turn_completed');
    await setImmediate();
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].provisional, true);
    assert.match(h.calls[0].conversation, /자동 갱신과 도넛/);
    assert.doesNotMatch(h.calls[0].conversation, /secret output|코드를 확인/);
    assert.equal(h.session.title, '사용량 자동 갱신·도넛 개선');
    assert.equal(h.workspace.title, h.session.title);
    assert.equal(h.workspace.titleOrigin, 'generated');
    h.stop();
});

test('manual, unknown legacy, and independently renamed titles are protected', async () => {
    for (const origin of ['user', undefined]) {
        const h = harness({ origin: origin ?? 'legacy' });
        h.event('turn_completed');
        await setImmediate();
        assert.equal(h.calls.length, 0);
        h.stop();
    }
    const h = harness({ origin: 'user', workspaceOrigin: 'provisional' });
    h.event('turn_completed');
    await setImmediate();
    assert.equal(h.session.title, 'https://github.com/example/widget');
    assert.equal(h.workspace.title, '사용량 자동 갱신·도넛 개선');
    h.stop();
});

test('manual renames, including the same visible title, win over pending generation', async () => {
    let resolve;
    const h = harness({ generate: () => new Promise((accept) => { resolve = accept; }) });
    h.event('turn_completed');
    await setImmediate();
    h.manualSession(h.session.title);
    h.manualWorkspace(h.workspace.title);
    resolve({ title: '오래된 자동 제목' });
    await setImmediate();
    assert.equal(h.session.titleOrigin, 'user');
    assert.equal(h.workspace.title, 'PaseoDog');
    assert.equal(h.updates.length, 0);
    h.stop();
});

test('new turns, cancellation, shutdown and archival reject late title results', async () => {
    for (const invalidate of [
        (h) => h.event('turn_started'), (h) => h.event('turn_canceled'), (h) => h.stop(),
    ]) {
        let resolve;
        const h = harness({ generate: () => new Promise((accept) => { resolve = accept; }) });
        h.event('turn_completed');
        await setImmediate();
        invalidate(h);
        resolve({ title: '오래된 자동 제목' });
        await setImmediate();
        assert.equal(h.workspace.title, 'PaseoDog');
        assert.equal(h.session.titleOrigin, 'provisional');
        h.stop();
    }
    let resolve;
    const h = harness({ generate: () => new Promise((accept) => { resolve = accept; }) });
    h.event('turn_completed');
    await setImmediate();
    h.archiveWorkspace();
    resolve({ title: '자동 제목' });
    await setImmediate();
    assert.equal(h.workspace.title, 'PaseoDog');
    assert.equal(h.workspace.archivedAt, '2026-01-01');
    h.stop();
});

test('unchanged goals keep the title and do not repeatedly publish workspace updates', async () => {
    const h = harness({ generate: async (input) => ({ title: input.provisional ? '사용량 자동 갱신' : input.currentTitle }) });
    h.event('turn_completed');
    await setImmediate();
    h.event('turn_completed');
    await setImmediate();
    assert.equal(h.calls[1].provisional, false);
    assert.equal(h.session.title, '사용량 자동 갱신');
    assert.equal(h.updates.length, 1);
    h.stop();
});

test('another session starting in the same workspace prevents an older completion renaming that workspace', async () => {
    let resolve;
    const h = harness({ generate: () => new Promise((accept) => { resolve = accept; }) });
    h.event('turn_completed');
    h.event('turn_started', 'another-session');
    await setImmediate();
    resolve({ title: '이전 세션의 작업 목표' });
    await setImmediate();
    assert.equal(h.workspace.title, 'PaseoDog');
    assert.equal(h.updates.length, 0);
    h.stop();
});

test('failed, malformed and other-provider results neither rename nor retry', async () => {
    for (const generate of [
        async () => { throw new Error('title unavailable'); },
        async () => ({ title: 'bad\ntitle' }), async () => ({ title: 'x'.repeat(33) }),
        async () => ({ title: null }),
    ]) {
        const h = harness({ generate });
        h.event('turn_failed');
        await setImmediate();
        assert.equal(h.calls.length, 0);
        h.event('turn_completed');
        await setImmediate();
        assert.equal(h.calls.length, 1);
        assert.equal(h.workspace.title, 'PaseoDog');
        h.stop();
    }
    const h = harness();
    h.agent.provider = 'codex';
    h.event('turn_completed');
    await setImmediate();
    assert.equal(h.calls.length, 0);
    h.stop();
});

test('conversation source bounds all input and excludes incomplete turns', () => {
    const rows = [];
    for (let index = 0; index < 10; index++) rows.push(
        { type: 'user_message', text: `${index} ${'u'.repeat(5000)}` },
        { type: 'assistant_message', text: 'a'.repeat(6000) });
    rows.push({ type: 'user_message', text: 'not answered yet' });
    const source = conversationTitleSource(rows);
    assert.ok(source.length <= 20000);
    assert.equal(source.match(/User:/g).length, 3);
    assert.doesNotMatch(source, /not answered yet|User: 0 /);
});

test('native title generation uses agreed-task instructions without changing its configured route', async () => {
    let calls = 0;
    const request = { currentTitle: '임시 제목', provisional: true, conversation: '사용량 자동 갱신을 구현해줘' };
    const result = await generateConversationTitle(request, {
        config: () => ({}),
        async generate(source, options) {
            calls++;
            assert.match(source, /Keep the current title EXACTLY/);
            assert.match(source, /not its opening line/);
            assert.match(source, /사용량 자동 갱신/);
            assert.ok(options.signal instanceof AbortSignal);
            return '"사용량 자동 갱신"';
        },
    });
    assert.deepEqual(result, { title: '사용량 자동 갱신' });
    assert.equal(calls, 1);
    assert.deepEqual(await generateConversationTitle(request, {
        config: () => ({ aiSessionTitles: false }), generate: () => { throw new Error('must not call'); },
    }), { title: null });
    await assert.rejects(generateConversationTitle({ ...request, conversation: 'x'.repeat(20001) }), /Invalid/);
});

test('native title timeout aborts the single request without retrying it', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let calls = 0, signal;
    const pending = generateConversationTitle({ currentTitle: '', provisional: true, conversation: '구체적인 작업' }, {
        config: () => ({}),
        generate(_source, options) {
            calls++;
            signal = options.signal;
            return new Promise(() => {});
        },
    });
    const rejected = assert.rejects(pending, /generation timed out/);
    t.mock.timers.tick(10000);
    await rejected;
    assert.equal(signal.aborted, true);
    assert.equal(calls, 1);
});

test('session-title daemon patch is exact-blob gated, idempotent and rejects partial patches', () => {
    const base = new URL('../tools/node_modules/@getpaseo/server/dist/server/server/', import.meta.url);
    for (const spec of SESSION_TITLE_PATCHES) {
        const installed = readFileSync(new URL(spec.file, base), 'utf8');
        const patched = patchedSessionTitleSource(installed, spec);
        let original = patched;
        for (const [before, after] of [...spec.edits].reverse()) original = original.replace(after, before);
        assert.notEqual(original, patched);
        assert.equal(patchedSessionTitleSource(original, spec), patched);
        assert.equal(patchedSessionTitleSource(patched, spec), patched);
        assert.throws(() => patchedSessionTitleSource(patched + '// drift', spec), /hash mismatch/);
        if (spec.edits.length > 1) {
            const [before, after] = spec.edits.at(-1);
            assert.throws(() => patchedSessionTitleSource(patched.replace(after, before), spec), /Partial/);
        }
    }
});

test('daemon patch validates all targets before writing and checks the installed observer', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'paseodog-session-titles-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    writeFileSync(join(root, 'package.json'), '{"version":"0.11.4"}');
    const base = new URL('../tools/node_modules/@getpaseo/server/dist/server/server/', import.meta.url);
    for (const spec of SESSION_TITLE_PATCHES) {
        let original = patchedSessionTitleSource(readFileSync(new URL(spec.file, base), 'utf8'), spec);
        for (const [before, after] of [...spec.edits].reverse()) original = original.replace(after, before);
        const path = join(root, 'dist/server/server', spec.file);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, original);
    }
    assert.throws(() => patchPaseoSessionTitles(root, { check: true }), /patch is missing/);
    patchPaseoSessionTitles(root);
    patchPaseoSessionTitles(root, { check: true });
    patchPaseoSessionTitles(root);
    writeFileSync(join(root, 'dist/server/server/conversation-titles.js'), 'unexpected');
    assert.throws(() => patchPaseoSessionTitles(root), /observer source drift/);
});

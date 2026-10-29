import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { Script } from 'node:vm';
import { COMPOSER_FILE, patchedComposerSource } from '../scripts/patch-paseo-composer.mjs';
import { composerFixture } from './composer-fixture.mjs';
import { WORK_RECORD_EDITS, withWorkRecords, withoutWorkRecords } from '../patches/paseo-work-records.mjs';
import { ASSISTANT_PHASE_PATCHES, patchedAssistantPhaseSource } from '../scripts/patch-paseo-assistant-phase.mjs';
import { RELAY_PASSWORD_PATCHES } from '../scripts/patch-paseo-relay-password.mjs';

// 공용 원본에서 타입만 지워 웹·모바일에서 같은 묶음·렌더러 계약을 검사한다.
function loadFunction(file, name) {
    const code = stripTypeScriptTypes(readFileSync(new URL('../android/packages/app/src/agent-stream/' + file, import.meta.url), 'utf8'))
        .replace(/^export /gm, '');
    return new Function(`${code}\nreturn ${name};`)();
}
const project = loadFunction('work-record-model.ts', 'projectWorkRecords');
const createRenderer = loadFunction('work-record-renderer.ts', 'createWorkRecordRenderer');
const getRecordGap = loadFunction('work-record-model.ts', 'getWorkRecordGap');
const at = new Date('2026-10-21T00:00:00Z');

// 명시 메타데이터와 기존 메시지 경계만 갖는 최소 타임라인을 만든다.
function assistant(id, text, assistantPhase, turnId = 'turn') {
    return { kind: 'assistant_message', id, text, assistantPhase, turnId, timestamp: at };
}
const user = { kind: 'user_message', id: 'user', text: '요청', turnId: 'turn', timestamp: at };
const thought = { kind: 'thought', id: 'thought', text: '추론 내용', status: 'ready', turnId: 'turn', timestamp: at };

test('same-turn user admissions retain separate records attached to the preceding request', () => {
    const progress = assistant('progress', '검증 중', 'commentary');
    const next = { ...user, id: 'proceed', text: '좋아 다 진행해' };
    const installing = assistant('installing', '설치할게', 'commentary');
    const result = project({ tail: [user, progress, next], head: [installing] }, true);
    assert.deepEqual(result.tail[1].items, [progress]);
    assert.deepEqual(result.head[0].items, [installing]);
    assert.equal(result.tail[1].active, false);
    assert.equal(result.head[0].active, true);
    assert.notEqual(result.tail[1].id, result.head[0].id);
    assert.equal(getRecordGap(user, result.tail[1]), 8);
    assert.equal(getRecordGap(result.tail[1], next), 24);
    assert.equal(getRecordGap(next, result.head[0]), 8);
    assert.equal(getRecordGap(next, null), null);
});

test('A projection collapses reasoning and commentary, retaining all final Markdown blocks with one heading', () => {
    const progress = assistant('progress', '작업 안내', 'commentary');
    const blocks = [0, 1].map((blockIndex) => ({ ...assistant('final:' + blockIndex, '답변 ' + blockIndex, 'final_answer'),
        blockGroupId: 'final', blockIndex }));
    const tail = [user, thought, progress, ...blocks];
    const before = JSON.stringify(tail);
    const result = project({ tail, head: [] }, false);
    assert.equal(result.tail[1].kind, 'work_record');
    assert.deepEqual(result.tail[1].items, [thought, progress]);
    assert.equal(result.tail[1].count, 2);
    assert.equal(result.tail[2].answerStart, true);
    assert.equal(result.tail[3].answerStart, undefined);
    assert.deepEqual(result.tail.slice(2).map((item) => item.text), ['답변 0', '답변 1']);
    assert.equal(JSON.stringify(tail), before);
});

test('working previews never expose reasoning and explicit final output can stream separately', () => {
    const tail = [user, thought, assistant('progress', '파일 검사 중', 'commentary')];
    const first = project({ tail, head: [] }, true);
    assert.equal(first.tail[1].preview, '파일 검사 중');
    assert.equal(first.tail[1].active, true);
    const second = project({ tail, head: [assistant('final', '답변 시작', 'final_answer')] }, true);
    assert.equal(second.head[0].answerStart, true);
    assert.equal(second.tail[1].preview, '파일 검사 중');
    assert.equal(project({ tail: [user, thought], head: [] }, true).tail[1].preview, '');
});

test('warnings, failures, cancellation, plugins and users never disappear inside a collapsed record', () => {
    const failed = { kind: 'tool_call', id: 'bad', turnId: 'turn', timestamp: at,
        payload: { source: 'agent', data: { status: 'failed' } } };
    const canceled = { ...failed, id: 'blocked', payload: { source: 'agent', data: { status: 'canceled' } } };
    const warning = { kind: 'notification', id: 'warning', level: 'warning', turnId: 'turn', timestamp: at };
    const plugin = { kind: 'plugin', id: 'plugin', turnId: 'turn', timestamp: at };
    const result = project({ tail: [user, thought, failed, canceled, warning, plugin], head: [] }, false);
    assert.deepEqual(result.tail.filter((item) => item.kind !== 'work_record'), [user, failed, canceled, warning, plugin]);
});

test('legacy messages use existing completed-turn boundaries without guessing paragraph meanings', () => {
    const first = assistant('one', '이전 안내');
    const last = assistant('two', '문단 하나\n\n문단 둘');
    const result = project({ tail: [user, first, last], head: [] }, false);
    assert.deepEqual(result.tail[1].items, [first]);
    assert.equal(result.tail[2].text, last.text);
    assert.equal(result.tail[2].answerStart, true);
    // 진행 중에도 도구가 뒤따르지 않은 마지막 본문은 답변 자리에 바로 흐른다
    const live = project({ tail: [user, last], head: [] }, true);
    assert.equal(live.tail[1].answerStart, true);
    assert.equal(project({ tail: [user, first, last], head: [] }, true).tail[1].items[0], first);
});

test('native final continuations retain every final part rather than discarding a partial code block', () => {
    const result = project({ tail: [user, assistant('f1', '```js\nconst a = ', 'final_answer'),
        assistant('f2', '1;\n```', 'final_answer')], head: [] }, false);
    assert.deepEqual(result.tail.filter((item) => item.kind === 'assistant_message').map((item) => item.text),
        ['```js\nconst a = ', '1;\n```']);
    assert.equal(result.tail.filter((item) => item.answerStart).length, 1);
});

test('unchanged history records retain identity across live final deltas and cache entries are bounded', () => {
    const cache = { records: new Map(), answers: new WeakMap() };
    const tail = [user, thought, assistant('p', '진행', 'commentary')];
    const first = project({ tail, head: [assistant('f', '답', 'final_answer')] }, true, cache);
    const second = project({ tail, head: [assistant('f', '답변', 'final_answer')] }, true, cache);
    assert.equal(first.tail, second.tail);
    assert.equal(first.tail[1], second.tail[1]);
    project({ tail: [], head: [] }, false, cache);
    assert.equal(cache.records.size, 0);
});

test('the existing hide-reasoning preference suppresses work records without hiding answers or warnings', () => {
    const warning = { kind: 'notification', id: 'warning', level: 'warning', turnId: 'turn', timestamp: at };
    const result = project({ tail: [user, thought, assistant('p', '진행', 'commentary'),
        assistant('f', '답변', 'final_answer'), warning], head: [] }, false, undefined, true);
    assert.equal(result.tail.some((item) => item.kind === 'work_record'), false);
    assert.deepEqual(result.tail.map((item) => item.id), ['user', 'f', 'warning']);
    assert.equal(result.tail[1].answerStart, true);
    const live = project({ tail: [user, assistant('streaming', '아직 작성 중', 'final_answer')], head: [] }, true, undefined, true);
    assert.deepEqual(live.tail, [user]);
});

test('work record renderer is collapsed by default, expands on press and collapses after completion', async () => {
    const req = createRequire(new URL('../plugin/package.json', import.meta.url));
    const React = req('react');
    const { create, act } = req('react-test-renderer');
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const theme = { colors: { surface1: '#f5f5f5', border: '#ddd', foregroundMuted: '#777', foreground: '#111' },
        borderRadius: { md: 6 }, spacing: { 1: 4, 2: 8 }, fontSize: { sm: 12 } };
    let icon = '';
    let photo = '';
    const render = createRenderer({ React, View: 'view', Text: 'text', Image: 'image', Pressable: 'pressable',
        StyleSheet: { create: (make) => make(theme) },
        useAssistantNickname: () => 'Dog',
        useAssistantIcon: () => icon,
        useAssistantPhoto: () => photo,
        useTranslation: () => ({ i18n: { language: 'ko' } }) });
    const record = project({ tail: [user, thought, assistant('p', '진행', 'commentary')], head: [] }, true).tail[1];
    const row = { item: record, phase: 'complete' };
    const body = (layout) => React.createElement('body', { id: layout.item.id }, layout.item.text);
    let tree;
    const button = (testID) => tree.root.findAll((node) => node.type === 'pressable' && node.props.testID === testID);
    await act(async () => { tree = create(render(row, body)); });
    assert.equal(tree.root.findAllByType('body').length, 0);
    assert.equal(button('assistant-work-record-toggle')[0].props.accessibilityState.expanded, false);
    const preview = tree.root.findAll((node) => node.type === 'text' && node.props.numberOfLines === 1)[0];
    assert.ok(button('assistant-work-record-toggle')[0].findAllByType('text').includes(preview));
    assert.equal(button('assistant-work-record-collapse').length, 0);
    await act(async () => button('assistant-work-record-toggle')[0].props.onPress());
    assert.deepEqual(tree.root.findAllByType('body').map((node) => node.props.id), ['thought', 'p']);
    assert.equal(button('assistant-work-record-toggle')[0].findAllByType('body').length, 0);
    // 펼친 기록 맨 아래의 접기 버튼도 기록을 접는다.
    const [collapse] = button('assistant-work-record-collapse');
    assert.deepEqual(collapse.findAllByType('text').map((node) => node.props.children), ['⌃', '접기']);
    await act(async () => collapse.props.onPress());
    assert.equal(tree.root.findAllByType('body').length, 0);
    assert.equal(button('assistant-work-record-collapse').length, 0);
    await act(async () => button('assistant-work-record-toggle')[0].props.onPress());
    await act(async () => tree.update(render({ ...row, item: { ...record, active: false } }, body)));
    assert.equal(tree.root.findAllByType('body').length, 0);
    // 기본 답변 제목은 공급자 이름 대신 Dog다.
    let answer;
    await act(async () => { answer = create(render({ item: { kind: 'assistant_message', id: 'a', text: '본문', answerStart: true } }, body)); });
    assert.equal(answer.root.findAll((node) => node.type === 'text' && node.props.accessibilityRole === 'header')[0].props.children, 'Dog');
    const avatar = () => answer.root.find((node) => node.type === 'text' && node.props.testID === 'assistant-avatar-icon').props.children;
    assert.equal(avatar(), 'D');
    icon = '🤖';
    await act(async () => answer.update(render({ item: { kind: 'assistant_message', id: 'a', text: '본문', answerStart: true } }, body)));
    assert.equal(avatar(), '🤖');
    assert.equal(answer.root.findAllByType('body')[0].props.children, '본문');
    photo = 'data:image/jpeg;base64,/9j/2Q==';
    await act(async () => answer.update(render({ item: { kind: 'assistant_message', id: 'a', text: '본문', answerStart: true } }, body)));
    const image = answer.root.findByType('image');
    assert.equal(image.props.source.uri, photo);
    assert.equal(answer.root.findAll((node) => node.props.testID === 'assistant-avatar-icon').length, 0);
    await act(async () => image.props.onError());
    assert.equal(avatar(), '🤖');
    photo = 'data:image/jpeg;base64,/9j/AAAA/9k=';
    await act(async () => answer.update(render({ item: { kind: 'assistant_message', id: 'a', text: '본문', answerStart: true } }, body)));
    assert.equal(answer.root.findByType('image').props.source.uri, photo);
    photo = '';
    icon = '';
    await act(async () => answer.update(render({ item: { kind: 'assistant_message', id: 'a', text: '본문', answerStart: true } }, body)));
    assert.equal(avatar(), 'D');
    const answerContainer = answer.root.find((node) => node.type === 'view' && node.props.testID === 'assistant-answer');
    assert.deepEqual(answerContainer.props.style.paddingLeft, { xs: 0, md: 40 });
    await act(async () => answer.unmount());
    await act(async () => tree.unmount());
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

for (const surface of ['app', 'web']) test(`${surface}: recoverable interruptions offer one explicit continue request`, async () => {
    const req = createRequire(new URL('../plugin/package.json', import.meta.url));
    const React = req('react');
    const { create, act } = req('react-test-renderer');
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const theme = { colors: { surface1: '#f5f5f5', border: '#ddd', foregroundMuted: '#777', foreground: '#111', accent: '#20f', accentForeground: '#fff' },
        borderRadius: { md: 6 }, spacing: { 1: 4, 2: 8, 3: 12 }, fontSize: { sm: 12 } };
    const sent = [];
    let fail = false;
    const client = { sendAgentMessage: async (agentId, text, options) => { sent.push([agentId, text, options]); if (fail) throw new Error('offline'); } };
    const deps = { React, View: 'view', Text: 'text', Image: 'image', Pressable: 'pressable',
        StyleSheet: { create: (make) => make(theme) }, useTranslation: () => ({ i18n: { language: 'ko' } }),
        useAssistantNickname: () => 'Dog', useAssistantIcon: () => '', useAssistantPhoto: () => '', getClient: (serverId) => (serverId === 'srv' ? client : null) };
    let render;
    if (surface === 'app') render = createRenderer(deps);
    else {
        // 실제 웹 주입문을 독립 실행해 모듈 바깥 값에 의존하지 않는지 함께 검사한다.
        const code = WORK_RECORD_EDITS.find(([before]) => before.startsWith('function ae('))[1];
        const prefix = code.slice(0, code.indexOf('function ae('));
        render = new Function('h', 'f', 'l', 'y', 'F', 'k', prefix + ';return pdRenderWorkRecord;')(
            React, { withUnistyles: component => component, StyleSheet: deps.StyleSheet }, deps,
            { useTranslation: deps.useTranslation },
            { useSettings: selector => selector({ assistantNickname: 'Dog', assistantIcon: '', assistantPhoto: '' }) },
            { useSessionStore: { getState: () => ({ sessions: { srv: { client } } }) } },
        );
    }
    const body = (layout) => React.createElement('body', { id: layout.item.id }, layout.item.text);
    const error = { kind: 'assistant_message', id: 'e', text: '[System Error] Provider connection closed', answerStart: true };
    const session = { serverId: 'srv', agentId: 'agent-1' };
    const button = (tree) => tree.root.findAll((node) => node.type === 'pressable' && node.props.testID === 'assistant-resume-after-disconnect');
    let tree;
    const recoverableMessages = [
        'Provider connection closed',
        'Responses websocket connection limit reached (60 minutes). Create a new websocket connection to continue.',
        'Cursor connection timed out',
        'Cursor request timed out',
        'Cursor stream ended before turnEnded',
        'Cursor stream closed before its end frame',
        'terminated', 'socket hang up', 'other side closed', 'Connection error.',
        'fetch failed', 'Failed to fetch', "Couldn't fetch.", 'Load failed', 'Network Error',
        'Connection to the provider was lost.',
        'Connection to the provider was lost (ECONNRESET).',
        'Could not reach the provider (EAI_AGAIN).',
        'The provider did not respond in time (ETIMEDOUT).',
        'Provider is temporarily unavailable (503).',
        'OpenAI OAuth WS closed before response.completed (code=1006)',
        'OpenAI WS handshake closed before open (code=1012, reason=service restart)',
        'xAI WS closed before response.completed (code=1011, reason=internal error)',
        'Provider connection closed\n\ncode: ECONNRESET\n\nConnection diagnostic',
    ];
    for (const message of recoverableMessages) {
        const item = { ...error, text: `[System Error] ${message}` };
        await act(async () => { tree = create(render({ item, belowItem: null, phase: 'complete' }, body, session)); });
        assert.equal(button(tree).length, 1, message);
        await act(async () => tree.unmount());
        // 과거 턴·진행 중·읽기 전용에서는 복구 버튼을 표시하지 않는다.
        for (const [row, target] of [
            [{ item, belowItem: { kind: 'user_message' }, phase: 'complete' }, session],
            [{ item, belowItem: null, phase: 'streaming' }, session],
            [{ item, belowItem: null, phase: 'complete' }, undefined],
        ]) {
            await act(async () => { tree = create(render(row, body, target)); });
            assert.equal(button(tree).length, 0, message);
            await act(async () => tree.unmount());
        }
    }
    const nonRecoverableMessages = [
        '[System Error] Usage limit',
        '[System Error] Quota exceeded. Check your plan and billing details.',
        '[System Error] Invalid API key',
        '[System Error] Permission denied',
        '[System Error] content_filter',
        '[System Error] Context window exceeded',
        '[System Error] User interrupted',
        '[System Error] Approval timed out; no action was authorized',
        '[System Error] Journal persistence failed; execution outcome is uncertain',
        '[System Error] Provider TLS certificate check failed (CERT_HAS_EXPIRED).',
        '[System Error] OpenAI OAuth WS closed before response.completed (code=1008, reason=policy violation)',
        '[System Error] OpenAI OAuth WS closed before response.completed (code=4401, reason=unauthorized)',
        '[System Error] Unknown error\n\ncode: ECONNRESET\n\nProvider connection closed',
        '[System Error] Permission denied: fetch failed',
        '[System Error] A shell job terminated by signal',
        'Provider connection closed',
        'Example: [System Error] Provider connection closed',
        '[System Error] Provider connection closed; review partial file changes before retrying',
    ];
    for (const text of nonRecoverableMessages) {
        await act(async () => { tree = create(render({ item: { ...error, text }, belowItem: null, phase: 'complete' }, body, session)); });
        assert.equal(button(tree).length, 0);
        await act(async () => tree.unmount());
    }
    assert.equal(sent.length, 0, 'rendering errors never sends a continuation automatically');
    await act(async () => { tree = create(render({ item: error, belowItem: null, phase: 'complete' }, body, session)); });
    const [resume] = button(tree);
    assert.deepEqual(resume.findAllByType('text').map((node) => node.props.children), ['이어서 진행하기']);
    await act(async () => resume.props.onPress());
    await act(async () => button(tree)[0].props.onPress());
    // 누를 때 한 번만 새 메시지로 보내고, 응답을 기다리는 동안 다시 보내지 않는다.
    assert.equal(sent.length, 1);
    assert.equal(sent[0][0], 'agent-1');
    assert.equal(sent[0][1], '이어서 진행');
    assert.match(sent[0][2].messageId, /^msg_\d+_/);
    assert.equal(button(tree)[0].props.disabled, true);
    await act(async () => tree.unmount());
    // 전송이 실패하면 자동 재전송 없이 다시 누를 수 있게만 돌아온다.
    fail = true;
    await act(async () => { tree = create(render({ item: error, belowItem: null, phase: 'complete' }, body, session)); });
    await act(async () => button(tree)[0].props.onPress());
    assert.equal(sent.length, 2);
    assert.equal(button(tree)[0].props.disabled, false);
    await act(async () => tree.unmount());
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

test('reviewed web bundle supports the same A renderer and rejects partial patches or drift', () => {
    const source = readFileSync(new URL('../tools/node_modules/@getpaseo/server/' + COMPOSER_FILE, import.meta.url), 'utf8');
    const patched = composerFixture(source);
    new Script(patched);
    assert.equal(composerFixture(patched), patched);
    assert.equal(withWorkRecords(withoutWorkRecords(patched)), patched);
    const [before, after] = WORK_RECORD_EDITS[0];
    assert.throws(() => patchedComposerSource(patched.replace(after, before)), /Partial/);
    assert.throws(() => patchedComposerSource(patched + '// drift'), /hash mismatch/);
    // 검토하지 않은 렌더러 주입본은 교체하지 않는다.
    assert.throws(() => withoutWorkRecords(patched.replace('collapse: "접기"', 'collapse: "닫기"')), /legacy renderer drift/);
    // 실제 번들의 append 경로에서 단계만 늦게 바뀌어도 본문은 중복되지 않는다.
    const code = WORK_RECORD_EDITS.find(([text]) => text.startsWith('function A('))[1];
    const append = new Function('S', 'p', code + ';return A;')(
        (text) => ({ chunk: text, hasContent: Boolean(text.trim()) }), (_state, id) => id);
    const first = append([], '본문', at, 'live', 'm', undefined, undefined, undefined);
    const late = append(first, '', at, 'live', 'm', undefined, undefined, 'final_answer');
    assert.equal(late.length, 1);
    assert.equal(late[0].text, '본문');
    assert.equal(late[0].assistantPhase, 'final_answer');
});

test('all phase transport patches are exact-blob gated and idempotent', () => {
    for (const spec of ASSISTANT_PHASE_PATCHES) {
        const installed = readFileSync(new URL('../' + spec.root + '/' + spec.file, import.meta.url), 'utf8');
        const patched = patchedAssistantPhaseSource(installed, spec);
        assert.equal(patchedAssistantPhaseSource(patched, spec), patched);
        assert.throws(() => patchedAssistantPhaseSource(patched + '// drift', spec), /hash mismatch/);
    }
});

test('phase reapplication preserves relay fields and rejects partial relay patches', async () => {
    const { withoutAssistantPhase } = await import('../patches/paseo-assistant-phase.mjs');
    const { withoutRelayPasswordEdits, patchedRelayPasswordSource } = await import('../scripts/patch-paseo-relay-password.mjs');
    const spec = ASSISTANT_PHASE_PATCHES.find(entry => entry.root === 'tools/node_modules/@getpaseo/protocol');
    const relay = RELAY_PASSWORD_PATCHES.find(entry => entry.package === 'protocol');
    const installed = readFileSync(new URL('../' + spec.root + '/' + spec.file, import.meta.url), 'utf8');
    const original = withoutRelayPasswordEdits(withoutAssistantPhase(installed, spec.edits), relay.edits);
    const phase = patchedAssistantPhaseSource(original, spec);
    const combined = patchedRelayPasswordSource(phase, relay);
    assert.equal(patchedAssistantPhaseSource(combined, spec), combined);
    assert.equal(patchedAssistantPhaseSource(withoutAssistantPhase(combined, spec.edits), spec), combined);
    const partial = phase.replace(relay.edits[0][0], () => relay.edits[0][1]);
    assert.throws(() => patchedAssistantPhaseSource(partial, spec), /Partial Paseo relay password patch/);
    assert.throws(() => patchedAssistantPhaseSource(combined + '\n// drift', spec), /hash mismatch/);
});

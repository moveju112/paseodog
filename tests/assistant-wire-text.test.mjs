import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { serveWorker } from '../engine/src/worker.mjs';
import { createJsonLineDecoder, encodeFrame } from '../plugin/server/json-lines.mjs';
import { MAX_FRAME } from '../plugin/server/util.mjs';
import { until } from './helpers.mjs';

// 기존 메모리 JSONL 하네스처럼 worker 입출력을 연결하고 테스트 종료 시 닫는다.
async function workerHarness(t, ask) {
    const input = new PassThrough(), output = new PassThrough(), frames = [];
    const decoder = createJsonLineDecoder((frame) => frames.push(frame), (error) => { throw error; });
    output.on('data', (chunk) => decoder.write(chunk));
    const server = serveWorker({ input, output, engineFactory: async () => ({
        id: 'sess_text', ask, abort() {}, close() {},
    }), closeMs: 100 });
    t.after(() => server.stop('test'));
    // RPC 요청 -> 실제 프레임 인코더와 디코더를 거쳐 해당 응답을 기다린다.
    const request = async (id, op) => {
        input.write(encodeFrame({ v: 1, id, op, args: { text: 'test' } }));
        return until(frames, (frame) => frame.id === id);
    };
    assert.equal((await request('open', 'open')).ok, true);
    return { frames, request };
}

// 텍스트 파트만 줄바꿈으로 합치고 이미지·도구 메타데이터는 응답에 섞지 않는다.
test('assistant snapshots and wrapped results normalize native text parts', async (t) => {
    const parts = [
        { type: 'text', text: 'first' },
        { type: 'image', data: 'PRIVATE_IMAGE' },
        { type: 'tool_use', text: 'PRIVATE_TOOL' },
        { type: 'text', text: '둘째\n"quoted"' },
    ];
    const expected = 'first\n둘째\n"quoted"';
    const h = await workerHarness(t, async (_text, callbacks) => {
        callbacks.onTextDelta(expected);
        callbacks.onAssistantText(parts);
        return { result: { content: parts, stopReason: 'end', terminationReason: 'complete' } };
    });
    const reply = await h.request('ask', 'ask');
    assert.equal(reply.ok, true);
    assert.deepEqual(h.frames.find((frame) => frame.event === 'onAssistantText').payload, [expected]);
    assert.deepEqual(reply.value.result, { content: expected, stopReason: 'end', terminationReason: 'complete' });
    assert.doesNotMatch(JSON.stringify(h.frames), /PRIVATE_IMAGE|PRIVATE_TOOL/);
});

// 자식 도구 출처는 감지·확정 배치 모두 JSONL을 통과하고 부모 도구에는 붙지 않는다.
test('tool projections preserve child provenance on observed and confirmed callbacks', async (t) => {
    const child = { id: 'child:read', name: 'read', childSessionId: 'child', args: { path: 'example' } };
    const parent = { id: 'parent', name: 'read', args: { path: 'example' } };
    const h = await workerHarness(t, async (_text, callbacks) => {
        callbacks.onAssistantToolCallObserved(child);
        callbacks.onAssistantToolCallObserved(parent);
        callbacks.onToolCall(1, [child, parent]);
        return { content: 'done' };
    });
    assert.equal((await h.request('ask', 'ask')).ok, true);
    const observed = h.frames.filter((frame) => frame.event === 'onAssistantToolCallObserved');
    const planned = h.frames.find((frame) => frame.event === 'onToolCall').payload[1];
    assert.equal(observed[0].payload[0].childSessionId, 'child');
    assert.equal(planned[0].childSessionId, 'child');
    assert.equal(planned[0].id, child.id);
    assert.equal(Object.hasOwn(observed[1].payload[0], 'childSessionId'), false);
    assert.equal(Object.hasOwn(planned[1], 'childSessionId'), false);
});

// 이전 256 KiB 경계를 넘는 문자열도 스트림·스냅샷·최종 응답이 정확히 일치한다.
test('assistant text above the old preview cap remains identical to streamed text', async (t) => {
    const expected = 'exact\n'.repeat(60 * 1024);
    const h = await workerHarness(t, async (_text, callbacks) => {
        callbacks.onTextDelta(expected);
        callbacks.onAssistantText(expected);
        return { content: expected };
    });
    const reply = await h.request('ask', 'ask');
    assert.equal(reply.ok, true);
    assert.equal(h.frames.filter((frame) => frame.event === 'onTextDelta').map((frame) => frame.payload[0]).join(''), expected);
    assert.equal(h.frames.find((frame) => frame.event === 'onAssistantText').payload[0], expected);
    assert.equal(reply.value.result.content, expected);
});

// 브리지의 UTF-16 문자 한도와 동일하게 다국어 1 MiB 경계까지 원문을 보존한다.
test('assistant text at the bridge character limit survives UTF-8 JSONL framing', async (t) => {
    const expected = '한'.repeat(1024 * 1024);
    const h = await workerHarness(t, async (_text, callbacks) => {
        callbacks.onAssistantText(expected);
        return { content: expected };
    });
    const reply = await h.request('ask', 'ask');
    assert.equal(reply.ok, true);
    assert.equal(h.frames.find((frame) => frame.event === 'onAssistantText').payload[0], expected);
    assert.equal(reply.value.result.content, expected);
});

// JSON에서 최대 여섯 바이트로 이스케이프되는 문자도 단일 프레임 한도 안에서 보존한다.
test('maximally escaped assistant text fits existing JSONL frame limits', async (t) => {
    const expected = '\u0000'.repeat(1024 * 1024);
    for (const snapshot of [true, false]) {
        const h = await workerHarness(t, async (_text, callbacks) => {
            if (snapshot) callbacks.onAssistantText(expected);
            return { content: snapshot ? '' : expected };
        });
        const reply = await h.request('ask', 'ask');
        assert.equal(reply.ok, true);
        const frame = snapshot ? h.frames.find((item) => item.event === 'onAssistantText') : reply;
        assert.equal(snapshot ? frame.payload[0] : frame.value.result.content, expected);
        assert.ok(Buffer.byteLength(encodeFrame(frame)) < MAX_FRAME);
    }
    assert.throws(() => encodeFrame({ content: '\u0000'.repeat(3 * 1024 * 1024) }), /IPC frame exceeds size limit/);
});

// 스냅샷·최종 응답의 한도 초과는 잘린 성공 응답 대신 명시적 오류로 거부한다.
test('oversized assistant snapshots and results fail without fabricated preview text', async (t) => {
    for (const snapshot of [true, false]) {
        const h = await workerHarness(t, async (_text, callbacks) => {
            const content = [{ type: 'text', text: 'x'.repeat(1024 * 1024 + 1) }];
            if (snapshot) callbacks.onAssistantText(content);
            return { content };
        });
        const reply = await h.request('ask', 'ask');
        assert.equal(reply.ok, false);
        assert.equal(reply.error, 'Assistant output exceeds bridge safety limit');
        assert.equal(h.frames.some((frame) => frame.event === 'onAssistantText'), false);
        assert.doesNotMatch(JSON.stringify(h.frames), /UI preview truncated/);
    }
});

// 지원하지 않는 응답 객체와 누락된 content는 JSON 문자열 대신 빈 텍스트가 된다.
test('non-text assistant values normalize to empty text', async (t) => {
    for (const content of [undefined, null, { text: 'not a native text part array' }, [{ type: 'image', data: 'private' }]]) {
        const h = await workerHarness(t, async (_text, callbacks) => {
            callbacks.onAssistantText(content);
            return { content };
        });
        const reply = await h.request('ask', 'ask');
        assert.equal(reply.ok, true);
        assert.equal(reply.value.result.content, '');
        assert.deepEqual(h.frames.find((frame) => frame.event === 'onAssistantText').payload, ['']);
    }
});

// 도구 결과는 계속 제한된 미리보기로 보내고 과대 승인 인자는 네이티브 실행 전에 거부한다.
test('assistant normalization preserves tool previews and approval safety limits', async (t) => {
    let decision;
    const h = await workerHarness(t, async (_text, callbacks) => {
        callbacks.onToolResult({ toolCallId: 'tool', content: 'x'.repeat(3 * 1024 * 1024) });
        decision = await callbacks.onToolApproval({ name: 'shell', args: { command: 'x'.repeat(128 * 1024) } });
        return { content: 'done' };
    });
    assert.equal((await h.request('ask', 'ask')).ok, true);
    const preview = h.frames.find((frame) => frame.event === 'onToolResult').payload[0].content;
    assert.equal(preview, `${'x'.repeat(16 * 1024)}\n[UI preview truncated; original retained by Mixdog]`);
    assert.deepEqual(decision, { approved: false, reason: 'Approval arguments exceed UI safety limit' });
    assert.equal(h.frames.some((frame) => frame.event === 'permission'), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { PluginAgentClientRegistry } from '../tools/node_modules/@getpaseo/server/dist/server/server/agent/plugin-provider.js';
import { TimelineProjection } from '../tools/node_modules/@getpaseo/server/dist/server/server/agent/timeline-projection.js';
import { fixture, until } from './helpers.mjs';

// 가짜 엔진의 실제 어댑터 이벤트를 설치된 SDK 세션과 타임라인 투영까지 전달한다.
async function projectedFixture(t, scenario, expectedTerminal = 'turn_completed') {
    const adapter = fixture({
        // 모델 호출 없이 콜백 순서만 재현한다.
        async ask(_text, callbacks) {
            return scenario(callbacks, adapter);
        },
    });
    const registry = new PluginAgentClientRegistry({
        // 종료 오류를 숨기지 않고 테스트 실패로 드러낸다.
        warn(details, message) {
            assert.fail(`${message}: ${details.err}`);
        },
    });
    t.after(() => registry.shutdown());
    registry.replace([{
        id: 'paseodog',
        label: 'Fixture only, not live acceptance',
        // 실제 ProviderConnection을 공개 SDK 등록 API에 연결한다.
        async connect() {
            return adapter.connection;
        },
    }]);
    const session = await registry.clients().paseodog.createSession({
        cwd: '/work',
        mcpServers: {},
        model: 'mixdog-default',
    });
    const translated = [];
    const projection = new TimelineProjection();
    let sequence = 0;
    // PluginAgentSession이 변환한 델타만 순서대로 실제 투영에 넣는다.
    session.subscribe((event) => {
        translated.push(event);
        if (event.type === 'timeline') {
            projection.append({
                seq: ++sequence,
                item: event.item,
                turnId: event.turnId,
                timestamp: event.timestamp ?? '2026-01-01T00:00:00.000Z',
            });
        }
    });
    await session.startTurn('fixture ordering only');
    await until(translated, (event) =>
        ['turn_completed', 'turn_failed', 'turn_canceled'].includes(event.type));
    assert.equal(translated.at(-1).type, expectedTerminal);
    return projection.getRows().map((row) => row.item)
        .filter((item) => ['assistant_message', 'tool_call'].includes(item.type));
}

for (const boundary of ['canonical parent', 'turn finish', 'child batch']) {
    // 조기 감지·결과·자식 배치가 단어 중간에 도착해도 확정 경계 전 본문은 하나로 유지한다.
    test(`fixture SDK projection preserves Korean word across eager tools: ${boundary}`, async (t) => {
        const items = await projectedFixture(t, async (callbacks, adapter) => {
            const call = {
                id: 'read-fixture',
                name: 'read',
                ...(boundary === 'child batch' ? { childSessionId: 'child-fixture' } : {}),
            };
            callbacks.onTextDelta('재빌');
            await until(adapter.events, (event) => event.item?.type === 'assistant_message'
                && event.item.text === '재빌');
            callbacks.onAssistantToolCallObserved(call);
            if (boundary === 'child batch') callbacks.onToolCall(1, [call]);
            callbacks.onToolResult({ toolCallId: call.id, toolName: call.name, content: 'ok' });
            callbacks.onTextDelta('드할');
            await until(adapter.events, (event) => event.item?.type === 'assistant_message'
                && event.item.text === '재빌드할');
            assert.equal(adapter.events.some((event) => event.item?.type === 'tool_call'), false);
            callbacks.onTextDelta('게.');
            callbacks.onAssistantText('재빌드할게.');
            if (boundary === 'canonical parent') callbacks.onToolCall(1, [call]);
            return { content: '재빌드할게.' };
        });
        assert.deepEqual(items.map((item) => item.type), ['assistant_message', 'tool_call']);
        assert.equal(items[0].text, '재빌드할게.');
        assert.equal(items[1].callId, 'read-fixture');
        assert.equal(items[1].status, 'completed');
    });
}

// 스트림 델타가 없는 최종 본문도 SDK 변환 뒤 한 행으로 보존한다.
test('fixture SDK projection preserves final-only Korean text after tools observed without active text', async (t) => {
    const items = await projectedFixture(t, async (callbacks) => {
        callbacks.onAssistantToolCallObserved({ id: 'final-read', name: 'read' });
        callbacks.onToolResult({ toolCallId: 'final-read', toolName: 'read', content: 'ok' });
        return { content: '재빌드할게.' };
    });
    assert.deepEqual(items.map((item) => item.type), ['tool_call', 'assistant_message']);
    assert.equal(items[1].text, '재빌드할게.');
    assert.equal(items[0].status, 'completed');
});

// 표시된 도구의 완료 갱신도 본문 중간에 끼워 넣지 않고 종료 경계에서 반영한다.
test('fixture SDK projection defers updates of already-visible tools during active prose', async (t) => {
    const items = await projectedFixture(t, async (callbacks, adapter) => {
        callbacks.onToolCall(1, [{ id: 'visible-read', name: 'read' }]);
        await until(adapter.events, (event) => event.item?.type === 'tool_call'
            && event.item.callId === 'visible-read' && event.item.status === 'running');
        callbacks.onTextDelta('재빌');
        await until(adapter.events, (event) => event.item?.type === 'assistant_message'
            && event.item.text === '재빌');
        callbacks.onToolResult({ toolCallId: 'visible-read', toolName: 'read', content: 'ok' });
        callbacks.onTextDelta('드할');
        await until(adapter.events, (event) => event.item?.type === 'assistant_message'
            && event.item.text === '재빌드할');
        assert.deepEqual(adapter.events.filter((event) => event.item?.type === 'tool_call')
            .map((event) => event.item.status), ['running']);
        callbacks.onTextDelta('게.');
        callbacks.onAssistantText('재빌드할게.');
        return { content: '재빌드할게.' };
    });
    assert.deepEqual(items.map((item) => item.type), ['tool_call', 'assistant_message']);
    assert.equal(items[0].callId, 'visible-read');
    assert.equal(items[0].status, 'completed');
    assert.equal(items[1].text, '재빌드할게.');
});

// 스트림 오류에서도 완료된 도구는 유지하고 미완료 도구만 취소 상태로 투영한다.
test('fixture SDK projection retains completed tools and cancels unfinished tools on error', async (t) => {
    const items = await projectedFixture(t, async (callbacks, adapter) => {
        callbacks.onToolCall(1, [{ id: 'visible-done', name: 'read' }]);
        await until(adapter.events, (event) => event.item?.type === 'tool_call'
            && event.item.callId === 'visible-done' && event.item.status === 'running');
        callbacks.onTextDelta('재빌');
        await until(adapter.events, (event) => event.item?.type === 'assistant_message'
            && event.item.text === '재빌');
        callbacks.onToolResult({ toolCallId: 'visible-done', toolName: 'read', content: 'ok' });
        callbacks.onAssistantToolCallObserved({ id: 'unfinished-read', name: 'read' });
        callbacks.onTextDelta('드할게.');
        await until(adapter.events, (event) => event.item?.type === 'assistant_message'
            && event.item.text === '재빌드할게.');
        assert.deepEqual(adapter.events.filter((event) => event.item?.type === 'tool_call')
            .map((event) => [event.item.callId, event.item.status]), [['visible-done', 'running']]);
        throw new Error('fixture stream failure');
    }, 'turn_failed');
    assert.deepEqual(items.filter((item) => item.type === 'assistant_message')
        .map((item) => item.text), ['재빌드할게.']);
    assert.deepEqual(items.filter((item) => item.type === 'tool_call')
        .map((item) => [item.callId, item.status]),
        [['visible-done', 'completed'], ['unfinished-read', 'canceled']]);
});

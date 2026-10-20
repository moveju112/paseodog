import test from 'node:test';
import assert from 'node:assert/strict';
import { promptText, MAX_FRAME } from '../plugin/server/util.mjs';
import { fixture, until } from './helpers.mjs';
import { createNativeEngine } from '../engine/src/native-engine.mjs';

const image = { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' };
const message = (content) => ({ clientMessageId: 'image', input: { type: 'message', content } });

// 텍스트는 기존 형식을 유지하고 이미지 전용 입력과 여러 파트는 순서를 유지한다.
test('text remains compatible and image-only and mixed prompts preserve content', () => {
    assert.deepEqual(promptText(message([{ type: 'text', text: 'hello' }])), { text: 'hello' });
    for (const content of [[image], [{ type: 'text', text: 'before' }, image,
        { type: 'text', text: 'after' }, { ...image, mimeType: 'image/jpeg' }]]) {
        assert.deepEqual(promptText(message(content)).content, content);
    }
});

// 잘못된 형식과 과대한 입력은 실행 전에 명시적으로 거절한다.
test('invalid and oversized image inputs and unsupported attachments are rejected', () => {
    for (const part of [{ ...image, mimeType: 'text/html' }, { ...image, data: '?' },
        { ...image, data: '' }, { type: 'uploaded_file', path: '/etc/passwd' }]) {
        assert.throws(() => promptText(message([part])));
    }
    assert.throws(() => promptText(message([{ ...image, data: 'a'.repeat(MAX_FRAME) }])), /16 MiB/);
});

// 이미지 권한을 협상하지 않은 연결에서는 엔진을 호출하지 않는다.
test('images require negotiated capability', async (t) => {
    const f = fixture({}, { capabilities: ['prompt.message', 'session.persistence'] });
    t.after(() => f.connection.close());
    await f.ready();
    f.prompt.prompt.input.content = [image];
    await f.connection.send(f.prompt);
    const result = await until(f.events, (event) => event.type === 'session.prompt_result');
    assert.equal(result.result.type, 'failed');
    assert.equal(f.calls.filter((call) => call.text).length, 0);
});

// 기존 네이티브 ask에 이미지 배열을 그대로 전달하고 자동 후속 턴에 재첨부하지 않는다.
test('native engine passes image content to the existing Mixdog ask API', async () => {
    const received = [];
    const engine = await createNativeEngine({ config: { cwd: '/work', mcpServers: {} } }, {
        modules: {
            loadConfig: () => ({}),
            createMixdogSessionRuntime: async (options) => {
                const tool = { getStatus: () => ({ jobs: [] }), onStatusChange: () => () => {},
                    closeAll: async () => ({ failed: [] }) };
                options.agentSessionSurface({ mgr: {}, getAgentTool: () => tool });
                return { id: 'image-session',
                    async ask(content, callbacks) {
                        received.push(content);
                        callbacks.beforeSessionAsk({ id: 'image-session', messages: [] });
                        return { content: 'description' };
                    },
                    abort() {}, close() {}, resume() {}, compact() {},
                };
            },
        },
    });
    try {
        await engine.ask([image], {});
        assert.deepEqual(received, [[image]]);
    } finally { await engine.close('done'); }
});

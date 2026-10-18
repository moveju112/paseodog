import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

// 실제 엔진·HTTP provider·네이티브 도구를 임시 프로필에서 실행한다. 모델 응답만 고정한다.
const directory = mkdtempSync(join(tmpdir(), 'paseodog-native-'));
// 네이티브 비동기 저장 작업이 끝난 프로세스 종료 시점에 테스트 데이터만 삭제한다.
process.once('exit', () => rmSync(directory, { recursive: true, force: true }));
const work = join(directory, 'work');
mkdirSync(work);
const allowedFile = join(work, 'allowed.txt'), deniedFile = join(work, 'denied.txt');
writeFileSync(allowedFile, 'PASEODOG_READ_PROOF');
for (const name of Object.keys(process.env)) {
    if (!['PATH', 'LANG', 'LC_ALL', 'TMPDIR'].includes(name)) delete process.env[name];
}
Object.assign(process.env, { HOME: directory, MIXDOG_HOME: join(directory, 'profile'),
    MIXDOG_DATA_DIR: join(directory, 'profile', 'data'), DEEPSEEK_API_KEY: 'local-test-only',
    PASEODOG_TEST_PARENT_WORKER: 'true' });
const requests = [], approvals = [], readProofs = [], responses = [];
let nativeEngine, cancelApproval, abortPromise, cancelStarted, resolveCancelStarted;
cancelStarted = new Promise((resolve) => { resolveCancelStarted = resolve; });

// OpenAI 호환 wire를 통해 도구 호출과 최종 응답을 전달한다.
function send(response, { text, calls = [] }) {
    responses.push(text || calls.map((call) => call.name).join(','));
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunk = { id: 'local', object: 'chat.completion.chunk', model: 'paseodog-local',
        choices: [{ index: 0, delta: calls.length ? { tool_calls: calls.map((call, index) => ({
            index, id: call.id, type: 'function', function: {
                name: response.directTools.has(call.name) ? call.name : 'call_tool',
                arguments: JSON.stringify(response.directTools.has(call.name) ? call.args :
                    { name: call.name, arguments: call.args }) },
        })) } : { content: text }, finish_reason: null }] };
    response.write(`data: ${JSON.stringify(chunk)}\n\n`);
    response.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {},
        finish_reason: calls.length ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } })}\n\n`);
    response.end('data: [DONE]\n\n');
}

// 요청의 사용자 메시지와 실제 도구 결과에만 반응하는 결정적 로컬 모델이다.
const server = createServer(async (request, response) => {
    try {
        if (request.method === 'GET') {
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ data: [{ id: 'paseodog-local', context_length: 65536 }] }));
            return;
        }
        let body = '';
        for await (const chunk of request) body += chunk;
        const input = JSON.parse(body);
        response.directTools = new Set((input.tools || []).map((tool) => tool.function?.name || tool.name));
        requests.push(input);
        assert.ok(requests.length <= 24, 'Unexpected inference loop');
        const messages = input.messages || [];
        const users = messages.filter((message) => message.role === 'user').map((message) =>
            typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n');
        const history = JSON.stringify(messages);
        const results = messages.filter((message) => message.role === 'tool');
        if ((users.includes('PASEODOG_PARENT_CANCEL') || users.includes('PASEODOG_PARENT_PARALLEL')) &&
            !history.includes('"load-agent"')) {
            send(response, { calls: [{ id: 'load-agent', name: 'load_tool', args: { names: ['agent'] } }] });
        } else if (users.includes('PASEODOG_PARENT_CANCEL')) {
            if (!history.includes('"spawn-cancel"')) send(response, { calls: [{ id: 'spawn-cancel', name: 'agent',
                args: { type: 'spawn', agent: 'worker', tag: 'cancel-worker',
                    prompt: 'PASEODOG_CHILD_CANCEL', provider: 'deepseek', model: 'paseodog-local' } }] });
            else send(response, { text: 'Waiting for cancel worker.' });
        } else if (users.includes('PASEODOG_RESTORE')) {
            send(response, { text: history.includes('PARALLEL_AND_FOLLOWUP_DONE') ? 'RESTORE_DONE' : 'RESTORE_FAILED' });
        } else if (users.includes('PASEODOG_PARENT_PARALLEL')) {
            if (!history.includes('"spawn-allow"')) send(response, { calls: [
                { id: 'spawn-allow', name: 'agent', args: { type: 'spawn', agent: 'worker', tag: 'allow-worker',
                    prompt: 'PASEODOG_CHILD_ALLOW', provider: 'deepseek', model: 'paseodog-local' } },
                { id: 'spawn-deny', name: 'agent', args: { type: 'spawn', agent: 'worker', tag: 'deny-worker',
                    prompt: 'PASEODOG_CHILD_DENY', provider: 'deepseek', model: 'paseodog-local' } },
            ] });
            else if (history.includes('CHILD_ALLOW_DONE') && history.includes('CHILD_DENY_DONE') &&
                !history.includes('"followup"')) send(response, { calls: [{ id: 'followup', name: 'agent',
                    args: { type: 'send', tag: 'allow-worker', prompt: 'PASEODOG_CHILD_FOLLOWUP' } }] });
            else if (history.includes('CHILD_FOLLOWUP_DONE')) send(response, { text: 'PARALLEL_AND_FOLLOWUP_DONE' });
            else send(response, { text: 'Waiting for both workers.' });
        } else if (users.includes('PASEODOG_CHILD_FOLLOWUP')) {
            send(response, { text: 'CHILD_FOLLOWUP_DONE' });
        } else if (users.includes('PASEODOG_CHILD_ALLOW')) {
            if (!results.length) send(response, { calls: [{ id: 'same-child-call', name: 'read',
                args: { file_path: allowedFile } }] });
            else {
                readProofs.push(results.some((result) => JSON.stringify(result).includes('PASEODOG_READ_PROOF')));
                send(response, { text: 'CHILD_ALLOW_DONE' });
            }
        } else if (users.includes('PASEODOG_CHILD_DENY') || users.includes('PASEODOG_CHILD_CANCEL')) {
            if (!results.length) send(response, { calls: [{ id: 'same-child-call', name: 'shell',
                args: { command: `printf forbidden > '${deniedFile}'` } }] });
            else send(response, { text: 'CHILD_DENY_DONE' });
        } else send(response, { text: 'LOCAL_AUXILIARY_RESPONSE' });
    } catch (error) {
        response.writeHead(500);
        response.end(error.message);
    }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const timer = setTimeout(() => {
    console.error('Native orchestration smoke timed out');
    process.exit(1);
}, 90000);
try {
    const { updateSection } = await import('../engine/node_modules/mixdog/src/runtime/shared/config.mjs');
    updateSection('agent', () => ({
        providers: { deepseek: { enabled: true, baseURL: `http://127.0.0.1:${server.address().port}/v1`,
            apiKey: 'local-test-only', preconnect: false } },
        presets: [{ id: 'local-test', name: 'Local Test', provider: 'deepseek', model: 'paseodog-local',
            tools: 'full', autoEffort: false }],
        default: 'local-test',
        agents: { worker: { provider: 'deepseek', model: 'paseodog-local', autoEffort: false } },
        builtins: { autoEffort: false }, update: { auto: false }, aiSessionTitles: false,
        modules: { memory: { enabled: false } },
    }));
    const { createNativeEngine } = await import('../engine/src/native-engine.mjs');
    const args = { config: { cwd: work, mode: 'ask', mcpServers: {},
        systemPrompt: 'Use the supplied tasks. Every tool requires host approval.' },
        route: { provider: 'deepseek', model: 'paseodog-local', effort: 'low' } };
    nativeEngine = await createNativeEngine(args);
    let sessionId;
    const childApprovals = [];
    const liveSnapshots = [];
    const parallelGate = [];
    const callbacks = {
        onIdentity: ({ id }) => { sessionId = id; },
        onToolApproval: async (info) => {
            approvals.push(info);
            if (!info.childSessionId) return { approved: ['agent', 'task', 'load_tool'].includes(info.name) };
            childApprovals.push(info);
            liveSnapshots.push(await nativeEngine.status());
            if (info.reason.includes('cancel-worker')) {
                resolveCancelStarted();
                return new Promise((resolve) => { cancelApproval = resolve; });
            }
            // 두 하위 승인 요청이 동시에 도착해야만 풀어 실제 병렬 실행을 증명한다.
            return new Promise((resolve) => {
                parallelGate.push({ resolve, info });
                if (parallelGate.length === 2) {
                    for (const pending of parallelGate)
                        pending.resolve({ approved: pending.info.name === 'read', reason: 'Local test policy' });
                }
            });
        },
    };
    const result = await nativeEngine.ask('PASEODOG_PARENT_PARALLEL', callbacks);
    assert.match(result.result?.content || result.content, /PARALLEL_AND_FOLLOWUP_DONE/,
        JSON.stringify({ result: { keys: Object.keys(result || {}), content: result?.result?.content }, responses,
            approvals: approvals.map(({ name, reason }) => ({ name, reason })),
            tools: requests.flatMap((request) => (request.messages || []).filter((message) =>
                message.role === 'tool').map((message) => String(message.content).slice(0, 700))).slice(-6) }));
    assert.equal(childApprovals.length, 2);
    assert.ok(childApprovals.every((info) => info.sessionId === sessionId));
    assert.ok(readProofs.includes(true), 'Native read did not return the fixture contents');
    assert.equal(existsSync(deniedFile), false, 'Denied command executed');
    assert.ok(liveSnapshots.some((snapshot) => snapshot.jobs.some((job) =>
        job.id && job.status === 'running' && job.model === 'paseodog-local')),
        'Live job projection did not show the native running model');
    const completedStatus = await nativeEngine.status();
    assert.ok(completedStatus.workflow?.id, 'Live workflow identity missing');
    assert.ok(completedStatus.jobs.some((job) => job.status === 'completed'),
        'Completed native jobs missing from live status');
    await nativeEngine.close('local-smoke-restore');
    nativeEngine = await createNativeEngine({ ...args, nativeSessionId: sessionId });
    const restored = await nativeEngine.ask('PASEODOG_RESTORE', callbacks);
    assert.match(restored.result?.content || restored.content, /RESTORE_DONE/);
    const cancelTurn = nativeEngine.ask('PASEODOG_PARENT_CANCEL', callbacks);
    const canceled = cancelTurn.then(() => 'settled', () => 'rejected');
    await cancelStarted;
    abortPromise = nativeEngine.abort('local-smoke-cancel');
    cancelApproval({ approved: true });
    await abortPromise;
    await canceled;
    assert.equal(existsSync(deniedFile), false, 'Late approval executed after cancel');
    console.log(JSON.stringify({ status: 'PASS', model: 'local scripted HTTP provider (not a real LLM)',
        requests: requests.length, checks: ['native parallel spawn', 'child allow/deny',
            'same-tag followup', 'parent completion collection', 'native restore', 'cancel and stale approval',
            'live workflow identity', 'live native job model and completion status'] }));
} finally {
    try { await nativeEngine?.close('local-smoke-exit'); } finally {
        clearTimeout(timer);
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
}

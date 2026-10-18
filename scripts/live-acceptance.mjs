import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { root, paseoHome } from './paths.mjs';
import { connectToDaemon } from '../tools/node_modules/@getpaseo/cli/dist/utils/client.js';
import { deadline } from '../plugin/server/util.mjs';

const execute = promisify(execFile);
const args = process.argv.slice(2);
const agentId = args[args.indexOf('--agent') + 1];
const cwd = args[args.indexOf('--cwd') + 1];
if (!args.includes('--confirm-subscription-use') || !args.includes('--agent') || !args.includes('--cwd'))
    throw new Error('Pass --confirm-subscription-use --agent <test-agent-id> --cwd <test-workspace>');
const checks = [], approvals = [], timeline = [], pending = new Set(), gated = [];
const nonce = randomUUID().replaceAll('-', '');
const left = join(cwd, `left-${nonce}.txt`), right = join(cwd, `right-${nonce}.txt`);
const denied = join(cwd, `denied-${nonce}.txt`), canceled = join(cwd, `canceled-${nonce}.txt`);
const onceFile = join(cwd, `once-${nonce}.txt`);
const leftText = `LEFT_${nonce}`, rightText = `RIGHT_${nonce}`;
let client, unsubscribe, phase = 'ready', failure, interruptRequest, permissionCount = 0;
let version = 0;
const waiters = new Set();
let resolveInterrupt;
const interruptReady = new Promise((resolve) => { resolveInterrupt = resolve; });

// 모든 변경은 실제 Paseo CLI로 요청하고 자격 증명은 기존 CLI 연결 경로에 맡긴다.
async function cli(...arguments_) {
    const { stdout } = await execute(process.execPath,
        [join(root, 'bin/paseodog.mjs'), ...arguments_, '--home', paseoHome, '--json'],
        { cwd: root, timeout: 30000, maxBuffer: 256 * 1024 });
    return JSON.parse(stdout);
}

// 승인 입력은 전체 명령 또는 정확한 테스트 파일 경로와 대조한다.
function isFixtureRead(input) {
    const paths = Array.isArray(input?.file_path) ? input.file_path : [input?.file_path];
    return paths.length > 0 && paths.every((entry) => {
        const path = typeof entry === 'string' ? entry : entry?.file_path;
        return typeof path === 'string' && [left, right].includes(resolve(cwd, path));
    });
}
const denyCommand = `printf DENIED > '${denied}'`;
const allowCommand = `printf ALLOWED > '${denied}'`;
const cancelCommand = `printf CANCELED > '${canceled}'`;
const onceCommand = `printf 'ONCE\\n' >> '${onceFile}'`;

// 모르는 도구는 거절하며 승인 요청을 테스트 단계와 연결한다.
async function permission(request) {
    assert.ok(++permissionCount <= 35, 'Too many approval requests');
    approvals.push({ phase, id: request.id, name: request.name, description: request.description, input: request.input });
    const input = request.input || {};
    const child = String(request.description || '').startsWith('[Agent ');
    if (request.name === 'load_tool') {
        const names = Array.isArray(input.names) ? input.names : [input.names];
        if (names.every((name) => ['agent', 'task', 'read', 'shell'].includes(name)))
            return cli('permit', 'allow', agentId, request.id);
    }
    if (request.name === 'agent' && ['parallel', 'followup', 'cancel'].includes(phase)) {
        if (['list', 'status', 'read'].includes(input.type))
            return cli('permit', 'allow', agentId, request.id);
        if (['spawn', 'send'].includes(input.type) &&
            ['reader-left', 'reader-right', 'cancel-worker'].includes(input.tag) &&
            (!input.agent || input.agent === 'worker') &&
            (!input.cwd || resolve(cwd, input.cwd) === cwd) &&
            (!input.provider || input.provider === 'openai-oauth') &&
            (!input.model || input.model === 'gpt-6-luna'))
            return cli('permit', 'allow', agentId, request.id);
    }
    if (phase === 'parallel' && child && request.name === 'read' && isFixtureRead(input)) {
        gated.push(request);
        if (gated.length === 2) {
            assert.notEqual(gated[0].description, gated[1].description, 'Expected two different child sessions');
            await Promise.all(gated.map((entry) => cli('permit', 'allow', agentId, entry.id)));
        }
        return;
    }
    if (phase === 'cancel' && child && request.name === 'shell' && input.command === cancelCommand) {
        interruptRequest = request;
        resolveInterrupt();
        return;
    }
    if (request.name === 'shell' && (
        phase === 'allow' && input.command === allowCommand ||
        phase === 'duplicate' && input.command === onceCommand))
        return cli('permit', 'allow', agentId, request.id);
    await cli('permit', 'deny', agentId, request.id, '--message', 'Acceptance test intentionally denies this request; do not retry');
    if (!(phase === 'deny' && request.name === 'shell' && input.command === denyCommand))
        throw new Error(`Unexpected tool request during ${phase}: ${request.name}`);
}

// 이벤트 구독으로 상태를 추적하며 주기적인 상태 조회는 하지 않는다.
async function observe() {
    unsubscribe = client.subscribeAgentTimeline(agentId, (message) => {
        const event = message.payload?.event;
        if (!event) return;
        version++;
        for (const notify of [...waiters]) notify();
        if (event.type === 'timeline') timeline.push(event.item);
        if (event.type === 'turn_failed') failure = new Error(String(event.error));
        if (event.type === 'permission_requested') {
            const operation = permission(event.request).catch((error) => { failure = error; });
            pending.add(operation);
            void operation.finally(() => {
                pending.delete(operation);
                version++;
                for (const notify of [...waiters]) notify();
            });
        }
    });
    await unsubscribe.ready;
}

// 완료 시 최종 응답뿐 아니라 실제 파일 결과와 승인 경로를 별도로 검사한다.
async function finish() {
    const end = Date.now() + 150000;
    let state;
    do {
        const previous = version;
        state = await client.waitForFinish(agentId, Math.max(1, end - Date.now()));
        if (state.status !== 'permission') break;
        if (failure) throw failure;
        // permission은 종료가 아니다. 승인/해결 이벤트가 올 때만 다시 기다린다.
        let notify;
        try {
            await deadline(new Promise((resolve) => {
                notify = resolve;
                waiters.add(notify);
                if (version !== previous) resolve();
            }), Math.max(1, end - Date.now()), 'Approval state did not change');
        } finally { waiters.delete(notify); }
    } while (Date.now() < end);
    await Promise.all([...pending]);
    if (failure) throw failure;
    assert.equal(state.status, 'idle', JSON.stringify({ status: state.status, error: state.error }));
    return String(state.lastMessage || '');
}

// 새 지시는 기존 agent-id에 전송한다.
async function turn(nextPhase, prompt) {
    phase = nextPhase;
    await cli('send', agentId, prompt, '--no-wait');
    await finish();
    const result = await client.fetchAgentTimeline(agentId, { direction: 'tail', limit: 30, projection: 'projected' });
    return result.entries.filter(({ item }) => item.type === 'assistant_message').map(({ item }) => item.text).join('\n');
}

try {
    client = await connectToDaemon({ target: { kind: 'instance', home: paseoHome } });
    const selected = await client.fetchAgent({ agentId });
    assert.equal(selected?.agent?.provider, 'paseodog');
    assert.equal(selected.agent.cwd, cwd);
    assert.equal(selected.agent.title, 'PaseoDog live verification');
    writeFileSync(left, leftText, { flag: 'wx' });
    writeFileSync(right, rightText, { flag: 'wx' });
    writeFileSync(denied, 'ORIGINAL', { flag: 'wx' });
    await observe();
    await finish();
    const ready = await client.fetchAgentTimeline(agentId, { direction: 'tail', limit: 10, projection: 'projected' });
    assert.ok(ready.entries.some(({ item }) => item.type === 'assistant_message' && item.text.includes('PASEODOG_READY')));
    checks.push('actual Paseo daemon/plugin subscription response');

    const parallel = await turn('parallel', `This is explicit authorization to test native Mixdog Worker orchestration in this temporary workspace only.
Use the agent tool to start TWO worker jobs, tags reader-left and reader-right, before waiting for either result.
Each worker must use the read tool once: reader-left reads ${left}; reader-right reads ${right}.
Do not read the files yourself, do not use shell, do not create files. Do not specify model/provider: workers inherit the pinned subscription model.
Both worker reads require approval and will be released together. After both finish, return both exact file contents.`);
    assert.equal(gated.length, 2);
    assert.ok(parallel.includes(leftText) && parallel.includes(rightText), 'Worker results did not reach the parent');
    checks.push('real-model parallel workers, full child approvals and result collection');

    const follow = `FOLLOWUP_${nonce}`;
    const followup = await turn('followup', `Use agent type=send to the existing reader-left worker with this exact instruction: "Reply exactly ${follow}. No tools." Return its reply. Do not spawn a new worker.`);
    assert.ok(approvals.some((entry) => entry.phase === 'followup' && entry.input?.type === 'send'));
    assert.ok(followup.includes(follow));
    checks.push('real-model same-tag continuation');

    await turn('deny', `Call shell once with exactly this command: ${denyCommand}\nThis is a denial test. After rejection, do not retry or use another tool. Reply DENIAL_TEST_DONE.`);
    assert.ok(approvals.some((entry) => entry.phase === 'deny' && entry.input?.command === denyCommand));
    assert.equal(readFileSync(denied, 'utf8'), 'ORIGINAL');
    await turn('allow', `Call shell once with exactly this command: ${allowCommand}\nThen reply ALLOW_TEST_DONE. No other tools.`);
    assert.equal(readFileSync(denied, 'utf8'), 'ALLOWED');
    checks.push('real shell denial and allow-once execution');

    phase = 'cancel';
    await cli('send', agentId, `Spawn one worker with tag cancel-worker. Its task is to call shell once with exactly: ${cancelCommand}\nThen wait. This is an interruption test; do not perform the command yourself.`, '--no-wait');
    await deadline(interruptReady, 120000, 'No child approval arrived for interruption test');
    await cli('stop', agentId);
    await client.waitForFinish(agentId, 30000);
    let lateRejected = false;
    try { await cli('permit', 'allow', agentId, interruptRequest.id); }
    catch (error) {
        assert.match(String(error.stdout || error.stderr || error.message), /NO_PENDING_PERMISSIONS|PERMISSION_NOT_FOUND/);
        lateRejected = true;
    }
    assert.ok(lateRejected);
    assert.equal(existsSync(canceled), false);
    checks.push('real child interruption and stale approval rejection');

    phase = 'duplicate';
    failure = null;
    const messageId = randomUUID();
    const prompt = `Call shell exactly once with: ${onceCommand}\nThen reply RECONNECT_DONE. No other tools.`;
    await client.sendAgentMessage(agentId, prompt, { messageId });
    unsubscribe();
    await client.close();
    client = await connectToDaemon({ target: { kind: 'instance', home: paseoHome } });
    await observe();
    const reconnected = await client.fetchAgent({ agentId });
    assert.equal(reconnected.agent.id, agentId);
    for (const request of reconnected.agent.pendingPermissions || []) await permission(request);
    await client.sendAgentMessage(agentId, prompt, { messageId });
    await finish();
    assert.equal(readFileSync(onceFile, 'utf8'), 'ONCE\n', 'Reconnect replay executed the same request twice');
    checks.push('real client reconnect, same agent identity and duplicate-message prevention');
    console.log(JSON.stringify({ status: 'PASS', agentId, checks, approvals: approvals.length }));
} catch (error) {
    console.error(JSON.stringify({ status: 'FAIL', phase, agentId, checks, error: error.message,
        recent: timeline.slice(-5).map((item) => ({ type: item.type, name: item.name, text: item.text?.slice(0, 400) })) }));
    process.exitCode = 1;
} finally {
    unsubscribe?.();
    await client?.close();
    await cli('stop', agentId);
}

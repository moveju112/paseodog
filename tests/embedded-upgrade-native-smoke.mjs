import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, watchFile, unwatchFile } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attachHostPolicy } from '../engine/src/policy.mjs';

// 실제 네이티브 도구와 엔진을 임시 프로필·로컬 고정 응답만으로 검증한다.
test('embedded 1.3.1 approval, cancellation and background lifetime', { timeout: 120000 }, async (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'paseodog-upgrade-test-'));
    process.once('exit', () => rmSync(directory, { recursive: true, force: true }));
    const work = join(directory, 'work');
    mkdirSync(work);
    for (const name of Object.keys(process.env)) {
        if (!['PATH', 'LANG', 'LC_ALL', 'TMPDIR'].includes(name)) delete process.env[name];
    }
    Object.assign(process.env, { HOME: directory, MIXDOG_HOME: join(directory, 'profile'),
        MIXDOG_DATA_DIR: join(directory, 'profile', 'data'), DEEPSEEK_API_KEY: 'local-test-only' });
    const { executeTool } = await import(
        '../engine/node_modules/mixdog/src/runtime/agent/orchestrator/session/loop/tool-exec.mjs');
    const { applyShellElevationGate, applyBeforeToolHook } = await import(
        '../engine/node_modules/mixdog/src/runtime/agent/orchestrator/session/loop/tool-exec/before-hook.mjs');
    const { checkExecPolicyMessage } = await import(
        '../engine/node_modules/mixdog/src/runtime/agent/orchestrator/tools/bash-policy-scan.mjs');
    const { waitForShellJob, subscribeShellJobSettled } = await import(
        '../engine/node_modules/mixdog/src/runtime/agent/orchestrator/tools/builtin/shell-jobs.mjs');
    const { createProcessTreeTracker, watchTermination } = await import(
        '../engine/node_modules/mixdog/src/runtime/agent/orchestrator/tools/lib/shell-descendants.mjs');
    const { planShellDeadlines } = await import(
        '../engine/node_modules/mixdog/src/runtime/agent/orchestrator/tools/builtin/bash-tool/deadline-plan.mjs');
    assert.equal(planShellDeadlines({ args: {}, backgroundOnTimeout: true }).autoBackgroundMs, 60000);
    const marker = join(work, 'approved.txt');
    const command = `printf approved > '${marker}'`;
    let count = 0;
    // 원래 훅을 보존한 호스트 세션으로 실제 도구 디스패치를 실행한다.
    const session = (prior, mode = 'ask') => {
        const value = { id: `upgrade-policy-${++count}`, cwd: work, messages: [], beforeToolHook: prior };
        attachHostPolicy(value, { mode });
        return value;
    };
    // 취소 신호와 승인 UI를 실제 도구 실행 경로에 전달한다.
    const execute = (value, name, args, toolApprovalHook, signal) =>
        executeTool(name, args, work, value.id, value, { toolApprovalHook, signal, toolCallId: 'upgrade-call' });
    await t.test('permit/deny/missing UI and upstream deny remain authoritative', async () => {
        for (const approval of [undefined, async () => ({ approved: false })]) {
            assert.match(await execute(session(), 'shell', { command }, approval), /denied/);
            assert.equal(existsSync(marker), false);
        }
        let asked = 0;
        assert.match(await execute(session(async () => ({ action: 'deny', reason: 'upstream' })),
            'shell', { command }, async () => { asked++; return true; }), /upstream/);
        assert.equal(asked, 0);
        await execute(session(), 'shell', { command }, async () => ({ approved: true }));
        assert.equal(readFileSync(marker, 'utf8'), 'approved');
    });
    await t.test('rewritten elevated shell/terminal cannot bypass host approval', async () => {
        for (const name of ['shell', 'terminal']) {
            const args = { command: 'sudo true', ...(name === 'terminal' ? { action: 'run' } : {}) };
            assert.equal(applyShellElevationGate({ name, args }).elevationApproved, true);
            const prior = async () => ({ action: 'rewrite', name, args });
            assert.match(await execute(session(prior), 'read', { file_path: marker }), /no approval UI/);
            let reviewed;
            assert.match(await execute(session(prior), 'read', { file_path: marker }, async (info) => {
                reviewed = info;
                return { approved: false };
            }), /denied/);
            assert.equal(reviewed.name, name);
            assert.deepEqual(reviewed.args, args);
            assert.match(await execute(session(prior, 'review'), 'read', { file_path: marker },
                async () => { throw new Error('review must not ask'); }), /Review mode/);
        }
        assert.equal(applyShellElevationGate({ name: 'shell', args: { command: 'shutdown now' } })
            .elevationApproved, false);
        assert.ok(checkExecPolicyMessage('shutdown now', { elevationApproved: true }));
    });
    await t.test('late approval after cancellation cannot dispatch a rewritten mutation', async () => {
        const controller = new AbortController();
        let resolveApproval, announce;
        const entered = new Promise((resolve) => { announce = resolve; });
        const lateFile = join(work, 'late.txt');
        const value = session(async () => ({ action: 'rewrite', name: 'shell',
            args: { command: `printf late > '${lateFile}'` } }));
        const pending = execute(value, 'read', { file_path: marker }, () => {
            announce();
            return new Promise((resolve) => { resolveApproval = resolve; });
        }, controller.signal);
        const rejected = assert.rejects(pending, /abort|cancel/i);
        await entered;
        controller.abort(new Error('upgrade canceled'));
        resolveApproval({ approved: true });
        await rejected;
        assert.equal(existsSync(lateFile), false);
    });
    await t.test('stale rewritten elevation approvals fail before the elevation gate', async () => {
        for (const name of ['shell', 'terminal']) {
            const args = { command: 'sudo true', ...(name === 'terminal' ? { action: 'run' } : {}) };
            const value = session(async () => ({ action: 'rewrite', name, args }));
            const controller = new AbortController();
            let announce, approve;
            const entered = new Promise((resolve) => { announce = resolve; });
            const pending = applyBeforeToolHook({ name: 'read', args: { file_path: marker }, cwd: work,
                callerSessionId: value.id, executeOpts: { signal: controller.signal },
                beforeToolHook: value.beforeToolHook, toolApprovalHook: () => {
                    announce();
                    return new Promise((resolve) => { approve = resolve; });
                } });
            const rejected = assert.rejects(pending, /cancel/i);
            await entered;
            controller.abort(new Error('elevation approval canceled'));
            approve({ approved: true });
            await rejected;
        }
    });

    let activeCommand, activeArgs, nativeEngine, requestCount = 0;
    const requests = [];
    // OpenAI 호환 SSE 응답으로 네이티브 셸 호출 한 번과 최종 응답만 전달한다.
    const server = createServer(async (request, response) => {
        try {
            if (request.method === 'GET') {
                response.end(JSON.stringify({ data: [{ id: 'upgrade-local', context_length: 65536 }] }));
                return;
            }
            let body = '';
            for await (const chunk of request) body += chunk;
            const input = JSON.parse(body);
            requests.push(input);
            assert.ok(++requestCount <= 16, 'Unexpected local inference loop');
            const messages = input.messages || [];
            const lastUser = messages.findLastIndex((message) => message.role === 'user');
            const hasResult = messages.slice(lastUser + 1).some((message) => message.role === 'tool');
            const direct = (input.tools || []).some((tool) => tool.function?.name === 'shell');
            const calls = !hasResult && activeCommand;
            const delta = calls ? { tool_calls: [{ index: 0, id: `upgrade-${requestCount}`,
                type: 'function', function: { name: direct ? 'shell' : 'call_tool',
                    arguments: JSON.stringify(direct ? { command: activeCommand, ...activeArgs } :
                        { name: 'shell', arguments: { command: activeCommand, ...activeArgs } }) } }] } :
                { content: 'UPGRADE_DONE' };
            const chunk = { id: 'local', object: 'chat.completion.chunk', model: 'upgrade-local',
                choices: [{ index: 0, delta, finish_reason: null }] };
            response.writeHead(200, { 'content-type': 'text/event-stream' });
            response.write(`data: ${JSON.stringify(chunk)}\n\n`);
            response.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {},
                finish_reason: calls ? 'tool_calls' : 'stop' }] })}\n\n`);
            response.end('data: [DONE]\n\n');
        } catch (error) {
            response.writeHead(500);
            response.end(error.message);
        }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(async () => {
        try { await nativeEngine?.close('upgrade-exit'); } finally {
            server.closeAllConnections();
            await new Promise((resolve) => server.close(resolve));
        }
    });
    const { updateSection } = await import('../engine/node_modules/mixdog/src/runtime/shared/config.mjs');
    updateSection('agent', () => ({
        providers: { deepseek: { enabled: true, baseURL: `http://127.0.0.1:${server.address().port}/v1`,
            apiKey: 'local-test-only', preconnect: false } },
        presets: [{ id: 'upgrade-local', name: 'Local', provider: 'deepseek', model: 'upgrade-local',
            tools: 'full', autoEffort: false }], default: 'upgrade-local',
        builtins: { autoEffort: false }, update: { auto: false }, aiSessionTitles: false,
        modules: { memory: { enabled: false } },
    }));
    const { createNativeEngine } = await import('../engine/src/native-engine.mjs');
    const engineArgs = { config: { cwd: work, mode: 'ask', mcpServers: {} },
        route: { provider: 'deepseek', model: 'upgrade-local', effort: 'low' } };
    nativeEngine = await createNativeEngine(engineArgs);
    let nativeId;
    const callbacks = { onIdentity: ({ id }) => { nativeId = id; },
        onToolApproval: async () => ({ approved: true }) };
    await t.test('native engine denies missing approval and explicit refusal without side effects', async () => {
        const denied = join(work, 'native-denied');
        activeCommand = `printf forbidden > '${denied}'`;
        activeArgs = {};
        for (const approval of [undefined, async () => ({ approved: false })]) {
            const result = await nativeEngine.ask('UPGRADE_NATIVE_DENY',
                { ...callbacks, onToolApproval: approval });
            assert.match(result.result?.content || result.content, /UPGRADE_DONE/);
            assert.equal(existsSync(denied), false);
        }
    });
    // inotify 없이 PID 파일의 완성 상태를 관찰하고 성공·실패 모두 감시와 타이머를 해제한다.
    const started = (path) => new Promise((resolve, reject) => {
        let timer = null, settled = false;
        // 단일 종료 경로로 등록 실패·시간 초과·파일 완성 경합을 정리한다.
        const finish = (error, pids) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            unwatchFile(path, inspect);
            if (error) reject(error);
            else resolve(pids);
        };
        // 파일 부재·부분 쓰기는 계속 관찰하고 완성된 양의 PID 두 개만 준비 상태로 인정한다.
        const inspect = () => {
            if (settled) return;
            try {
                const text = readFileSync(path, 'utf8');
                if (!text.endsWith('\n')) return;
                assert.match(text, /^[1-9]\d* [1-9]\d*\n$/, 'Invalid process readiness marker');
                finish(null, text.trim().split(' ').map(Number));
            } catch (error) {
                if (error.code !== 'ENOENT') finish(error);
            }
        };
        try {
            timer = setTimeout(() => finish(new Error(`Command did not start: ${path}`)), 15000);
            watchFile(path, { interval: 100 }, inspect);
            inspect();
        } catch (error) {
            finish(error);
        }
    });
    await t.test('readiness monitor handles existing, newly created and partial markers and rejects invalid data', async () => {
        const pids = [process.pid, process.ppid];
        const contents = `${pids.join(' ')}\n`;
        for (const state of ['existing', 'missing', 'partial']) {
            const path = join(work, `readiness-${state}`);
            if (state === 'existing') writeFileSync(path, contents);
            if (state === 'partial') writeFileSync(path, `${process.pid} `);
            const ready = started(path);
            if (state !== 'existing') writeFileSync(path, contents);
            assert.deepEqual(await ready, pids);
        }
        const invalid = join(work, 'readiness-invalid');
        writeFileSync(invalid, 'not pids\n');
        await assert.rejects(started(invalid), /Invalid process readiness marker/);
    });
    // 종료된 좀비는 실행 중인 프로세스가 아니므로 생존 판정에서 제외한다.
    const alive = (pid) => {
        try { return !/^\d+ \(.*\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    };
    // 취소 전에 프로세스 정체성을 캡처하고 동일한 트리가 사라질 때까지 관찰한다.
    const observeTree = async (pids) => {
        const tracker = createProcessTreeTracker({ pid: pids[0] });
        assert.equal(await tracker.capture(), true);
        return () => new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                stop();
                reject(new Error(`Process tree survived: ${pids.filter(alive).map((pid) =>
                    readFileSync(`/proc/${pid}/stat`, 'utf8')).join('; ')}`));
            }, 10000);
            const stop = watchTermination({ tracker, rootExited: () => !alive(pids[0]), onTerminated: () => {
                clearTimeout(timer);
                resolve();
            } });
        });
    };
    await t.test('native cancel terminates the foreground shell and its descendant', async () => {
        const path = join(work, 'foreground-pids');
        activeCommand = `sleep 120 & echo "$$ $!" > '${path}'; wait`;
        activeArgs = {};
        const ready = started(path);
        const turn = nativeEngine.ask('UPGRADE_CANCEL', callbacks);
        const settled = turn.then(() => {}, () => {});
        const pids = await ready;
        assert.ok(pids.every(alive));
        const terminated = await observeTree(pids);
        await nativeEngine.abort('user-cancel');
        await settled;
        await terminated();
        assert.ok(pids.every((pid) => !alive(pid)), 'Canceled process tree survived');
    });
    await t.test('default 60-second hold promotes, completes after turn, and retains native history', async () => {
        const done = join(work, 'background-done');
        activeCommand = `sleep 63; printf completed > '${done}'`;
        activeArgs = {};
        let taskId;
        const begin = Date.now();
        const result = await nativeEngine.ask('UPGRADE_BACKGROUND', { ...callbacks, onToolResult: (message) => {
            taskId ||= String(message.content).match(/task_id[:=]\s*([A-Za-z0-9_-]+)/)?.[1];
        } });
        assert.match(result.result?.content || result.content, /UPGRADE_DONE/);
        assert.ok(Date.now() - begin >= 60000, 'Default hold ended before 60 seconds');
        assert.ok(taskId, 'Missing promoted task id');
        assert.equal(existsSync(done), false, 'Command did not outlive its turn');
        const detail = await waitForShellJob(taskId, { timeoutMs: 15000 });
        assert.equal(detail.status, 'completed');
        assert.equal(detail.exitCode, 0);
        assert.equal(readFileSync(done, 'utf8'), 'completed');
        const before = requests.length;
        await nativeEngine.close('upgrade-resume');
        nativeEngine = await createNativeEngine({ ...engineArgs, nativeSessionId: nativeId });
        activeCommand = null;
        await nativeEngine.ask('UPGRADE_RESTORE', callbacks);
        assert.ok(requests.slice(before).some((input) => JSON.stringify(input.messages).includes('UPGRADE_BACKGROUND')),
            'Native history lost on resume');
    });
    await t.test('promoted shell survives turn cancel but close cleans its whole process tree', async () => {
        const path = join(work, 'background-pids');
        activeCommand = `sleep 120 & echo "$$ $!" > '${path}'; wait`;
        activeArgs = { wait_ms: 1000 };
        const ready = started(path);
        let taskId;
        const [pids] = await Promise.all([ready, nativeEngine.ask('UPGRADE_BACKGROUND_CANCEL', { ...callbacks, onToolResult: (message) => {
            taskId ||= String(message.content).match(/task_id[:=]\s*([A-Za-z0-9_-]+)/)?.[1];
        } })]);
        assert.ok(taskId);
        const terminated = await observeTree(pids);
        await nativeEngine.abort('user-cancel');
        assert.ok(pids.every(alive), 'Turn cancellation unexpectedly undid promoted work');
        const completion = new Promise((resolve) => subscribeShellJobSettled(taskId, resolve));
        await nativeEngine.close('upgrade-cleanup');
        const detail = await completion;
        assert.notEqual(detail.status, 'running');
        await terminated();
        assert.ok(pids.every((pid) => !alive(pid)), 'Closed session process tree survived');
    });
    await t.test('background completion after cancellation does not replay or start inference', async () => {
        nativeEngine = await createNativeEngine(engineArgs);
        const done = join(work, 'after-cancel');
        activeCommand = `sleep 3; printf finished > '${done}'`;
        activeArgs = { wait_ms: 1000 };
        let taskId;
        await nativeEngine.ask('UPGRADE_COMPLETE_AFTER_CANCEL', { ...callbacks, onToolResult: (message) => {
            taskId ||= String(message.content).match(/task_id[:=]\s*([A-Za-z0-9_-]+)/)?.[1];
        } });
        assert.ok(taskId);
        assert.equal(existsSync(done), false);
        const before = requests.length;
        await nativeEngine.abort('user-cancel');
        const detail = await waitForShellJob(taskId, { timeoutMs: 10000 });
        assert.equal(detail.status, 'completed');
        assert.equal(detail.exitCode, 0);
        assert.equal(readFileSync(done, 'utf8'), 'finished');
        assert.equal(requests.length, before, 'Completion triggered unmanaged inference or replay');
    });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { CLI_ROOT, patchInstalledCli } from '../scripts/patch-paseo-cli.mjs';

// 의존성이 없거나 패치가 누락되면 명시적으로 실패하는 설치본 전용 검사.
await patchInstalledCli('--check');

const agentId = '2d85f428-fdaf-4d98-906f-c583de2b805f';
const requests = [
    { id: 'permission-write', provider: 'codex', name: 'CodexBash', kind: 'tool' },
    { id: 'permission-edit', provider: 'codex', name: 'CodexBash', kind: 'tool' },
];
const options = { daemonTarget: { kind: 'endpoint', host: 'test.invalid' } };

// 설치 파일 -> 연결 경계만 주입하고 실제 명령 본문과 SDK ACK 처리를 실행.
async function loadCommand(action, client) {
    let source = await readFile(join(CLI_ROOT, `dist/commands/permit/${action}.js`), 'utf8');
    source = source.replace('import { connectToDaemon } from "../../utils/client.js";',
        'const connectToDaemon = async () => globalThis.__paseoPermitTestClient;');
    source = source.replace('from "./allow.js"', `from ${JSON.stringify(pathToFileURL(join(CLI_ROOT, 'dist/commands/permit/allow.js')).href)}`);
    globalThis.__paseoPermitTestClient = client;
    const module = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
    return module[action === 'allow' ? 'runAllowCommand' : 'runDenyCommand'];
}

// SDK의 기존 sendRequest 경계에서 ACK·타임아웃 제어.
async function createClient() {
    const { DaemonClient } = await import('../tools/node_modules/@getpaseo/client/dist/daemon-client.js');
    const confirmations = new Map();
    const responses = [];
    const client = {
        closed: false,
        fetchAgent: async () => ({ agent: { id: agentId, pendingPermissions: requests } }),
        close: async () => { client.closed = true; },
        respondToPermissionAndWait: DaemonClient.prototype.respondToPermissionAndWait,
        sendRequest: specification => {
            responses.push(specification);
            return new Promise((resolve, reject) => confirmations.set(specification.requestId, { resolve, reject }));
        },
    };
    return { client, confirmations, responses };
}

for (const action of ['allow', 'deny']) {
    test(`${action}: ACK gates success, every --all reply, and preserves response options`, async () => {
        const { client, confirmations, responses } = await createClient();
        const run = await loadCommand(action, client);
        let completed = false;
        const extra = action === 'allow'
            ? { input: '{"path":"reviewed"}' }
            : { message: 'not approved', interrupt: true };
        const command = run(agentId, undefined, { ...options, ...extra, all: true }, {});
        void command.then(() => { completed = true; });
        await nextTurn();
        assert.equal(responses.length, 2);
        assert.equal(completed, false);
        assert.equal(client.closed, false);
        for (const response of responses) {
            assert.equal(response.timeout, 15000);
            assert.deepEqual(response.options, { skipQueue: true });
            assert.deepEqual(response.message.response, action === 'allow'
                ? { behavior: 'allow', updatedInput: { path: 'reviewed' } }
                : { behavior: 'deny', message: 'not approved', interrupt: true });
            assert.equal(response.select({ type: 'other' }), null);
            assert.equal(response.select({ type: 'agent_permission_resolved', payload: { agentId: 'other', requestId: response.requestId } }), null);
            assert.equal(response.select({ type: 'agent_permission_resolved', payload: { agentId, requestId: 'other' } }), null);
            const payload = { agentId, requestId: response.requestId };
            assert.deepEqual(response.select({ type: 'agent_permission_resolved', payload }), payload);
        }
        confirmations.get(requests[0].id).resolve({});
        await nextTurn();
        assert.equal(completed, false);
        assert.equal(client.closed, false);
        confirmations.get(requests[1].id).resolve({});
        const result = await command;
        assert.deepEqual(result.data, requests.map(permission => ({
            requestId: permission.id, agentId, agentShortId: agentId.slice(0, 7),
            name: 'CodexBash', result: action === 'allow' ? 'allowed' : 'denied',
        })));
        assert.equal(client.closed, true);
    });

    test(`${action}: missing ACK rejects with upstream error and closes`, async () => {
        const { client, confirmations } = await createClient();
        const run = await loadCommand(action, client);
        const command = run(agentId, requests[0].id, options, {});
        const rejected = assert.rejects(command, {
            code: 'PERMISSION_RESPONSE_UNCONFIRMED',
            message: `Permission response unconfirmed for request ${requests[0].id}: Timeout waiting for message (15000ms)`,
            details: 'Use "paseo permit ls" to check whether the request is still pending',
        });
        await nextTurn();
        confirmations.get(requests[0].id).reject(new Error('Timeout waiting for message (15000ms)'));
        await rejected;
        assert.equal(client.closed, true);
    });

    test(`${action}: actual CLI output wrapper exits 0 on ACK and 1 on timeout`, async () => {
        for (const timeout of [false, true]) {
            const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
                import { readFileSync } from 'node:fs';
                import { pathToFileURL } from 'node:url';
                const root = ${JSON.stringify(CLI_ROOT)};
                const { Command } = await import(pathToFileURL(root + '/../../commander/esm.mjs'));
                const { withOutput } = await import(pathToFileURL(root + '/dist/output/with-output.js'));
                let source = readFileSync(root + '/dist/commands/permit/${action}.js', 'utf8')
                    .replace('import { connectToDaemon } from "../../utils/client.js";', 'const connectToDaemon = async () => globalThis.client;')
                    .replace('from "./allow.js"', 'from ' + JSON.stringify(pathToFileURL(root + '/dist/commands/permit/allow.js').href));
                globalThis.client = {
                    fetchAgent: async () => ({agent: {id: ${JSON.stringify(agentId)}, pendingPermissions: ${JSON.stringify(requests)}}}),
                    respondToPermissionAndWait: async () => { ${timeout ? 'throw new Error("Timeout waiting for message (15000ms)");' : ''} },
                    close: async () => {},
                };
                const module = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
                const program = new Command();
                program.argument('<agent>').argument('<request>').option('--json')
                    .action(withOutput(module.${action === 'allow' ? 'runAllowCommand' : 'runDenyCommand'}));
                await program.parseAsync(['node', 'permit', ${JSON.stringify(agentId)}, ${JSON.stringify(requests[0].id)}, '--json']);
            `], { encoding: 'utf8', timeout: 10000 });
            assert.equal(child.error, undefined);
            assert.equal(child.status, timeout ? 1 : 0, child.stderr);
            if (timeout) {
                assert.match(child.stderr, /PERMISSION_RESPONSE_UNCONFIRMED/);
                assert.equal(child.stdout, '');
            } else {
                assert.match(child.stdout, action === 'allow' ? /allowed/ : /denied/);
                assert.equal(child.stderr, '');
            }
        }
    });
}

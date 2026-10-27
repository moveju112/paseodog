import test from 'node:test';
import assert from 'node:assert/strict';
import { scratchPath } from '../scripts/paths.mjs';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { compilePlugin } from '../tools/node_modules/@getpaseo/server/dist/server/server/plugins/compiler.js';
import { extractHttpBearerToken, isAgentMcpRequestAuthorized, hashDaemonPassword } from '../tools/node_modules/@getpaseo/server/dist/server/server/auth.js';
import { createAgentMcpIdentity } from '../android/packages/server/src/server/agent/agent-mcp-identity.ts';
import { createAgentMessagePolicy } from '../android/packages/server/src/server/agent/agent-message-policy.ts';
import { AGENT_MESSAGE_PATCHES, patchedAgentMessageSource } from '../scripts/patch-paseo-agent-messages.mjs';
import { SESSION_TITLE_PATCHES, patchedSessionTitleSource } from '../scripts/patch-paseo-session-titles.mjs';

const ts = createRequire(new URL('../android/package.json', import.meta.url))('typescript');
const root = fileURLToPath(new URL('../', import.meta.url));
const server = new URL('../tools/node_modules/@getpaseo/server/', import.meta.url);
const spec = suffix => AGENT_MESSAGE_PATCHES.find(entry => entry.file.endsWith(suffix));
const patched = suffix => {
    const target = spec(suffix);
    return patchedAgentMessageSource(readFileSync(new URL(target.file, server), 'utf8'), target);
};
const bootstrap = patched('/bootstrap.js');
const runtimeConfig = await import(`data:text/javascript;base64,${Buffer.from(patched('/runtime-mcp-config.js')).toString('base64')}`);

async function temporary(t) {
    const directory = await fs.mkdtemp(scratchPath('paseodog-message-boundary-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    return directory;
}

test('actual plugin compiler accepts the server and client entry points within enforced boundaries', async () => {
    const bundles = await compilePlugin({
        server: join(root, 'plugin/index.server.ts'),
        client: join(root, 'plugin/index.client.tsx'),
    });
    assert.ok(bundles.serverBundle?.length);
    assert.ok(bundles.clientBundle?.length);
});

test('real controls CLI and stdio persist policy without opening an inference runtime', async t => {
    const home = await temporary(t);
    const env = { ...process.env, PASEO_HOME: home, MIXDOG_HOME: '', MIXDOG_DATA_DIR: '' };
    const executable = join(root, 'engine/bin/paseodog-engine.mjs');
    const write = spawnSync(process.execPath, [executable, '--controls', JSON.stringify({
        action: 'messagePolicy', operation: 'write', allowUnrelatedSessions: false,
    })], { env, encoding: 'utf8', timeout: 15000 });
    assert.equal(write.status, 0, write.stderr);
    assert.deepEqual(JSON.parse(write.stdout), { allowUnrelatedSessions: false });
    const read = spawnSync(process.execPath, [executable, '--controls-stdio'], {
        env, encoding: 'utf8', timeout: 15000,
        input: JSON.stringify({ v: 1, id: 'read', request: { action: 'messagePolicy', operation: 'read' } }) + '\n',
    });
    assert.equal(read.status, 0, read.stderr);
    assert.deepEqual(JSON.parse(read.stdout), {
        v: 1, id: 'read', ok: true, value: { allowUnrelatedSessions: false },
    });
});

// 주입되는 실제 설정의 토큰과 실제 HTTP 라우트 핸들러를 연결한다.
function requestHandler(source, bindings) {
    const ast = ts.createSourceFile('bootstrap.ts', source, ts.ScriptTarget.Latest, true);
    let expression;
    function visit(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'runAgentMcpRequest')
            expression = node.initializer.getText(ast);
        ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.ok(expression);
    const code = ts.transpileModule(`const handler = (${expression});`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    return new Function(...Object.keys(bindings), code + ';return handler;')(...Object.values(bindings));
}

for (const [platform, source] of [
    ['shared', readFileSync(new URL('../android/packages/server/src/server/bootstrap.ts', import.meta.url), 'utf8')],
    ['pinned', bootstrap],
]) {
    test(`${platform}: omission and spoofing cannot turn an agent into a user or another agent`, async t => {
        const home = await temporary(t);
        const policy = createAgentMessagePolicy({ fs, join, isAbsolute, home });
        await policy.write({ allowUnrelatedSessions: false });
        const secret = crypto.randomBytes(32).toString('hex');
        const agentMcpIdentity = createAgentMcpIdentity({ crypto, secret });
        const launch = runtimeConfig.withRuntimePaseoMcpServer({
            config: { provider: 'paseodog', cwd: home }, agentId: 'sender',
            mcpBaseUrl: 'http://localhost/mcp/agents', mcpAuthToken: secret,
        });
        const authorization = launch.mcpServers.paseo.headers.Authorization;
        assert.notEqual(extractHttpBearerToken(authorization), secret);
        const records = {
            sender: { labels: {} },
            child: { labels: { 'paseo.parent-agent-id': 'sender' } },
            unrelated: { labels: {} },
        };
        const observed = [], delivered = [];
        const config = {};
        const handler = requestHandler(source, {
            mcpEnabled: true, agentMcpIdentity, config,
            extractHttpBearerToken, isAgentMcpRequestAuthorized,
            logger: { error() {} },
            createAgentMcpSession: async callerAgentId => {
                observed.push(callerAgentId);
                return {
                    server: { close() {} },
                    transport: {
                        close() {},
                        async handleRequest(req, res) {
                            await policy.authorize(callerAgentId, req.body.target,
                                { getAgent: id => records[id] }, { get: async () => null });
                            delivered.push(req.body.target);
                            res.json({ ok: true });
                        },
                    },
                };
            },
        });
        async function send({ header = authorization, caller, target = 'unrelated' } = {}) {
            const response = {
                statusCode: 200, headersSent: false,
                status(code) { this.statusCode = code; return this; },
                json(value) { this.value = value; }, on() {},
            };
            await handler({ method: 'POST', query: { callerAgentId: caller }, body: { target },
                header: () => header }, response);
            return response.statusCode;
        }
        assert.equal(await send(), 500); // 신원은 sender로 유지되어 정책이 차단한다.
        assert.equal(observed.at(-1), 'sender');
        assert.deepEqual(delivered, []);
        assert.equal(await send({ target: 'child' }), 200);
        for (const caller of ['unrelated', '', ['sender'], { id: 'sender' }])
            assert.equal(await send({ caller }), 401);
        assert.equal(await send({ header: '' }), 401);
        assert.equal(await send({ header: authorization + 'x' }), 401);
        const forged = authorization.split('.');
        forged[1] = Buffer.from('unrelated').toString('base64url');
        assert.equal(await send({ header: forged.join('.') }), 401);
        assert.equal(await send({ header: `Bearer ${secret}`, caller: 'sender' }), 401);
        const beforeOwner = delivered.length;
        assert.equal(await send({ header: `Bearer ${secret}` }), 200);
        assert.equal(observed.at(-1), undefined);
        assert.equal(delivered.length, beforeOwner + 1);
        config.auth = { password: hashDaemonPassword('test-owner-password') };
        assert.equal(await send({ header: 'Bearer test-owner-password' }), 200);
        assert.equal(await send({ header: 'Bearer wrong-password' }), 401);
        assert.deepEqual(delivered, ['child', 'unrelated', 'unrelated']);
    });
}

test('agent-bound tokens cannot be reused after daemon key rotation or for another identity', async () => {
    const identity = createAgentMcpIdentity({ crypto, secret: crypto.randomUUID() });
    const verifyPassword = async () => false;
    const token = identity.mint('agent-a');
    assert.deepEqual(await identity.resolve({ token, requestedCaller: undefined, verifyPassword }),
        { authorized: true, callerAgentId: 'agent-a' });
    assert.deepEqual(await identity.resolve({ token, requestedCaller: 'agent-b', verifyPassword }), { authorized: false });
    const next = createAgentMcpIdentity({ crypto, secret: crypto.randomUUID() });
    assert.deepEqual(await next.resolve({ token, requestedCaller: undefined, verifyPassword }), { authorized: false });
});

test('bootstrap identity and title patches preserve each other with strict hash and partial-patch gates', () => {
    const target = spec('/bootstrap.js');
    const titleSpec = SESSION_TITLE_PATCHES.find(entry => entry.file === 'bootstrap.js');
    assert.equal(patchedAgentMessageSource(bootstrap, target), bootstrap);
    assert.equal(patchedSessionTitleSource(bootstrap, titleSpec), bootstrap);
    assert.throws(() => patchedAgentMessageSource(bootstrap + '// drift', target), /hash mismatch/);
    const [before, after] = target.edits[3];
    assert.throws(() => patchedAgentMessageSource(bootstrap.replace(after, before), target), /Partial/);
});

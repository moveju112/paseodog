import test from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { compilePlugin } from '../tools/node_modules/@getpaseo/server/dist/server/server/plugins/compiler.js';
import { extractHttpBearerToken, isAgentMcpRequestAuthorized, hashDaemonPassword } from '../tools/node_modules/@getpaseo/server/dist/server/server/auth.js';
import { createAgentMcpIdentity } from '../android/packages/server/src/server/agent/agent-mcp-identity.ts';
import { PASEO_ISOLATION_PATCHES, patchedSessionIsolationSource } from '../scripts/patch-paseo-session-isolation.mjs';
import { SESSION_TITLE_PATCHES, patchedSessionTitleSource } from '../scripts/patch-paseo-session-titles.mjs';

const ts = createRequire(new URL('../android/package.json', import.meta.url))('typescript');
const root = fileURLToPath(new URL('../', import.meta.url));
const server = new URL('../tools/node_modules/@getpaseo/server/', import.meta.url);
const spec = suffix => PASEO_ISOLATION_PATCHES.find(entry => entry.file.endsWith(suffix));
const patched = suffix => {
    const target = spec(suffix);
    return patchedSessionIsolationSource(readFileSync(new URL(target.file, server), 'utf8'), target);
};
const bootstrap = patched('/bootstrap.js');
const runtimeConfig = await import(`data:text/javascript;base64,${Buffer.from(patched('/runtime-mcp-config.js')).toString('base64')}`);

test('actual plugin compiler accepts the server and client entry points within enforced boundaries', async () => {
    const bundles = await compilePlugin({
        server: join(root, 'plugin/index.server.ts'),
        client: join(root, 'plugin/index.client.tsx'),
    });
    assert.ok(bundles.serverBundle?.length);
    assert.ok(bundles.clientBundle?.length);
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
    test(`${platform}: omission and spoofing cannot turn an MCP caller into a user or another agent`, async () => {
        const secret = crypto.randomBytes(32).toString('hex');
        const agentMcpIdentity = createAgentMcpIdentity({ crypto, secret });
        const launch = runtimeConfig.withRuntimePaseoMcpServer({
            config: { provider: 'paseodog', cwd: '/fixture' }, agentId: 'sender',
            mcpBaseUrl: 'http://localhost/mcp/agents', mcpAuthToken: secret,
        });
        const authorization = launch.mcpServers.paseo.headers.Authorization;
        assert.notEqual(extractHttpBearerToken(authorization), secret);
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
                            assert.equal(req.body.method, 'tools/list');
                            delivered.push(callerAgentId ?? 'owner');
                            res.json({ ok: true });
                        },
                    },
                };
            },
        });
        async function send({ header = authorization, caller } = {}) {
            const response = {
                statusCode: 200, headersSent: false,
                status(code) { this.statusCode = code; return this; },
                json(value) { this.value = value; }, on() {},
            };
            await handler({ method: 'POST', query: { callerAgentId: caller }, body: { method: 'tools/list' },
                header: () => header }, response);
            return response.statusCode;
        }
        assert.equal(await send(), 200);
        assert.equal(observed.at(-1), 'sender');
        assert.deepEqual(delivered, ['sender']);
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
        assert.deepEqual(delivered, ['sender', 'owner', 'owner']);
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
    assert.equal(patchedSessionIsolationSource(bootstrap, target), bootstrap);
    assert.equal(patchedSessionTitleSource(bootstrap, titleSpec), bootstrap);
    assert.throws(() => patchedSessionIsolationSource(bootstrap + '// drift', target), /hash mismatch/);
    const [before, after] = target.edits[3];
    assert.throws(() => patchedSessionIsolationSource(bootstrap.replace(after, before), target), /Partial/);
});

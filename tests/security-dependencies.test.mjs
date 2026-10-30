import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import { join } from 'node:path';
import { scratchPath } from '../scripts/paths.mjs';

const serverRequire = createRequire(new URL('../tools/node_modules/@getpaseo/server/package.json', import.meta.url));
// 실제 Paseo 서버가 해석하는 MCP 모듈을 사용한다.
const loadMcp = (path) => import(pathToFileURL(serverRequire.resolve(`@modelcontextprotocol/sdk/${path}`)));

test('security overrides keep the reviewed Paseo base and lock patched dependencies', () => {
    const manifest = JSON.parse(readFileSync(new URL('../tools/package.json', import.meta.url)));
    const lock = JSON.parse(readFileSync(new URL('../tools/package-lock.json', import.meta.url)));
    assert.equal(manifest.dependencies['@getpaseo/cli'], '0.11.4');
    assert.equal(lock.packages['node_modules/@getpaseo/server'].version, '0.11.4');
    assert.equal(manifest.overrides['@hono/node-server'], '2.1.3');
    const overrides = { ...manifest.overrides['@getpaseo/server'],
        '@hono/node-server': manifest.overrides['@hono/node-server'],
        'body-parser': manifest.overrides['body-parser'], 'fast-uri': manifest.overrides['fast-uri'] };
    for (const [name, version] of Object.entries(overrides)) {
        const versions = Object.entries(lock.packages)
            .filter(([path]) => path.endsWith(`node_modules/${name}`))
            .map(([, pkg]) => pkg.version);
        assert.deepEqual([...new Set(versions)], [version], name);
    }
});

test('patched Markdown parser preserves the token API used by chat search', () => {
    const MarkdownIt = serverRequire('markdown-it');
    const markdown = new MarkdownIt({ html: false });
    const tokens = markdown.parse('**보안 검사** [링크](https://example.com)\n\n```js\nconst ok = true;\n```\n', {});
    const inline = tokens.find((token) => token.type === 'inline');
    assert.ok(inline.children.some((token) => token.type === 'text' && token.content === '보안 검사'));
    assert.ok(inline.children.some((token) => token.type === 'text' && token.content === '링크'));
    assert.equal(tokens.find((token) => token.type === 'fence').content, 'const ok = true;\n');
    assert.equal(markdown.render('<script>alert(1)</script>').includes('<script>'), false);
});

test('patched UUID keeps message IDs valid and rejects undersized output buffers', () => {
    const uuid = serverRequire('uuid');
    const id = uuid.v4();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(uuid.validate(id), true);
    assert.throws(() => uuid.v5('paseodog', uuid.v5.DNS, new Uint8Array(1)));
});

test('patched MCP SDK supports tool registration, discovery and calls without external access', async (t) => {
    const [{ McpServer }, { Client }, { InMemoryTransport }] = await Promise.all([
        loadMcp('server/mcp.js'), loadMcp('client/index.js'), loadMcp('inMemory.js'),
    ]);
    const server = new McpServer({ name: 'paseodog-security-test', version: '1.0.0' });
    const client = new Client({ name: 'paseodog-security-client', version: '1.0.0' });
    t.after(async () => { await client.close(); await server.close(); });
    server.registerTool('compatibility-probe', { description: 'Local compatibility check', inputSchema: {} },
        async () => ({ content: [{ type: 'text', text: 'MCP_COMPATIBLE' }] }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name), ['compatibility-probe']);
    const result = await client.callTool({ name: 'compatibility-probe', arguments: {} });
    assert.deepEqual(result.content, [{ type: 'text', text: 'MCP_COMPATIBLE' }]);
});

test('patched Hono Node adapter serves public files without double-decoding past authentication', async (t) => {
    const mcpRequire = createRequire(serverRequire.resolve('@modelcontextprotocol/sdk/server/mcp.js'));
    const { Hono } = mcpRequire('hono');
    const { serve } = mcpRequire('@hono/node-server');
    const { serveStatic } = mcpRequire('@hono/node-server/serve-static');
    const root = mkdtempSync(scratchPath('paseodog-hono-security-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, 'static', 'admin'), { recursive: true });
    writeFileSync(join(root, 'static', 'admin', 'secret.txt'), 'PRIVATE_STATIC_FILE');
    writeFileSync(join(root, 'static', '공개 파일.txt'), 'PUBLIC_STATIC_FILE');

    const app = new Hono();
    app.use('/static/admin/*', (context) => context.text('Unauthorized', 401));
    app.use('/static/*', serveStatic({ root }));
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;

    const publicFile = await fetch(`${base}/static/${encodeURIComponent('공개 파일.txt')}`);
    assert.equal(publicFile.status, 200);
    assert.equal(await publicFile.text(), 'PUBLIC_STATIC_FILE');
    for (const path of ['/static/admin/secret.txt', '/static/%61dmin/secret.txt']) {
        const response = await fetch(base + path);
        assert.equal(response.status, 401, path);
        assert.equal(await response.text(), 'Unauthorized');
    }
    // GHSA-rmxm-3fg6-px4f의 이중 디코딩 입력은 보호 경로로 재해석되면 안 된다.
    const bypass = await fetch(`${base}/static/%%36%31dmin/secret.txt`);
    assert.equal(bypass.status, 404);
    assert.notEqual(await bypass.text(), 'PRIVATE_STATIC_FILE');
});

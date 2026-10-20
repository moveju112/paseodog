import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

const serverRequire = createRequire(new URL('../tools/node_modules/@getpaseo/server/package.json', import.meta.url));
// 실제 Paseo 서버가 해석하는 MCP 모듈을 사용한다.
const loadMcp = (path) => import(pathToFileURL(serverRequire.resolve(`@modelcontextprotocol/sdk/${path}`)));

test('security overrides keep the reviewed Paseo base and lock patched dependencies', () => {
    const manifest = JSON.parse(readFileSync(new URL('../tools/package.json', import.meta.url)));
    const lock = JSON.parse(readFileSync(new URL('../tools/package-lock.json', import.meta.url)));
    assert.equal(manifest.dependencies['@getpaseo/cli'], '0.11.4');
    assert.equal(lock.packages['node_modules/@getpaseo/server'].version, '0.11.4');
    for (const [name, version] of Object.entries(manifest.overrides['@getpaseo/server'])) {
        assert.equal(lock.packages[`node_modules/${name}`].version, version, name);
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

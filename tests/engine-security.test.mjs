import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

const engineRequire = createRequire(new URL('../engine/node_modules/mixdog/package.json', import.meta.url));
const expressRequire = createRequire(createRequire(
    engineRequire.resolve('@modelcontextprotocol/sdk/server/index.js')).resolve('express'));
const bodyParserPath = expressRequire.resolve('body-parser');
const imageSizePath = createRequire(engineRequire.resolve('pptxgenjs')).resolve('image-size');
const undiciPath = engineRequire.resolve('undici');
const webSearchUrl = new URL('../engine/node_modules/mixdog/src/runtime/web-search/index.mjs', import.meta.url).href;

// 취약 입력은 시간 제한이 있는 자식 프로세스에서만 검사하고 실제 프로필·외부 서버를 쓰지 않는다.
function probe(source) {
    const home = mkdtempSync('/data/tmp/ubuntu/paseodog-security-probe-');
    try {
        return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', source], {
            env: { ...process.env, MIXDOG_HOME: home, MIXDOG_DATA_DIR: join(home, 'data') },
            encoding: 'utf8', timeout: 8000, maxBuffer: 128 * 1024,
        }));
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
}

test('every locked instance of the five affected dependencies meets the published fixed version', () => {
    const fixed = {
        'body-parser': [2, 4, 0], 'fast-uri': [3, 1, 9], 'image-size': [2, 0, 3],
        undici: [8, 12, 2], zod: [4, 6, 6],
    };
    const lock = JSON.parse(readFileSync(new URL('../engine/package-lock.json', import.meta.url), 'utf8'));
    for (const [name, minimum] of Object.entries(fixed)) {
        const versions = Object.entries(lock.packages)
            .filter(([path]) => path.split('node_modules/').at(-1) === name)
            .map(([, pkg]) => pkg.version);
        assert.ok(versions.length > 0, name);
        for (const version of versions) {
            assert.match(version, /^\d+\.\d+\.\d+$/);
            const parts = version.split('.').map(Number);
            const difference = parts.map((part, index) => part - minimum[index]).find(value => value !== 0) ?? 0;
            assert.ok(difference >= 0, `${name}@${version}`);
        }
    }
});

test('compressed request bodies with trailing bytes cannot terminate the body-parser process', () => {
    const result = probe(`
        import assert from 'node:assert/strict';
        import { createServer, request } from 'node:http';
        import { gzipSync } from 'node:zlib';
        import { createRequire } from 'node:module';
        const require = createRequire(import.meta.url);
        const parser = require(${JSON.stringify(bodyParserPath)}).json();
        const server = createServer((req, res) => {
            if (req.method === 'GET') { res.writeHead(204); res.end(); return; }
            parser(req, res, error => { res.writeHead(error ? 400 : 200); res.end(); });
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const body = Buffer.concat([gzipSync(Buffer.from('{"fixture":true}')), Buffer.from('trailing bytes')]);
        const attack = await new Promise((resolve, reject) => {
            const req = request({ host: '127.0.0.1', port: server.address().port, method: 'POST', agent: false,
                headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': body.length } },
                res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
            req.on('error', reject);
            req.end(body);
        });
        assert.ok([200, 400].includes(attack));
        await new Promise(resolve => setTimeout(resolve, 100));
        const health = await new Promise((resolve, reject) => {
            const req = request({ host: '127.0.0.1', port: server.address().port, agent: false },
                res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
            req.on('error', reject); req.end();
        });
        assert.equal(health, 204);
        await new Promise(resolve => server.close(resolve));
        console.log(JSON.stringify({ health }));
    `);
    assert.equal(result.health, 204);
});

test('URI normalization never turns an encoded scheme into a live executable or allowlisted scheme', () => {
    const uri = createRequire(engineRequire.resolve('ajv'))('fast-uri');
    for (const input of ['%6Aavascript:alert(1)', '%u006Aavascript:alert(1)', '%68ttp://example.invalid/']) {
        assert.equal(uri.normalize(input), input);
        assert.match(uri.parse(input).error, /scheme is malformed/);
    }
});

test('ICNS, HEIF and JXL zero-size entries are rejected instead of looping indefinitely', () => {
    const result = probe(`
        import assert from 'node:assert/strict';
        import { createRequire } from 'node:module';
        const { imageSize } = createRequire(import.meta.url)(${JSON.stringify(imageSizePath)});
        const icns = Buffer.alloc(16);
        icns.write('icns', 0); icns.writeUInt32BE(16, 4); icns.write('ic07', 8);
        const heif = Buffer.alloc(32);
        heif.writeUInt32BE(24, 0); heif.write('ftyp', 4); heif.write('heic', 8); heif.write('meta', 28);
        const jxl = Buffer.alloc(40);
        jxl.writeUInt32BE(12, 0); jxl.write('JXL ', 4);
        jxl.writeUInt32BE(20, 12); jxl.write('ftyp', 16); jxl.write('jxl ', 20); jxl.write('jxlp', 36);
        for (const bytes of [icns, heif, jxl]) assert.throws(() => imageSize(bytes), /Invalid/);
        console.log(JSON.stringify({ rejected: 3 }));
    `);
    assert.equal(result.rejected, 3);
});

test('excessive response content encodings reject fetch without an unhandled stream error', () => {
    const result = probe(`
        import assert from 'node:assert/strict';
        import { createServer } from 'node:http';
        import { createRequire } from 'node:module';
        const { fetch } = createRequire(import.meta.url)(${JSON.stringify(undiciPath)});
        const server = createServer((_req, res) => {
            res.writeHead(200, { 'content-encoding': 'gzip,gzip,gzip,gzip,gzip,gzip', 'content-length': '50' });
            res.end();
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        await assert.rejects(fetch('http://127.0.0.1:' + server.address().port + '/'), TypeError);
        await new Promise(resolve => setTimeout(resolve, 100));
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        console.log(JSON.stringify({ survived: true }));
    `);
    assert.equal(result.survived, true);
});

test('oversized Zod collections fail their size bounds before parsing any elements', () => {
    const { z } = engineRequire('zod');
    let visited = 0;
    const element = z.string().superRefine(() => { visited++; });
    for (const schema of [z.array(element).max(2), z.array(element).length(2)]) {
        const result = schema.safeParse(Array(10000).fill('fixture'));
        assert.equal(result.success, false);
        assert.equal(result.error.issues.length, 1);
        assert.equal(result.error.issues[0].code, 'too_big');
    }
    assert.equal(visited, 0);
});

test('the engine MCP SDK registers and calls tools with the patched Zod schema', async (t) => {
    const load = path => import(pathToFileURL(engineRequire.resolve(`@modelcontextprotocol/sdk/${path}`)));
    const [{ McpServer }, { Client }, { InMemoryTransport }] = await Promise.all([
        load('server/mcp.js'), load('client/index.js'), load('inMemory.js'),
    ]);
    const { z } = engineRequire('zod');
    const server = new McpServer({ name: 'engine-security-test', version: '1.0.0' });
    const client = new Client({ name: 'engine-security-client', version: '1.0.0' });
    t.after(async () => { await client.close(); await server.close(); });
    server.registerTool('echo', { inputSchema: { value: z.string().max(16) } },
        async ({ value }) => ({ content: [{ type: 'text', text: value }] }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    assert.equal((await client.listTools()).tools[0].inputSchema.properties.value.type, 'string');
    assert.deepEqual((await client.callTool({ name: 'echo', arguments: { value: 'MCP_COMPATIBLE' } })).content,
        [{ type: 'text', text: 'MCP_COMPATIBLE' }]);
});

test('the actual search handler preserves Zod error details and rejects more than ten URLs before fetching', () => {
    const result = probe(`
        import assert from 'node:assert/strict';
        globalThis.fetch = async () => assert.fail('Invalid input must not contact an external service');
        const web = await import(${JSON.stringify(webSearchUrl)});
        try {
            const replies = [
                await web.handleToolCall('web_search', { query: [] }),
                await web.handleToolCall('web_fetch', { url: Array(11).fill('https://example.invalid/') }),
            ];
            for (const reply of replies) {
                assert.equal(reply.isError, true);
                const error = JSON.parse(reply.content[0].text);
                assert.equal(error.error, 'Invalid arguments');
                assert.ok(Array.isArray(error.details) && error.details.length > 0);
            }
            console.log(JSON.stringify({ rejected: replies.length }));
        } finally { await web.stop(); }
    `);
    assert.equal(result.rejected, 2);
});

function pngPixel() {
    const checksum = bytes => {
        let crc = 0xffffffff;
        for (const byte of bytes) {
            crc ^= byte;
            for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
        return (crc ^ 0xffffffff) >>> 0;
    };
    const chunk = (type, bytes) => {
        const payload = Buffer.concat([Buffer.from(type), bytes]);
        const header = Buffer.alloc(4), crc = Buffer.alloc(4);
        header.writeUInt32BE(bytes.length); crc.writeUInt32BE(checksum(payload));
        return Buffer.concat([header, payload, crc]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
        chunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, 255]))), chunk('IEND', Buffer.alloc(0)),
    ]);
}

test('PptxGenJS still exports an embedded image with the patched image-size dependency', async () => {
    const PptxGenJS = engineRequire('pptxgenjs');
    const JSZip = engineRequire('jszip');
    const { imageSize } = engineRequire(imageSizePath);
    const image = pngPixel();
    assert.deepEqual({ width: imageSize(image).width, height: imageSize(image).height }, { width: 1, height: 1 });
    const presentation = new PptxGenJS();
    const slide = presentation.addSlide();
    slide.addText('Security compatibility fixture', { x: 1, y: 1, w: 4, h: 1 });
    slide.addImage({ data: 'image/png;base64,' + image.toString('base64'), x: 1, y: 2, w: 1, h: 1 });
    const archive = await JSZip.loadAsync(await presentation.write({ outputType: 'nodebuffer' }));
    assert.ok(archive.file('ppt/presentation.xml'));
    assert.equal(archive.file(/^ppt\/media\/.*\.png$/).length, 1);
});

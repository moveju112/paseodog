import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJsonLineDecoder } from '../plugin/server/json-lines.mjs';
import { serveWorker } from '../engine/src/worker.mjs';
import { createProviderConnection } from '../plugin/server/connection.mjs';
import { MemoryJournalStore } from '../plugin/server/journal.mjs';
import { processEngineFactory } from '../plugin/server/process-engine.mjs';
import { validateConfig, hash } from '../plugin/server/util.mjs';
import { createNativeEngine } from '../engine/src/native-engine.mjs';
import { fixture, until, delay, deferred } from './helpers.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
function workerHarness(engine) {
    const input = new PassThrough(), output = new PassThrough(), frames = [];
    const decoder = createJsonLineDecoder((x) => frames.push(x), (e) => { throw e; });
    output.on('data', (chunk) => decoder.write(chunk));
    const server = serveWorker({ input, output, engineFactory: async () => engine, closeMs: 100 });
    const send = (id, op, args = {}) => input.write(JSON.stringify({ v: 1, id, op, args }) + '\n');
    return { frames, server, send };
}
test('late old-turn text, identity and approval cannot be attributed to a new turn', async () => {
    let oldCallbacks;
    const gate = deferred();
    const h = workerHarness({ id: 'sess',
        async ask(text, callbacks) {
            if (text === 'old') { oldCallbacks = callbacks; return { content: 'old-result' }; }
            return gate.promise;
        }, abort() { gate.resolve({ content: 'stopped' }); }, close() {} });
    try {
        h.send('open', 'open'); await until(h.frames, (x) => x.id === 'open');
        h.send('old-turn', 'ask', { text: 'old' }); await until(h.frames, (x) => x.id === 'old-turn');
        h.send('new-turn', 'ask', { text: 'new' }); await delay(15);
        oldCallbacks.onTextDelta('STALENESS');
        oldCallbacks.onIdentity({ id: 'wrong-id' });
        const answer = await oldCallbacks.onToolApproval({ name: 'shell', args: { command: 'danger' } });
        assert.equal(answer.approved, false);
        assert.equal(h.frames.some((x) => x.event === 'permission'), false);
        assert.equal(h.frames.some((x) => x.token === 'new-turn' && JSON.stringify(x.payload).includes('STALENESS')), false);
        assert.equal(h.frames.some((x) => x.event === 'identity' && x.payload.id === 'wrong-id'), false);
        gate.resolve({ content: 'new-result' });
        assert.equal((await until(h.frames, (x) => x.id === 'new-turn')).ok, true);
    } finally { await h.server.stop('test'); }
});
test('tool results larger than IPC cap are presented as bounded UI previews', async () => {
    const h = workerHarness({ id: 'sess', async ask(_t, cb) {
        cb.onToolResult({ toolCallId: 'big', content: 'x'.repeat(3 * 1024 * 1024) });
        return { content: 'model saw original input' };
    }, abort() {}, close() {} });
    try {
        h.send('open', 'open'); await until(h.frames, (x) => x.id === 'open');
        h.send('big', 'ask', { text: 'read' });
        const result = await until(h.frames, (x) => x.id === 'big');
        assert.equal(result.ok, true);
        const event = h.frames.find((x) => x.event === 'onToolResult');
        assert.ok(event); assert.ok(JSON.stringify(event).length < 25000);
        assert.match(event.payload[0].content, /UI preview truncated/);
    } finally { await h.server.stop('test'); }
});
test('manual compaction reports real usage deltas when supplied by native engine', async () => {
    const f = fixture({ async compact() { return { changed: true, usageDelta: {
        deltaInput: 500, deltaCachedRead: 100, deltaOutput: 50, deltaCacheWrite: 12,
    } }; } });
    try {
        await f.ready();
        await f.run({ ...f.prompt, prompt: { ...f.prompt.prompt, input: { type: 'command', name: 'compact', arguments: '' } } });
        const e = f.events.find((x) => x.type === 'session.usage');
        assert.deepEqual(e.usage, { inputTokens: 500, cachedInputTokens: 100, outputTokens: 50 });
        assert.deepEqual(Object.values(f.store.list()[0].usage)[0], {
            inputTokens: 500, cachedInputTokens: 100, outputTokens: 50, cacheWriteTokens: 12,
        });
    } finally { await f.connection.close(); }
});
test('native compaction counters preserve actual usage independently of context reduction', async () => {
    const session = { totalInputTokens: 10, totalOutputTokens: 2, totalCachedReadTokens: 3, totalCacheWriteTokens: 1 };
    const runtime = { id: 's', session,
        ask() {}, abort() {}, close() {}, resume() {},
        compact() { Object.assign(session, { totalInputTokens: 110, totalOutputTokens: 22,
            totalCachedReadTokens: 8, totalCacheWriteTokens: 3 }); return { changed: true, beforeTokens: 900, afterTokens: 600 }; },
    };
    const engine = await createNativeEngine({ config: { cwd: '/work', mcpServers: {} } }, {
        modules: { loadConfig: () => ({}), createMixdogSessionRuntime: async () => runtime },
    });
    try {
        const result = await engine.compact();
        assert.deepEqual(result.usageDelta, { deltaInput: 100, deltaOutput: 20, deltaCachedRead: 5, deltaCacheWrite: 2 });
        assert.equal(result.beforeTokens - result.afterTokens, 300);
    } finally { await engine.close(); }
});
test('unexpected worker death notifies provider and rejects new turn before acknowledgement', async () => {
    const events = [];
    const script = fileURLToPath(new URL('./fixtures/worker-fixture.mjs', import.meta.url));
    const factory = processEngineFactory({ launch: { command: process.execPath, args: [script], env: { ...process.env } },
        spawnProcess: spawn, terminateProcess: (c) => c.kill('SIGKILL'), timeoutMs: 3000, stopMs: 150, scopeMode: 'test-only-process-group' });
    const connection = createProviderConnection({ store: new MemoryJournalStore(), engineFactory: factory,
        flushMs: 2, stopMs: 200 });
    connection.onEvent((x) => events.push(x));
    const prompt = (id, text) => ({ type: 'session.prompt', sessionId: 'p', prompt: {
        clientMessageId: id, delivery: 'auto', input: { type: 'message', content: [{ type: 'text', text }] },
    } });
    try {
        await connection.send({ type: 'session.open', requestId: 'open', sessionId: 'p', history: 'skip',
            config: { cwd: tmpdir(), env: {}, mcpServers: {}, settings: {}, persist: true } });
        await until(events, (x) => x.type === 'session.ready');
        await connection.send(prompt('first', 'crash'));
        await until(events, (x) => x.type === 'session.runtime_failed');
        await connection.send(prompt('second', 'normal'));
        const result = await until(events, (x) => x.type === 'session.prompt_result' && x.clientMessageId === 'second');
        assert.equal(result.result.type, 'failed');
        assert.equal(events.filter((x) => x.type === 'session.runtime_failed').length, 1);
    } finally { await connection.close().catch(() => {}); }
});
test('unknown settings and credential-profile environment overrides fail closed', () => {
    const template = { cwd: '/work', env: {}, mcpServers: {}, settings: {}, persist: true };
    assert.throws(() => validateConfig({ ...template, settings: { fakeSetting: true } }), /Unsupported session settings/);
    for (const key of ['MIXDOG_HOME', 'MIXDOG_DATA_DIR', 'PASEO_HOME', 'NODE_OPTIONS', 'PASEODOG_STATE_DIR']) {
        assert.throws(() => validateConfig({ ...template, env: { [key]: '/outside' } }), /Reserved environment/);
    }
});
test('journal recovery disk-write failure releases ownership, permitting explicit retry', async () => {
    const store = new MemoryJournalStore(); const f = fixture({}, { store });
    await f.ready();
    const persistence = f.events.find((x) => x.type === 'session.opened').persistence;
    await f.connection.close();
    const id = persistence.data.bridgeId, record = store.load(id), key = hash('older');
    record.active = { turnId: 'older', receiptKey: key }; record.receipts[key] = { state: 'running' }; store.save(record);
    const save = store.save.bind(store); let failOnce = true;
    store.save = (r) => { if (failOnce) { failOnce = false; throw new Error('ENOSPC'); } return save(r); };
    const g = fixture({}, { store });
    try {
        await g.connection.send({ ...g.open, persistence });
        const error = await until(g.events, (x) => x.type === 'request.failed');
        assert.match(error.error.message, /ENOSPC/);
        assert.equal(store.locks.has(id), false);
        await g.connection.send({ ...g.open, requestId: 'retry', persistence });
        await until(g.events, (x) => x.type === 'session.ready');
        assert.equal(store.locks.has(id), true);
    } finally { await g.connection.close().catch(() => {}); }
});
test('native restore rejects different provider/model before the first inference', async () => {
    let asks = 0, closes = 0;
    const runtime = { id: 's', ask() { asks++; }, abort() {}, close() { closes++; }, compact() {},
        resume() { return { id: 's', cwd: '/work', provider: 'bad-provider', model: 'bad-model' }; },
        session: { remoteAttached: false },
    };
    await assert.rejects(createNativeEngine({ config: { cwd: '/work', mcpServers: {} },
        route: { provider: 'expected', model: 'expected-model' }, nativeSessionId: 's' }, {
        modules: { loadConfig: () => ({}), createMixdogSessionRuntime: async () => runtime },
    }), /differs from the saved model route/);
    assert.equal(asks, 0); assert.equal(closes, 1);
});
test('PaseoDog profiles ignore ambient Mixdog state directory', async () => {
    const path = await import('../scripts/paths.mjs');
    const ambient = process.env.MIXDOG_DATA_DIR;
    try {
        process.env.MIXDOG_DATA_DIR = '/untrusted/elsewhere';
        assert.equal(path.runtimeEnv().MIXDOG_DATA_DIR, path.mixdogDataDir);
        assert.equal(path.runtimeEnv().MIXDOG_HOME, path.mixdogHome);
        assert.equal(path.runtimeEnv().NODE_OPTIONS, undefined);
    } finally {
        if (ambient === undefined) delete process.env.MIXDOG_DATA_DIR;
        else process.env.MIXDOG_DATA_DIR = ambient;
    }
});
test('CLI detects run after global host option, keeps explicit provider choices', () => {
    const root = mkdtempSync(join(tmpdir(), 'paseodog-cli-'));
    try {
        for (const rel of ['bin/paseodog.mjs', 'scripts/paths.mjs', 'plugin/server/util.mjs', 'plugin/shared/release.json', 'package.json']) {
            mkdirSync(join(root, rel, '..'), { recursive: true }); copyFileSync(join(repoRoot, rel), join(root, rel));
        }
        const fake = join(root, 'tools/node_modules/@getpaseo/cli/bin/paseo'); mkdirSync(join(fake, '..'), { recursive: true });
        writeFileSync(fake, '#!/usr/bin/env node\nconsole.log(JSON.stringify({argv:process.argv.slice(2),dir:process.env.MIXDOG_DATA_DIR}));', { mode: 0o755 });
        const invoke = (argv) => {
            const result = spawnSync(process.execPath, [join(root, 'bin/paseodog.mjs'), ...argv], {
                env: { ...process.env, MIXDOG_DATA_DIR: '/other/data', PASEODOG_HOME: join(root, 'state') },
                encoding: 'utf8',
            });
            assert.equal(result.status, 0, result.stderr);
            return JSON.parse(result.stdout);
        };
        const standard = invoke(['run', 'test']);
        const remote = invoke(['--host', 'host.example:6767', 'run', 'test']);
        const explicit = invoke(['--host', 'host.example:6767', 'run', '--provider', 'claude', 'test']);
        assert.ok(standard.argv.includes('paseodog'));
        assert.deepEqual(remote.argv.slice(-4), ['run', '--provider', 'paseodog', 'test']);
        assert.equal(explicit.argv.filter((x) => x === '--provider').length, 1);
        assert.equal(remote.dir, join(root, 'state/mixdog/data'));
    } finally { rmSync(root, { recursive: true, force: true }); }
});
test('packager ignores custom state directory and credential files not on reviewed allowlist', () => {
    const root = mkdtempSync(join(tmpdir(), 'paseodog-package-'));
    try {
        // NEVER create or remove state under repoRoot: install.sh also runs npm test.
        // Exercise the packager on a separate copy of exactly the reviewed sources.
        const sandbox = join(root, 'source');
        mkdirSync(sandbox, { recursive: true });
        const manifest = readFileSync(join(repoRoot, 'MANIFEST.sha256'), 'utf8');
        for (const line of manifest.split('\n').filter(Boolean)) {
            const relative = line.slice(66);
            if (!/^[a-f0-9]{64}  /.test(line) || !relative || relative.startsWith('/') || relative.split('/').includes('..')) {
                throw new Error('Unsafe fixture manifest path');
            }
            const destination = join(sandbox, relative);
            mkdirSync(join(destination, '..'), { recursive: true });
            copyFileSync(join(repoRoot, relative), destination);
        }
        writeFileSync(join(sandbox, 'MANIFEST.sha256'), manifest);
        const bad = join(sandbox, 'state', 'mixdog', 'data', 'auth.json');
        mkdirSync(join(bad, '..'), { recursive: true });
        writeFileSync(bad, '{"token":"NOT_REAL"}');
        const output = join(root, 'release.zip');
        const proc = spawnSync('python3', ['scripts/package.py', '--output', output], { cwd: sandbox, encoding: 'utf8' });
        assert.equal(proc.status, 0, proc.stderr);
        const scan = spawnSync('python3', ['-c', `import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1]) as z:\n assert not any('state/' in x or 'auth.json' in x for x in z.namelist())`, output], { encoding: 'utf8' });
        assert.equal(scan.status, 0, scan.stderr);
        assert.equal(readFileSync(bad, 'utf8'), '{"token":"NOT_REAL"}', 'Test must not delete even its sandbox input state');
    } finally { rmSync(root, { recursive: true, force: true }); }
});
const orphanWorker = fileURLToPath(new URL('./fixtures/orphan-worker.mjs', import.meta.url));
test('Linux force-kill stops a worker and its shell descendants', { skip: process.platform !== 'linux' }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'paseodog-orphans-'));
    const heartbeat = join(root, 'heartbeat'), pidfile = join(root, 'pid'); let pid, engine;
    const factory = processEngineFactory({ launch: { command: process.execPath, args: [orphanWorker],
        env: { ...process.env, REPRO_HEARTBEAT: heartbeat, REPRO_PIDFILE: pidfile } },
        spawnProcess: spawn, terminateProcess: (c) => c.kill('SIGKILL'), timeoutMs: 1000, stopMs: 100, scopeMode: 'test-only-process-group' });
    try {
        engine = await factory.create({ config: { cwd: root, env: {}, mcpServers: {}, settings: {}, persist: true } });
        const task = engine.ask('spawn-child', {}).catch((e) => e);
        for (let n = 0; n < 180 && !existsSync(heartbeat); n++) await delay(8);
        assert.ok(existsSync(heartbeat));
        pid = Number(readFileSync(pidfile, 'utf8'));
        await engine.kill(); await task;
        await delay(50); const before = readFileSync(heartbeat).length;
        await delay(70); const after = readFileSync(heartbeat).length;
        assert.equal(after, before, 'A descendant continued executing after kill completed');
    } finally {
        if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} }
        await engine?.close().catch(() => {});
        rmSync(root, { recursive: true, force: true });
    }
});

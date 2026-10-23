import test from 'node:test';
import assert from 'node:assert/strict';
import { createProcessScope } from '../plugin/server/process-scope.mjs';
import { processEngineFactory } from '../plugin/server/process-engine.mjs';
import { createProviderConnection } from '../plugin/server/connection.mjs';
import { MemoryJournalStore } from '../plugin/server/journal.mjs';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { delay, until } from './helpers.mjs';

const unitName = `paseodog-${'a'.repeat(32)}.scope`;
const launch = { command: '/usr/bin/node', args: ['worker.mjs'], env: { PATH: process.env.PATH } };

test('strict Linux scope confines worker independently of Unix process groups', async () => {
    const calls = []; let reads = 0;
    const scope = createProcessScope({ launch, platform: 'linux', unitName,
        runCommand: async (cmd, argv) => {
            calls.push({ cmd, argv });
            if (argv.includes('--help')) return { stdout: '  --kill-whom=WHOM  Whom to send signal to\n' };
            return { stdout: argv.includes('show') ? '/user.slice/user-1000.slice/example.scope\n' : '' };
        },
        readCgroupEvents: async () => reads++ === 0 ? 'populated 1\nfrozen 0\n' : 'populated 0\nfrozen 0\n',
        sleep: async () => {},
    });
    assert.equal(scope.kind, 'systemd-user-cgroup');
    assert.equal(scope.command, '/usr/bin/systemd-run');
    assert.ok(scope.args.includes('--scope'));
    assert.ok(scope.args.includes(`--unit=${unitName}`));
    assert.ok(scope.args.includes('--property=KillMode=control-group'));
    assert.equal(scope.detached, false);
    await scope.preflight();
    await scope.stop();
    assert.equal(reads, 2);
    assert.deepEqual(calls.filter(x => x.argv.includes('stop')).map(x => x.argv.slice(0, 4)),
        [['--user', 'stop', '--no-block', unitName]]);
    assert.deepEqual(calls.filter(x => x.argv.includes('kill')).map(x => x.argv),
        [['--user', 'kill', '--kill-whom=all', '--signal=SIGKILL', unitName]]);
});

test('strict Linux scope selects the legacy systemd kill option once and still verifies an empty cgroup', async () => {
    const calls = [];
    let reads = 0;
    const scope = createProcessScope({ launch, platform: 'linux', unitName,
        runCommand: async (_cmd, argv) => {
            calls.push(argv);
            if (argv.includes('--help')) return { stdout: '  --kill-who=WHO  Whom to send signal to\n' };
            if (argv.includes('show')) return { stdout: '/user.slice/example.scope\n' };
            if (argv.includes('kill')) {
                assert.deepEqual(argv, ['--user', 'kill', '--kill-who=all', '--signal=SIGKILL', unitName]);
            }
            return { stdout: '' };
        },
        readCgroupEvents: async () => { reads++; return 'populated 0\n'; },
    });
    await scope.preflight();
    await scope.stop();
    assert.equal(calls.filter(argv => argv.includes('--help')).length, 1);
    assert.equal(calls.filter(argv => argv.includes('kill')).length, 1);
    assert.equal(reads, 1);
});

test('strict Linux scope refuses to spawn without a supported whole-scope kill option', async () => {
    const scope = createProcessScope({ launch, platform: 'linux', unitName,
        runCommand: async () => ({ stdout: 'systemctl help without a supported kill option\n' }) });
    const factory = processEngineFactory({ launch, spawnProcess() { throw new Error('must not spawn'); },
        terminateProcess() {}, scopeFactory: () => scope });
    await assert.rejects(factory.create({ config: { cwd: tmpdir(), env: {} } }),
        /systemctl must support --kill-whom or --kill-who/);
});

test('without systemd user manager strict Linux mode fails BEFORE spawning native process', async () => {
    const scope = createProcessScope({ launch, platform: 'linux', unitName,
        runCommand: async () => { throw new Error('Failed to connect to user bus'); } });
    await assert.rejects(scope.preflight(), /systemd --user manager is required/);
    const factory = processEngineFactory({ launch, spawnProcess() { throw new Error('must not spawn'); },
        terminateProcess() {}, scopeFactory: () => scope });
    await assert.rejects(factory.create({ config: { cwd: tmpdir(), env: {} } }), /systemd --user manager is required/);
});

test('Linux worker exit is detected before inherited pipes close, pending RPC fails and child is reaped',
    { skip: process.platform !== 'linux' }, async () => {
        const dir = mkdtempSync(join(tmpdir(), 'paseodog-exit-pipe-'));
        const env = { ...process.env, REPRO_HEARTBEAT: join(dir, 'heartbeat'), REPRO_PIDFILE: join(dir, 'pid') };
        const script = fileURLToPath(new URL('./fixtures/exit-pipe-worker.mjs', import.meta.url));
        const factory = processEngineFactory({ launch: { command: process.execPath, args: [script], env },
            spawnProcess: spawn, terminateProcess: c => c.kill('SIGKILL'), timeoutMs: 4000,
            stopMs: 180, scopeMode: 'test-only-process-group' });
        let engine, task, childPid, observed = 0;
        try {
            engine = await factory.create({ config: { cwd: dir, env: {} } });
            engine.onCrash(() => { observed++; });
            task = assert.rejects(engine.ask('start', {}), /Engine exited/);
            for (let n = 0; n < 100 && !existsSync(env.REPRO_HEARTBEAT); n++) await delay(8);
            assert.ok(existsSync(env.REPRO_HEARTBEAT), 'Fixture did not launch a child');
            childPid = Number(readFileSync(env.REPRO_PIDFILE, 'utf8'));
            await Promise.race([task, delay(700).then(() => { throw Error('Still hung on descendant-held stdout'); })]);
            assert.equal(observed, 1);
            await engine.kill();
            await delay(45);
            const before = readFileSync(env.REPRO_HEARTBEAT).length;
            await delay(70);
            assert.equal(readFileSync(env.REPRO_HEARTBEAT).length, before, 'Same-group descendant survived forced cleanup');
        } finally {
            if (childPid) { try { process.kill(childPid, 'SIGKILL'); } catch {} }
            await engine?.close().catch(() => {});
            await task?.catch(() => {});
            rmSync(dir, { recursive: true, force: true });
        }
    });

test('actual worker+bridge never acknowledges a text reset or sends a shrinking same-id snapshot', async () => {
    const worker = fileURLToPath(new URL('./fixtures/worker-fixture.mjs', import.meta.url));
    const factory = processEngineFactory({ launch: { command: process.execPath, args: [worker], env: process.env },
        spawnProcess: spawn, terminateProcess: c => c.kill('SIGKILL'), timeoutMs: 2500, stopMs: 160,
        scopeMode: 'test-only-process-group' });
    const connection = createProviderConnection({ store: new MemoryJournalStore(), engineFactory: factory,
        stopMs: 450, flushMs: 2 });
    const events = [];
    connection.onEvent(e => events.push(e));
    try {
        await connection.send({ type: 'session.open', requestId: 'open', sessionId: 't', history: 'skip',
            config: { cwd: tmpdir(), env: {}, mcpServers: {}, settings: {}, persist: true } });
        await until(events, e => e.type === 'session.ready');
        await connection.send({ type: 'session.prompt', sessionId: 't', prompt: {
            clientMessageId: 'user-1', delivery: 'auto', input: { type: 'message', content: [{ type: 'text', text: 'normal' }] },
        } });
        await until(events, e => e.type === 'session.turn' && e.state === 'completed');
        const seen = new Map(), deltas = [];
        for (const { item } of events.filter(e => e.type === 'timeline.item' && e.item?.type === 'assistant_message')) {
            const before = seen.get(item.id) || '';
            const next = item.text;
            // Pinned Paseo core maps snapshots to append-only deltas.
            assert.ok(next.startsWith(before), 'A snapshot retracted already displayed text');
            deltas.push(next.slice(before.length)); seen.set(item.id, next);
        }
        assert.equal(deltas.join(''), 'child result');
        assert.equal([...seen.values()].at(-1), 'child result');
    } finally { await connection.close().catch(() => {}); }
});

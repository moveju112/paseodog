import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, watch } from 'node:fs';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scratchPath } from '../scripts/paths.mjs';
import { createProviderConnection } from '../plugin/server/connection.mjs';
import { processEngineFactory } from '../plugin/server/process-engine.mjs';
import { MemoryJournalStore } from '../plugin/server/journal.mjs';
import { SESSION_TITLE_PATCHES, patchedSessionTitleSource } from '../scripts/patch-paseo-session-titles.mjs';
import { fixture, until } from './helpers.mjs';
import { AgentFeatureSchema, AgentStatusSchema } from '../tools/node_modules/@getpaseo/server/dist/server/server/messages.js';
import { AgentOwnerSchema } from '../tools/node_modules/@getpaseo/server/dist/server/server/agent/agent-owner.js';

const base = new URL('../tools/node_modules/@getpaseo/server/dist/server/server/', import.meta.url);
const require = createRequire(new URL('../plugin/package.json', import.meta.url));
const { z } = require('zod');
const sourceFor = file => {
    const spec = SESSION_TITLE_PATCHES.find(spec => spec.file === file);
    return patchedSessionTitleSource(readFileSync(new URL(file, base), 'utf8'), spec);
};

test('Linux service signals its owner first and retains bounded whole-group cleanup', { skip: process.platform !== 'linux' }, t => {
    const directory = mkdtempSync(scratchPath('paseodog-shutdown-service-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/service.mjs', import.meta.url)), '--install'], {
        env: { ...process.env, HOME: directory, PASEODOG_HOME: join(directory, 'state') },
    });
    const unit = readFileSync(join(directory, '.config/systemd/user/paseodog.service'), 'utf8');
    assert.match(unit, /\nKillMode=mixed\n/);
    assert.match(unit, /\nTimeoutStopSec=30\n/);
});

test('real systemd owner closes its worker before bound scope teardown without false failures', {
    skip: process.platform !== 'linux' || process.env.PASEODOG_TEST_SYSTEMD !== 'true', timeout: 20000,
}, async t => {
    const directory = mkdtempSync(scratchPath('paseodog-systemd-shutdown-'));
    const logPath = join(directory, 'events.jsonl');
    const unit = `paseodog-shutdown-test-${randomUUID().replaceAll('-', '')}.service`;
    const execute = promisify(execFile);
    const events = [];
    let stopped = false;
    writeFileSync(logPath, '');
    const refresh = () => events.splice(0, events.length,
        ...readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)));
    const watcher = watch(logPath, refresh);
    t.after(async () => {
        watcher.close();
        if (!stopped) await execute('systemctl', ['--user', 'stop', unit], { timeout: 15000 });
        rmSync(directory, { recursive: true, force: true });
    });
    await execute('systemd-run', ['--user', `--unit=${unit}`, '--collect', '--service-type=exec',
        '--property=KillMode=mixed', '--property=TimeoutStopSec=8s',
        process.execPath, fileURLToPath(new URL('./fixtures/shutdown-owner.mjs', import.meta.url)), logPath],
    { timeout: 5000 });
    await until(events, event => event.type === 'session.ready', 7000);
    await execute('systemctl', ['--user', 'stop', unit], { timeout: 15000 });
    stopped = true;
    refresh();
    assert.equal(events.some(event => event.type === 'owner.failed' || event.type === 'session.runtime_failed'), false);
    assert.ok(events.some(event => event.type === 'owner.stopped'));
    assert.equal(events.some(event => event.type === 'session.closed'), false,
        'the bound worker must not exit independently before its owner closes the connection');
});

for (const signal of ['SIGTERM', 'SIGKILL']) {
    test(`idle worker ${signal} closes cleanly only for an orderly stop and can resume from persistence`,
        { skip: process.platform === 'win32' }, async t => {
        let child;
        const store = new MemoryJournalStore();
        const factory = processEngineFactory({
            launch: { command: process.execPath, args: [fileURLToPath(new URL('./fixtures/worker-fixture.mjs', import.meta.url))], env: process.env },
            spawnProcess: (...args) => { child = spawn(...args); return child; },
            terminateProcess: process => process.kill('SIGKILL'),
            timeoutMs: 2500, stopMs: 200, scopeMode: 'test-only-process-group',
        });
        const connection = createProviderConnection({ store, engineFactory: factory, stopMs: 800, flushMs: 2 });
        t.after(() => connection.close());
        const events = [];
        connection.onEvent(event => events.push(event));
        const open = {
            type: 'session.open', requestId: 'open', sessionId: 'first', history: 'skip',
            config: { cwd: tmpdir(), env: {}, mcpServers: {}, settings: {}, persist: true },
        };
        await connection.send(open);
        await until(events, event => event.type === 'session.ready');
        const persistence = events.find(event => event.type === 'session.opened').persistence;
        await connection.send({ type: 'session.prompt', sessionId: 'first', prompt: {
            clientMessageId: 'completed', delivery: 'auto', input: { type: 'message', content: [{ type: 'text', text: 'normal' }] },
        } });
        await until(events, event => event.type === 'session.turn' && event.state === 'completed');
        const turnCount = events.filter(event => event.type === 'session.turn').length;
        child.kill(signal);
        if (signal === 'SIGKILL') {
            await until(events, event => event.type === 'session.runtime_failed');
            assert.equal(events.some(event => event.type === 'session.closed'), false);
            return;
        }
        await until(events, event => event.type === 'session.closed');
        assert.equal(events.some(event => event.type === 'session.runtime_failed'), false);
        assert.equal(store.list()[0].active, null);
        await connection.send({ ...open, requestId: 'resume', sessionId: 'second', persistence, history: 'replay' });
        await until(events, event => event.type === 'session.ready' && event.sessionId === 'second');
        assert.equal(events.filter(event => event.type === 'session.turn').length, turnCount,
            'idle recovery must not replay a prompt');
        assert.equal(store.list()[0].nativeSessionId, 'sess_child');
    });
}

test('a zero exit with an in-flight request is not mistaken for idle shutdown', async t => {
    let crash;
    const f = fixture({ onCrash(listener) { crash = listener; return () => {}; } });
    t.after(() => f.connection.close());
    await f.ready();
    crash(Object.assign(new Error('exit'), { exit: { code: 0, signal: null, pendingRequests: 1 } }));
    await until(f.events, event => event.type === 'session.runtime_failed');
    assert.equal(f.events.some(event => event.type === 'session.closed'), false);
});

test('failed containment after an idle stop remains an explicit runtime failure', async t => {
    let crash;
    const f = fixture({
        onCrash(listener) { crash = listener; return () => {}; },
        async close() { throw new Error('cleanup failed'); },
        async kill() { throw new Error('cleanup failed'); },
    });
    t.after(() => f.connection.close());
    await f.ready();
    crash(Object.assign(new Error('exit'), { exit: { code: 0, signal: null, pendingRequests: 0 } }));
    await until(f.events, event => event.type === 'session.runtime_failed');
    assert.ok(f.events.some(event => event.type === 'session.notice' && event.notice.severity === 'error'));
    assert.equal(f.events.some(event => event.type === 'session.closed'), false);
});

test('stored healthy idle attention is reconciled without hiding real failures or other providers', () => {
    const source = sourceFor('agent/agent-storage.js');
    const schema = source.slice(source.indexOf('const SERIALIZABLE_CONFIG_SCHEMA'), source.indexOf('export class AgentStorage'));
    const parse = new Function('z', 'AgentFeatureSchema', 'AgentStatusSchema', 'AgentOwnerSchema',
        schema.replaceAll('export ', '') + '\nreturn parseStoredAgentRecord;')(z, AgentFeatureSchema, AgentStatusSchema, AgentOwnerSchema);
    const record = {
        id: 'session', provider: 'paseodog', cwd: '/test', createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z', lastStatus: 'idle', lastError: null,
        requiresAttention: true, attentionReason: 'error', attentionTimestamp: '2026-01-01T00:00:00Z',
    };
    assert.deepEqual([parse(record).requiresAttention, parse(record).attentionReason, parse(record).attentionTimestamp],
        [false, null, null]);
    assert.equal(record.requiresAttention, true, 'parsing must not mutate its input');
    for (const patch of [{ lastStatus: 'error' }, { lastError: 'real failure' }, { provider: 'codex' },
        { attentionReason: 'permission' }, { attentionReason: 'finished' }]) {
        const result = parse({ ...record, ...patch });
        assert.equal(result.requiresAttention, true);
        assert.equal(result.attentionReason, patch.attentionReason ?? 'error');
    }
});

test('live recovered attention agrees in shared server source and the gated daemon patch', () => {
    const native = stripTypeScriptTypes(readFileSync(new URL('../android/packages/server/src/server/agent/agent-manager.ts', import.meta.url), 'utf8'));
    for (const source of [native, sourceFor('agent/agent-manager.js')]) {
        const start = source.search(/\n\s*checkAndSetAttention\(agent\s*\)\s*\{/);
        assert.notEqual(start, -1);
        const method = source.slice(start, source.indexOf('enqueueBackgroundPersist(', start));
        const Manager = new Function(`return class { ${method} };`)();
        const manager = new Manager();
        manager.previousStatuses = new Map();
        manager.broadcastAgentAttention = () => {};
        const agent = {
            id: 'session', provider: 'paseodog', lifecycle: 'idle',
            attention: { requiresAttention: true, attentionReason: 'error', attentionTimestamp: new Date() },
        };
        manager.checkAndSetAttention(agent);
        assert.deepEqual(agent.attention, { requiresAttention: false });
        agent.lifecycle = 'error'; agent.lastError = 'real failure';
        manager.checkAndSetAttention(agent);
        assert.equal(agent.attention.attentionReason, 'error');
        agent.lifecycle = 'idle';
        manager.checkAndSetAttention(agent);
        assert.equal(agent.attention.attentionReason, 'error', 'an unresolved error must remain visible');
    }
});

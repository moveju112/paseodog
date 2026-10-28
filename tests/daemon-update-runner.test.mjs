import test from 'node:test';
import assert from 'node:assert/strict';
import { scratchPath } from '../scripts/paths.mjs';
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createDaemonUpdater, executeDaemonUpdate, updateServiceCommand, validateUpdatePlan } from '../plugin/server/daemon-update.mjs';

const phases = ['prepare', 'verify', 'idle', 'apply', 'check', 'rollback', 'rollbackCheck'];
const plan = versionCode => ({ target: 'paseodog', versionCode,
    ...Object.fromEntries(phases.map(name => [name, ['/usr/bin/host-owned-updater', name]])) });

async function fixture(t, options = {}) {
    const directory = await mkdtemp(scratchPath('paseodog-daemon-update-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await writeFile(join(directory, 'plan.json'), JSON.stringify(plan(11069)), { mode: 0o600 });
    const starts = [];
    const updater = createDaemonUpdater({ directory, versionCode: 11068,
        resolvePluginRoot: async () => fileURLToPath(new URL('../plugin/', import.meta.url)),
        start: async (...command) => { starts.push(command); if (options.startError) throw options.startError; },
        ...options });
    return { directory, starts, updater, receipt: async () => JSON.parse(await readFile(join(directory, 'request.json'), 'utf8')),
        request: () => updater.request({ versionCode: 11069, confirmed: true }) };
}

test('only a private host-owned fixed plan advertises the prepared exact update', async t => {
    const state = await fixture(t);
    assert.deepEqual(await state.updater.status(), { available: true, versionCode: 11069, request: null, reason: null });
    await chmod(join(state.directory, 'plan.json'), 0o666);
    assert.equal((await state.updater.status()).available, false);
});

test('missing configuration and non-Linux hosts never offer an update', async t => {
    const state = await fixture(t, { platform: 'win32' });
    assert.equal((await state.updater.status()).available, false);
    const unavailable = createDaemonUpdater({ directory: join(state.directory, 'not-configured'), versionCode: 11068 });
    assert.equal((await unavailable.status()).available, false);
});

test('symlink plans and unsafe parent directories are rejected', async t => {
    const state = await fixture(t);
    await writeFile(join(state.directory, 'trusted.json'), JSON.stringify(plan(11069)));
    await rm(join(state.directory, 'plan.json'));
    await symlink(join(state.directory, 'trusted.json'), join(state.directory, 'plan.json'));
    assert.equal((await state.updater.status()).available, false);
});

test('plans reject arbitrary schema, relative executables and invalid versions', () => {
    for (const value of [{ ...plan(11069), target: 'paseo' }, plan(-1),
        { ...plan(11069), apply: ['sh', '-c', 'anything'] },
        { ...plan(11069), execute: ['/usr/bin/other'] },
        { ...plan(11069), rollback: [] }])
        assert.throws(() => validateUpdatePlan(value));
});

test('a request persists before detached start and duplicates never start again', async t => {
    const state = await fixture(t);
    const first = await state.request();
    const duplicate = await state.request();
    assert.equal(first.request.phase, 'queued');
    assert.equal(first.request.id, duplicate.request.id);
    assert.equal(state.starts.length, 1);
    assert.deepEqual(state.starts[0], updateServiceCommand(state.directory));
    assert.equal(await readFile(join(state.directory, 'worker.mjs'), 'utf8'),
        await readFile(new URL('../plugin/server/daemon-update-worker.mjs', import.meta.url), 'utf8'));
    assert.equal(await readFile(join(state.directory, 'daemon-update.mjs'), 'utf8'),
        await readFile(new URL('../plugin/server/daemon-update.mjs', import.meta.url), 'utf8'));
    const fresh = createDaemonUpdater({ directory: state.directory, versionCode: 11068, start: () => assert.fail('replayed') });
    assert.equal((await fresh.request({ confirmed: true, versionCode: 11069 })).request.id, first.request.id);
});

test('confirmation, downgrade and mismatched versions cannot start a service', async t => {
    const state = await fixture(t);
    for (const input of [{ confirmed: false, versionCode: 11069 }, { confirmed: true, versionCode: 11068 },
        { confirmed: true, versionCode: 11070 }])
        await assert.rejects(state.updater.request(input));
    assert.equal(state.starts.length, 0);
});

test('an uncertain service start is persisted and never automatically retried', async t => {
    const state = await fixture(t, { startError: new Error('response lost') });
    assert.equal((await state.request()).request.phase, 'start-unknown');
    await state.request();
    assert.equal(state.starts.length, 1);
    await assert.rejects(executeDaemonUpdate(state.directory), /cannot be replayed/);
});

test('worker prepares while old daemon stays available, waits for idle and checks the new daemon', async t => {
    const state = await fixture(t);
    await state.request();
    const calls = [], waits = [];
    let idle = 0;
    await executeDaemonUpdate(state.directory, {
        run: async command => {
            const name = command[1];
            calls.push(name);
            if (name === 'idle') return JSON.stringify(++idle === 1 ? [{ status: 'running' }] : []);
            return '';
        },
        wait: async ms => waits.push(ms),
    });
    assert.deepEqual(calls, ['prepare', 'verify', 'idle', 'idle', 'apply', 'check']);
    assert.deepEqual(waits, [10000]);
    assert.equal((await state.receipt()).phase, 'complete');
    await assert.rejects(executeDaemonUpdate(state.directory), { code: 'EEXIST' });
});

for (const failed of ['prepare', 'verify', 'idle']) {
    test(`${failed} failure leaves the old daemon untouched and is not replayed`, async t => {
        const state = await fixture(t);
        await state.request();
        const calls = [];
        await assert.rejects(executeDaemonUpdate(state.directory, {
            run: async command => {
                calls.push(command[1]);
                if (command[1] === failed) throw new Error('private diagnostic must not escape');
                return '[]';
            },
        }));
        assert.equal((await state.receipt()).phase, 'failed');
        assert.equal(calls.includes('apply'), false);
        assert.equal(calls.includes('rollback'), false);
        await state.request();
        assert.equal(state.starts.length, 1);
        assert.doesNotMatch(JSON.stringify(await state.receipt()), /private diagnostic/);
    });
}

test('unknown work status and idle timeout do not authorize apply', async t => {
    for (const output of ['{}', '[{}]', '[{"status":"unknown"}]', '[{"status":"running"}]']) {
        const state = await fixture(t);
        await state.request();
        let time = 0;
        await assert.rejects(executeDaemonUpdate(state.directory, {
            run: async command => {
                assert.notEqual(command[1], 'apply');
                return command[1] === 'idle' ? output : '';
            },
            now: () => time,
            wait: async () => { time += 3600000; },
        }));
        assert.equal((await state.receipt()).phase, 'failed');
    }
});

for (const failure of ['apply', 'check', 'rollback', 'rollbackCheck']) {
    test(`${failure} failure records the actual rollback outcome`, async t => {
        const state = await fixture(t);
        await state.request();
        const calls = [];
        await assert.rejects(executeDaemonUpdate(state.directory, {
            run: async command => {
                const name = command[1];
                calls.push(name);
                if (name === failure || (failure.startsWith('rollback') && name === 'check'))
                    throw new Error('sensitive host output');
                return name === 'idle' ? '[]' : '';
            },
        }));
        assert.ok(calls.includes('rollback'));
        assert.equal((await state.receipt()).phase, failure.startsWith('rollback') ? 'rollback-failed' : 'rolled-back');
        assert.doesNotMatch(JSON.stringify(await state.receipt()), /sensitive host output/);
    });
}

test('lost response after the worker started never replaces its actual phase', async t => {
    const state = await fixture(t, {
        start: async (_command, args) => {
            const directory = args.at(-1);
            await executeDaemonUpdate(directory, { run: async command => command[1] === 'idle' ? '[]' : '' });
            throw new Error('lost response');
        },
    });
    assert.equal((await state.request()).request.phase, 'complete');
});

test('the copied independent CLI runs a fixed plan without its original daemon process', async t => {
    const state = await fixture(t);
    const local = plan(11069);
    for (const name of phases) local[name] = [process.execPath, '-e', name === 'idle' ? 'console.log("[]")' : ''];
    await writeFile(join(state.directory, 'plan.json'), JSON.stringify(local), { mode: 0o600 });
    await state.request();
    await promisify(execFile)(process.execPath,
        [join(state.directory, 'worker.mjs'), '--execute', state.directory], { timeout: 30000 });
    assert.equal((await state.receipt()).phase, 'complete');
});

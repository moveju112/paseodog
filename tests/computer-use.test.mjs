import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scratchPath } from '../scripts/paths.mjs';
import { computerBridgeState, computerSessionEnvironment, computerUseStatus, desktopBridgeDirectory, readComputerUse, withComputerUse,
    writeComputerUse } from '../plugin/server/computer-use.mjs';
import { createEngineControls } from '../plugin/server/controls.mjs';
import { processEngineFactory } from '../plugin/server/process-engine.mjs';
import { engineControls } from '../plugin/shared/controls.ts';
import release from '../plugin/shared/release.json' with { type: 'json' };
import { attachHostPolicy } from '../engine/src/policy.mjs';

function scratch(t, name) {
    const root = mkdtempSync(scratchPath(`paseodog-${name}-`));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    return root;
}

function discovery(home, value, ageMs = 0) {
    const directory = desktopBridgeDirectory(home);
    mkdirSync(directory, { recursive: true });
    const path = join(directory, 'computer-bridge.json');
    writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
    const time = new Date(Date.now() - ageMs);
    utimesSync(path, time, time);
}

test('computer use stays off until the user saves a boolean toggle', (t) => {
    const env = { MIXDOG_DATA_DIR: scratch(t, 'computer-setting') };
    assert.equal(readComputerUse({}), false);
    assert.equal(readComputerUse(env), false);
    writeComputerUse(env, true);
    assert.equal(readComputerUse(env), true);
    writeComputerUse(env, false);
    assert.equal(readComputerUse(env), false);
    for (const value of ['true', 1, null, undefined]) {
        assert.throws(() => writeComputerUse(env, value), /boolean/);
        assert.equal(readComputerUse(env), false);
    }
    assert.throws(() => writeComputerUse({}, true), /Dedicated/);
    writeFileSync(join(env.MIXDOG_DATA_DIR, 'paseodog-computer-use.json'), '{"enabled":"yes"}');
    assert.throws(() => readComputerUse(env), /Invalid computer use setting/);
});

test('engine environment follows the toggle and only exposes the desktop computer bridge', () => {
    const inherited = { PATH: '/bin', MIXDOG_BRIDGE_DISCOVERY_DIR: '/other/bridges', MIXDOG_FEATURE_COMPUTER: '1' };
    const off = withComputerUse(inherited, false, '/home/user');
    assert.equal(off.MIXDOG_FEATURE_COMPUTER, '0');
    assert.equal(Object.hasOwn(off, 'MIXDOG_BRIDGE_DISCOVERY_DIR'), false);
    assert.equal(off.PATH, '/bin');
    const on = withComputerUse({ ...inherited, MIXDOG_FEATURE_BROWSER: '1' }, true, '/home/user');
    assert.equal(on.MIXDOG_BRIDGE_DISCOVERY_DIR, join('/home/user', '.mixdog', 'data'));
    assert.equal(Object.hasOwn(on, 'MIXDOG_FEATURE_COMPUTER'), false);
    assert.equal(on.MIXDOG_FEATURE_TERMINAL, '0');
    assert.equal(on.MIXDOG_FEATURE_VISUALIZE, '0');
    assert.equal(on.MIXDOG_FEATURE_BROWSER, '1');
    assert.equal(inherited.MIXDOG_FEATURE_COMPUTER, '1');
});

test('the pinned Mixdog runtime actually exposes computer tools only with the enabled live bridge', (t) => {
    const home = scratch(t, 'computer-runtime');
    discovery(home, { version: 1, port: 41234, token: 'fixture-only', pid: process.pid });
    const client = new URL('../engine/node_modules/mixdog/src/runtime/computer-bridge/client.mjs', import.meta.url).href;
    const features = new URL('../engine/node_modules/mixdog/src/runtime/agent/orchestrator/runtime-core/builtin-features.mjs', import.meta.url).href;
    const script = `
        import { computerBridgeAvailableSync } from ${JSON.stringify(client)};
        import { builtinFeatureActive, featureDisallowedToolsFor } from ${JSON.stringify(features)};
        console.log(JSON.stringify({
            active: builtinFeatureActive({}, 'computer'),
            denied: featureDisallowedToolsFor({}, { computerAvailable: computerBridgeAvailableSync() }).includes('computer'),
            browser: builtinFeatureActive({}, 'browser'),
        }));
    `;
    for (const enabled of [false, true, false]) {
        const env = withComputerUse({ ...process.env, MIXDOG_HOME: join(home, 'dedicated'),
            MIXDOG_DATA_DIR: join(home, 'dedicated', 'data') }, enabled, home);
        const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8' }));
        assert.deepEqual(result, { active: enabled, denied: !enabled, browser: false });
    }
});

test('bridge state mirrors Mixdog discovery freshness, shape and writer liveness without leaking secrets', (t) => {
    const home = scratch(t, 'computer-home');
    const directory = desktopBridgeDirectory(home);
    const record = { version: 1, port: 41234, token: 'secret-token', pid: 4242 };
    assert.equal(computerBridgeState(directory), 'missing');
    discovery(home, record);
    assert.equal(computerBridgeState(directory, { alive: () => true }), 'connected');
    assert.equal(computerBridgeState(directory, { alive: () => false }), 'stale');
    discovery(home, { ...record, pid: process.pid });
    assert.equal(computerBridgeState(directory), 'connected');
    discovery(home, record, 5 * 60_000 + 1000);
    assert.equal(computerBridgeState(directory, { alive: () => true }), 'expired');
    for (const invalid of ['{', { ...record, version: 2 }, { ...record, port: 0 }, { ...record, port: 70000 },
        { ...record, token: '' }]) {
        discovery(home, invalid);
        assert.equal(computerBridgeState(directory, { alive: () => true }), 'invalid');
    }
    discovery(home, record);
    const env = { MIXDOG_DATA_DIR: scratch(t, 'computer-status'), DISPLAY: ':0' };
    const status = computerUseStatus(env, { platform: 'linux', home, alive: () => true });
    assert.deepEqual(status, { enabled: false, bridge: 'connected', display: true, mixdogVersion: release.paseodogUpstream.mixdog });
    assert.doesNotMatch(JSON.stringify(status), /secret-token|41234/);
    assert.equal(computerUseStatus({ WAYLAND_DISPLAY: 'wayland-0' }, { platform: 'linux', home }).display, true);
    assert.equal(computerUseStatus({}, { platform: 'linux', home }).display, false);
    assert.equal(computerUseStatus({}, { platform: 'win32', home }).display, true);
});

test('controls toggle computer use without opening the engine profile and report it with every snapshot', async (t) => {
    const env = { MIXDOG_DATA_DIR: scratch(t, 'computer-controls') };
    const requests = [];
    const controls = createEngineControls({ async execCommand(_command, args) {
        requests.push(JSON.parse(args.at(-1)));
        return { stdout: '{"models":[]}' };
    } });
    controls.bind({ command: '/test-engine', args: [], env });
    t.after(() => controls.close());
    assert.equal((await controls.read({ action: 'computerUse' })).computerUse.enabled, false);
    assert.equal((await controls.read({ action: 'computerUse', enabled: true })).computerUse.enabled, true);
    assert.equal(requests.length, 0);
    assert.equal(readComputerUse(env), true);
    const snapshot = await controls.read();
    assert.equal(snapshot.computerUse.enabled, true);
    assert.deepEqual(requests, [{}]);
    await assert.rejects(controls.read({ action: 'computerUse', enabled: 'false' }), /boolean/);
    assert.equal(readComputerUse(env), true);
    assert.equal(engineControls.input.safeParse({ action: 'computerUse', enabled: false }).success, true);
    assert.equal(engineControls.input.safeParse({ action: 'computerUse', enabled: 'off' }).success, false);
});

test('each new engine process reads the current toggle before spawning', async (t) => {
    const env = { MIXDOG_DATA_DIR: scratch(t, 'computer-engine'), MIXDOG_BRIDGE_DISCOVERY_DIR: '/inherited' };
    const spawned = [];
    const factory = processEngineFactory({
        launch: { command: '/test-engine', args: [], env },
        spawnProcess(_command, _args, options) { spawned.push(options.env); throw new Error('captured'); },
        terminateProcess() {},
        scopeFactory: ({ launch }) => ({ command: launch.command, args: [], detached: false, async preflight() {}, stop: null }),
    });
    const create = () => assert.rejects(factory.create({ config: { cwd: env.MIXDOG_DATA_DIR, env: {} } }), /captured/);
    await create();
    writeComputerUse(env, true);
    await create();
    writeComputerUse(env, false);
    await create();
    assert.equal(spawned[0].MIXDOG_FEATURE_COMPUTER, '0');
    assert.equal(Object.hasOwn(spawned[0], 'MIXDOG_BRIDGE_DISCOVERY_DIR'), false);
    assert.equal(spawned[1].MIXDOG_BRIDGE_DISCOVERY_DIR, desktopBridgeDirectory());
    assert.equal(Object.hasOwn(spawned[1], 'MIXDOG_FEATURE_COMPUTER'), false);
    assert.equal(spawned[2].MIXDOG_FEATURE_COMPUTER, '0');
    assert.equal(spawned[2].MIXDOG_DATA_DIR, env.MIXDOG_DATA_DIR);
});

test('Linux services obtain only graphical environment keys from the live desktop bridge owner', (t) => {
    const home = scratch(t, 'computer-desktop-env');
    const env = { PATH: '/daemon/bin', MIXDOG_DATA_DIR: '/dedicated', DISPLAY: ':old', XDG_SESSION_TYPE: 'x11' };
    const options = { home, platform: 'linux', readEnvironment(pid) {
        assert.equal(pid, process.pid);
        return 'WAYLAND_DISPLAY=wayland-1\0XDG_SESSION_TYPE=wayland\0XDG_RUNTIME_DIR=/run/user/1000\0'
            + 'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus\0PATH=/desktop/bin\0MIXDOG_DATA_DIR=/personal\0';
    } };
    assert.deepEqual(computerSessionEnvironment(env, options), env);
    discovery(home, { version: 1, port: 41234, token: 'fixture-only', pid: process.pid });
    const next = computerSessionEnvironment(env, options);
    assert.equal(next.WAYLAND_DISPLAY, 'wayland-1');
    assert.equal(next.XDG_SESSION_TYPE, 'wayland');
    assert.equal(Object.hasOwn(next, 'DISPLAY'), false);
    assert.equal(next.PATH, env.PATH);
    assert.equal(next.MIXDOG_DATA_DIR, env.MIXDOG_DATA_DIR);
    assert.equal(computerUseStatus({}, options).display, true);
    assert.deepEqual(computerSessionEnvironment(env, { ...options, readEnvironment() { throw new Error('denied'); } }), env);
    assert.deepEqual(computerSessionEnvironment(env, { ...options, platform: 'win32', readEnvironment() { assert.fail(); } }), env);
    discovery(home, { version: 1, port: 41234, token: 'fixture-only', pid: 0 });
    assert.deepEqual(computerSessionEnvironment(env, { ...options, readEnvironment() { assert.fail(); } }), env);
});

test('turning off computer use blocks existing parent and child hooks, including bypass and rewritten tools', async (t) => {
    const env = { MIXDOG_DATA_DIR: scratch(t, 'computer-revoke') };
    for (const mode of ['ask', 'review', 'bypass']) {
        for (const orchestration of [false, true]) {
            const session = { id: 'fixture-session', messages: [] };
            attachHostPolicy(session, { mode, orchestration, computerUseEnabled: () => readComputerUse(env) });
            assert.equal((await session.beforeToolHook({ name: 'computer', args: {} })).action, 'deny');
            writeComputerUse(env, true);
            assert.equal((await session.beforeToolHook({ name: 'computer', args: {} })).action,
                mode === 'review' ? 'deny' : mode === 'ask' ? 'ask' : 'rewrite');
            writeComputerUse(env, false);
            assert.equal((await session.beforeToolHook({ name: 'computer', args: {} })).action, 'deny');
            session.beforeToolHook = async () => ({ action: 'rewrite', name: 'computer', args: {} });
            attachHostPolicy(session, { mode, orchestration, computerUseEnabled: () => readComputerUse(env) });
            assert.equal((await session.beforeToolHook({ name: 'read', args: {} })).action, 'deny');
        }
    }
});

test('turning off while a computer approval is pending prevents a late allow from executing', async (t) => {
    const env = { ...process.env, MIXDOG_DATA_DIR: scratch(t, 'computer-pending') };
    writeComputerUse(env, true);
    const factory = processEngineFactory({
        launch: { command: process.execPath, args: [fileURLToPath(new URL('./fixtures/worker-fixture.mjs', import.meta.url))], env },
        spawnProcess: spawn, terminateProcess: child => child.kill('SIGKILL'),
        scopeMode: 'test-only-process-group', stopMs: 250,
    });
    const engine = await factory.create({ config: { cwd: env.MIXDOG_DATA_DIR, env: {}, mcpServers: {}, settings: {}, persist: true } });
    t.after(() => engine.close());
    const result = await engine.ask('computer-permission', { onToolApproval() {
        writeComputerUse(env, false);
        return { approved: true };
    } });
    assert.equal(result.result.content, 'denied');
});

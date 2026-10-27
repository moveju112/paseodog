import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createVersionLabels } from '../android/packages/app/src/utils/version-labels.ts';
import release from '../plugin/shared/release.json' with { type: 'json' };

const require = createRequire(new URL('../plugin/package.json', import.meta.url));
const React = require('react');
const { create, act } = require('react-test-renderer');
const { transformSync } = createRequire(new URL('../android/packages/app/package.json', import.meta.url))('esbuild');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function harness(t, platform, options = {}) {
    const calls = [];
    let connected = true, serverId = 'one';
    const releases = {
        one: { version: '1.0.0-rc.7', versionCode: 11073, paseodogUpstream: { paseo: '0.11.4', mixdog: '1.3.1' } },
        two: { version: '1.0.0-rc.7', versionCode: 11074 },
    };
    const clients = Object.fromEntries(Object.keys(releases).map(id => [id, {
        async invokePluginRpc(...args) {
            calls.push([id, ...args]);
            if (options.error) throw new Error('RPC unavailable');
            return releases[id];
        },
    }]));
    const deps = {
        React,
        readAppRelease: async () => options.appRelease ?? { version: '1.0.0-rc.7.11075', versionCode: 11075 },
        useClient: id => clients[id], useConnected: () => connected,
        useProvidersSnapshot: () => ({ entries: [{ provider: options.provider ?? 'paseodog' }] }),
    };
    const hooks = createVersionLabels(deps);
    let app, host;
    function Component() {
        app = hooks.useAppVersionText('v0.11.4');
        host = hooks.useHostVersionText(serverId, connected ? 'v0.11.4' : '오프라인');
        return React.createElement('Text', null, app, host);
    }
    let root;
    await act(async () => { root = create(React.createElement(Component)); });
    t.after(async () => { await act(async () => root.unmount()); });
    return {
        get app() { return app; }, get host() { return host; }, calls,
        async update(next) {
            connected = next.connected ?? connected;
            serverId = next.serverId ?? serverId;
            await act(async () => { root.update(React.createElement(Component)); });
        },
    };
}

// 클라이언트별 메타데이터 획득은 아래 실제 어댑터 검사에서, 표시와 호스트 격리는
// 모든 빌드가 사용하는 공통 훅에서 검증한다.
for (const platform of ['shared']) {
    test(`${platform}: separates app and per-host release/build/base versions`, async t => {
        const state = await harness(t, platform);
        const expected = { version: '1.0.0-rc.7.11075', versionCode: 11075 };
        assert.equal(state.app, `PaseoDog: ${expected.version}\n빌드: ${expected.versionCode}\nPaseo: v0.11.4`);
        assert.equal(state.host, 'PaseoDog: 1.0.0-rc.7\n빌드: 11073\nPaseo: v0.11.4\nMixdog: 1.3.1');
        await state.update({ serverId: 'two' });
        assert.equal(state.host, 'PaseoDog: 1.0.0-rc.7\n빌드: 11074\nPaseo: v0.11.4\nMixdog: 미확인');
        assert.deepEqual(state.calls, [
            ['one', 'paseodog-provider', 'daemon-release', {}],
            ['two', 'paseodog-provider', 'daemon-release', {}],
        ]);
        await state.update({ connected: false });
        assert.equal(state.host, '오프라인');
        assert.equal(state.calls.length, 2);
    });

    test(`${platform}: failed or unsupported host RPC never substitutes the app release`, async t => {
        const failed = await harness(t, platform, { error: true });
        assert.equal(failed.host, 'PaseoDog: 미확인\n빌드: 미확인\nPaseo: v0.11.4\nMixdog: 미확인');
        const stock = await harness(t, platform, { provider: 'codex' });
        assert.equal(stock.host, 'Paseo: v0.11.4');
        assert.deepEqual(stock.calls, []);
    });
}

test('web desktop shows the installed runtime version instead of the bundled release', async t => {
    const state = await harness(t, 'shared', {
        appRelease: { version: '1.0.0-rc.7.11070', versionCode: 11070 },
    });
    assert.equal(state.app, 'PaseoDog: 1.0.0-rc.7.11070\n빌드: 11070\nPaseo: v0.11.4');
});

test('missing and malformed installed metadata stays explicitly unknown', async t => {
    const state = await harness(t, 'source', { appRelease: { version: '', versionCode: '11075' } });
    assert.equal(state.app, 'PaseoDog: 미확인\n빌드: 미확인\nPaseo: v0.11.4');
});

test('late replies from a previous host cannot replace the selected host version', async t => {
    let resolveOld, id = 'old', text;
    const clients = {
        old: { invokePluginRpc: () => new Promise(resolve => { resolveOld = resolve; }) },
        current: { invokePluginRpc: async () => ({ version: 'current', versionCode: 2 }) },
    };
    const { useHostVersionText } = createVersionLabels({
        React, readAppRelease: async () => null, useClient: key => clients[key],
        useConnected: () => true, useProvidersSnapshot: () => ({ entries: [{ provider: 'paseodog' }] }),
    });
    function Component() { text = useHostVersionText(id, 'v0.11.4'); return null; }
    let root;
    await act(async () => { root = create(React.createElement(Component)); });
    t.after(async () => { await act(async () => root.unmount()); });
    id = 'current';
    await act(async () => { root.update(React.createElement(Component)); });
    await act(async () => { resolveOld({ version: 'old', versionCode: 1 }); });
    assert.equal(text, 'PaseoDog: current\n빌드: 2\nPaseo: v0.11.4\nMixdog: 미확인');
});

test('app adapter reads Android package metadata, desktop IPC and web build metadata separately', async () => {
    const source = readFileSync(new URL('../android/packages/app/src/utils/use-version-labels.ts', import.meta.url), 'utf8');
    const code = transformSync(source, { loader: 'ts', format: 'cjs' }).code;
    let platform = 'android', desktop = false, nativeError = false;
    const native = { installedRelease() {
        if (nativeError) throw new Error('native unavailable');
        return { version: '1.0.0-rc.7.11075', versionCode: 11075 };
    } };
    const modules = {
        react: React, 'react-native': { Platform: { get OS() { return platform; } } },
        'expo-constants': { expoConfig: { extra: { paseodogRelease: release } } },
        'expo-modules-core': { requireNativeModule(name) { assert.equal(name, 'PaseodogUpdater'); return native; } },
        '@/desktop/host': { isElectronRuntime: () => desktop },
        '@/desktop/updates/desktop-updates': { getDesktopRuntimeInfo: async () => ({ appVersion: '1.0.0-rc.7.11070' }) },
        '@/runtime/host-runtime': {}, '@/hooks/use-providers-snapshot': {},
        './version-labels': { createVersionLabels },
    };
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(id => {
        assert.ok(modules[id], `Unexpected dependency ${id}`);
        return modules[id];
    }, module, module.exports);
    const read = module.exports.readInstalledAppRelease;
    assert.deepEqual(await read(), { version: '1.0.0-rc.7.11075', versionCode: 11075 });
    nativeError = true;
    await assert.rejects(read(), /native unavailable/);
    platform = 'web'; desktop = true;
    assert.deepEqual(await read(), { version: '1.0.0-rc.7.11070', versionCode: 11070 });
    desktop = false;
    assert.deepEqual(await read(), release);
});

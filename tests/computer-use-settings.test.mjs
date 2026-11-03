import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { installedComposerFixture } from './composer-fixture.mjs';
import release from '../plugin/shared/release.json' with { type: 'json' };

const require = createRequire(new URL('../plugin/package.json', import.meta.url));
const React = require('react');
const { create, act } = require('react-test-renderer');
const ts = createRequire(new URL('../android/package.json', import.meta.url))('typescript');
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const bundle = installedComposerFixture();
const source = stripTypeScriptTypes(read('android/packages/app/src/screens/settings/computer-use-settings.ts'))
    .replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
const start = bundle.indexOf('const PaseodogComputerUseSettings=');
const web = bundle.slice(start, bundle.indexOf('const PaseodogAgentMessageSettings=', start));
const components = { View: 'view', Text: 'text', Switch: 'switch', Pressable: 'pressable' };

for (const platform of ['app', 'web']) {
    test(`${platform}: computer toggle, setup guidance and uncertain saves stay isolated to the selected host`, async t => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        let connected = true, fail = false, malformed = false, deferred, finish;
        const values = { one: false, two: true };
        let bridge = 'missing', display = true;
        const calls = [], opened = [];
        const status = host => ({ enabled: values[host], bridge, display, mixdogVersion: release.paseodogUpstream.mixdog });
        const clients = Object.fromEntries(Object.keys(values).map(host => [host, {
            async invokePluginRpc(plugin, method, input) {
                assert.equal(plugin, 'paseodog-provider');
                assert.equal(method, 'engine-controls');
                calls.push({ host, ...input });
                if (deferred === host) return new Promise(resolve => { finish = resolve; });
                if (Object.hasOwn(input, 'enabled')) values[host] = input.enabled;
                if (fail) throw new Error('uncertain response after save');
                if (malformed) return { computerUse: { ...status(host), bridge: 'toString' } };
                return { computerUse: status(host) };
            },
        }]));
        const runtime = {
            useHostRuntimeClient: id => clients[id],
            useHostRuntimeIsConnected: () => connected,
        };
        const external = { async openExternalUrl(url) { opened.push(url); } };
        const common = { ...React, ...components, ...runtime, ...external, settingsStyles: {} };
        const Component = platform === 'app'
            ? runInNewContext(source + ';ComputerUseSettings', common)
            : runInNewContext(web + ';PaseodogComputerUseSettings', {
                u: React, n: components, o: components, r: components, w: components, S: { settingsStyles: {} },
                _r: id => {
                    if (id === 3916) return external;
                    assert.equal(id, 3762);
                    return runtime;
                },
            });
        let Page;
        if (platform === 'app') {
            const page = read('android/packages/app/src/screens/settings/ai-engine-page.tsx');
            const body = page.slice(page.indexOf('export function AiEnginePage(')).replace('export function', 'function');
            const compiled = ts.transpileModule(body, {
                compilerOptions: { jsx: ts.JsxEmit.React, jsxFactory: 'React.createElement' },
            }).outputText;
            Page = runInNewContext(compiled + ';AiEnginePage', {
                ...common, React, ComputerUseSettings: Component, TurnDurationSettings: () => null,
                AgentMessageSettings: () => null,
                useAiEngineSettings: () => ({ snapshot: null, connected: true, request() {} }),
                layout: {}, Button: 'button',
            });
        } else {
            const anchor = bundle.indexOf('_e.AiEnginePage=function(e){');
            const end = bundle.indexOf(';function PaseodogBaseAiEnginePage', anchor);
            Page = runInNewContext('const _e={};' + bundle.slice(anchor, end) + ';_e.AiEnginePage', {
                u: React, n: components, PaseodogComputerUseSettings: Component,
                PaseodogTurnDurationSettings: () => null, PaseodogAgentMessageSettings: () => null,
                PaseodogBaseAiEnginePage: () => null,
            });
        }
        let tree;
        await act(async () => { tree = create(React.createElement(Page, { serverId: 'one', section: 'tokens' })); });
        t.after(async () => {
            await act(async () => tree.unmount());
            delete globalThis.IS_REACT_ACT_ENVIRONMENT;
        });
        const toggle = () => tree.root.findByProps({ accessibilityLabel: '컴퓨터 사용' });
        const refresh = () => tree.root.findByProps({ accessibilityLabel: '컴퓨터 사용 상태 새로고침' });
        const text = () => JSON.stringify(tree.toJSON());
        const update = async (host = 'one', section = 'tools') =>
            act(async () => tree.update(React.createElement(Page, { serverId: host, section })));
        assert.equal(calls.length, 0);
        await update();
        assert.equal(toggle().props.value, false);
        assert.equal(toggle().props.disabled, false);
        assert.equal(opened.length, 0);
        await act(async () => toggle().props.onValueChange(true));
        assert.equal(values.one, true);
        assert.match(text(), /npm CLI만 설치하면 안 돼요/);
        assert.match(text(), /같은 버전/);
        assert.match(text(), /Bypass/);
        await act(async () => tree.root.findByProps({ accessibilityLabel: 'mixdog 데스크톱 앱 다운로드' }).props.onPress());
        assert.deepEqual(opened, [`https://github.com/tribgames/mixdog/releases/tag/v${release.paseodogUpstream.mixdog}`]);
        for (const state of ['expired', 'stale', 'invalid']) {
            bridge = state;
            await act(async () => refresh().props.onPress());
            assert.match(text(), /연결되지 않았어요/);
        }
        bridge = 'connected';
        await act(async () => refresh().props.onPress());
        assert.match(text(), /연결 정보를 확인/);
        display = false;
        await act(async () => refresh().props.onPress());
        assert.match(text(), /화면 없는 서버/);
        display = true;
        deferred = 'one';
        await act(async () => {
            toggle().props.onValueChange(false);
            toggle().props.onValueChange(false);
        });
        assert.equal(toggle().props.disabled, true);
        assert.equal(calls.filter(call => call.enabled === false).length, 1);
        deferred = undefined;
        values.one = false;
        await act(async () => finish({ computerUse: status('one') }));
        assert.equal(toggle().props.value, false);
        assert.match(text(), /이후 컴퓨터 도구 호출은 차단/);
        fail = true;
        await act(async () => toggle().props.onValueChange(true));
        assert.equal(values.one, true, 'a lost reply must not be treated as a failed write');
        assert.equal(toggle().props.disabled, true);
        assert.match(text(), /자동 재전송하지/);
        const count = calls.length;
        await act(async () => toggle().props.onValueChange(false));
        assert.equal(calls.length, count);
        fail = false;
        await act(async () => refresh().props.onPress());
        assert.equal(toggle().props.value, true);
        malformed = true;
        await act(async () => refresh().props.onPress());
        assert.equal(toggle().props.disabled, true);
        malformed = false;
        deferred = 'one';
        await act(async () => refresh().props.onPress());
        await update('two');
        assert.equal(toggle().props.value, true);
        await act(async () => finish({ computerUse: { ...status('one'), enabled: false } }));
        assert.equal(toggle().props.value, true);
        connected = false;
        await update('two');
        assert.equal(toggle().props.disabled, true);
        const disconnected = calls.length;
        await act(async () => refresh().props.onPress());
        assert.equal(calls.length, disconnected);
        connected = true;
        await update('two');
        assert.equal(toggle().props.disabled, false);
    });
}

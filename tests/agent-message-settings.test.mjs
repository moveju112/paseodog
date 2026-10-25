import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { runInNewContext, Script } from 'node:vm';
import { composerFixture } from './composer-fixture.mjs';
import { COMPOSER_FILE } from '../scripts/patch-paseo-composer.mjs';

const require = createRequire(new URL('../plugin/package.json', import.meta.url));
const React = require('react');
const { create, act } = require('react-test-renderer');
const ts = createRequire(new URL('../android/package.json', import.meta.url))('typescript');
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const bundle = composerFixture(read('tools/node_modules/@getpaseo/server/' + COMPOSER_FILE));
const source = stripTypeScriptTypes(read('android/packages/app/src/screens/settings/agent-message-settings.ts'))
    .replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
const start = bundle.indexOf('const PaseodogAgentMessageSettings=');
const web = bundle.slice(start, bundle.indexOf('const PaseodogTurnDurationSettings=', start));
const components = { View: 'view', Text: 'text', Pressable: 'pressable' };
const compile = source => ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.React, jsxFactory: 'React.createElement' },
}).outputText;

for (const platform of ['app', 'web']) {
    test(`${platform}: workflow exposes policy without an engine snapshot and isolates host responses`, async t => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        t.after(() => { delete globalThis.IS_REACT_ACT_ENVIRONMENT; });
        let connected = true, fail = false, deferred;
        const pending = [];
        const values = { one: true, two: false };
        const calls = [];
        const clients = Object.fromEntries(Object.keys(values).map(host => [host, {
            async invokePluginRpc(plugin, name, input) {
                assert.equal(plugin, 'paseodog-provider');
                assert.equal(name, 'agent-message-policy');
                calls.push({ host, ...input });
                if (deferred === host) return new Promise(resolve => pending.push(resolve));
                if (fail) throw new Error('unsupported or disconnected');
                if (input.action === 'write') values[host] = input.allowUnrelatedSessions;
                return { allowUnrelatedSessions: values[host] };
            },
        }]));
        const runtime = {
            useHostRuntimeClient: id => clients[id],
            useHostRuntimeIsConnected: () => connected,
        };
        const common = { ...React, ...components, ...runtime, settingsStyles: {} };
        const Component = platform === 'app'
            ? runInNewContext(source + ';AgentMessageSettings', common)
            : runInNewContext(web + ';PaseodogAgentMessageSettings', {
                u: React, n: components, o: components, r: components, S: { settingsStyles: {} },
                _r: id => { assert.equal(id, 3762); return runtime; },
            });
        let Page;
        if (platform === 'app') {
            const page = read('android/packages/app/src/screens/settings/ai-engine-page.tsx');
            Page = runInNewContext(compile(page.slice(page.indexOf('export function AiEnginePage('))
                .replace('export function', 'function')) + ';AiEnginePage', {
                ...common, React, AgentMessageSettings: Component, TurnDurationSettings: () => null,
                useAiEngineSettings: () => ({ snapshot: null, connected: true, request() {} }),
                layout: {}, Button: 'button',
            });
        } else {
            const anchor = bundle.indexOf('_e.AiEnginePage=function(e){');
            const end = bundle.indexOf(';function PaseodogBaseAiEnginePage', anchor);
            Page = runInNewContext('const _e={};' + bundle.slice(anchor, end) + ';_e.AiEnginePage', {
                u: React, n: components, PaseodogAgentMessageSettings: Component, PaseodogTurnDurationSettings: () => null,
                PaseodogBaseAiEnginePage: () => null,
            });
        }
        let tree;
        await act(async () => { tree = create(React.createElement(Page, { serverId: 'one', section: 'tokens' })); });
        const switches = () => tree.root.findAll(node => node.props.accessibilityRole === 'switch');
        assert.equal(switches().length, 0);
        await act(async () => tree.update(React.createElement(Page, { serverId: 'one', section: 'workflow' })));
        const toggle = () => switches()[0];
        assert.equal(toggle().props.accessibilityLabel, '무관한 세션 간 메시지 허용');
        assert.equal(toggle().props.accessibilityState.checked, true);
        await act(async () => toggle().props.onPress());
        assert.equal(values.one, false);
        assert.equal(toggle().props.accessibilityState.checked, false);
        fail = true;
        await act(async () => toggle().props.onPress());
        assert.equal(toggle().props.disabled, true);
        assert.match(JSON.stringify(tree.toJSON()), /설정 결과를 확인하지/);
        fail = false;
        deferred = 'one';
        const refresh = () => tree.root.findByProps({ accessibilityLabel: '세션 메시지 설정 새로고침' });
        await act(async () => refresh().props.onPress());
        await act(async () => tree.update(React.createElement(Page, { serverId: 'two', section: 'workflow' })));
        assert.equal(toggle().props.accessibilityState.checked, false);
        await act(async () => pending.shift()({ allowUnrelatedSessions: true }));
        assert.equal(toggle().props.accessibilityState.checked, false);
        connected = false;
        const count = calls.length;
        await act(async () => tree.update(React.createElement(Page, { serverId: 'two', section: 'workflow' })));
        assert.equal(toggle().props.disabled, true);
        assert.equal(calls.length, count);
        connected = true;
        await act(async () => tree.update(React.createElement(Page, { serverId: 'two', section: 'workflow' })));
        assert.equal(toggle().props.disabled, false);
        assert.equal(toggle().props.accessibilityState.checked, false);
        await act(async () => tree.unmount());
    });
}

test('integrated web message settings are syntax-valid', () => {
    new Script(bundle);
});

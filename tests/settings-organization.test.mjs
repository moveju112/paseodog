import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { runInNewContext, Script } from 'node:vm';
import { COMPOSER_FILE, patchedComposerSource } from '../scripts/patch-paseo-composer.mjs';
import { withSettingsOrganization, withoutSettingsOrganization } from '../patches/paseo-settings-organization.mjs';

const require = createRequire(new URL('../plugin/package.json', import.meta.url));
const React = require('react');
const { create, act } = require('react-test-renderer');
const ts = createRequire(new URL('../android/package.json', import.meta.url))('typescript');
const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const shared = read('android/packages/app/src/screens/settings-screen.tsx');
const patched = composerFixture(read('tools/node_modules/@getpaseo/server/' + COMPOSER_FILE));
import { composerFixture } from './composer-fixture.mjs';
const plain = (source) => stripTypeScriptTypes(source).replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
const routeSource = plain(read('android/packages/app/src/plugins/routes.ts'));
const buildPluginSurfaceRoute = runInNewContext(routeSource + '; buildPluginSurfaceRoute');
const detailsSource = plain(read('android/packages/app/src/screens/settings/diagnostic-details.ts'));
const compile = (source) => ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.React, jsxFactory: 'React.createElement' },
}).outputText;
const memo = (size) => Array(size).fill(Symbol.for('react.memo_cache_sentinel'));
const jsx = (type, props) => React.createElement(type, props);

test('settings organization remains hash-gated, reversible and idempotent', () => {
    new Script(patched);
    assert.equal(composerFixture(patched), patched);
    assert.equal(withSettingsOrganization(withoutSettingsOrganization(patched)), patched);
    assert.throws(() => patchedComposerSource(patched + '// drift'), /hash mismatch/);
    assert.throws(() => withSettingsOrganization(''), /anchor mismatch/);
});

// 실제 공통 진단과 고정 웹 컴포넌트의 클릭·표시·호스트 연결을 함께 검증한다.
test('shared and web diagnostic details keep playback explicit and open the selected host viewer', async (t) => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    t.after(() => { delete globalThis.IS_REACT_ACT_ENVIRONMENT; });
    let connected = true;
    let installed = true;
    const routes = [];
    const router = { push: (route) => routes.push(route) };
    const plugins = () => installed ? ['host/one', 'host-two'].map((serverId) => ({
        serverId, id: 'paseodog-provider', surfaces: [{ id: 'paseodog-native-config' }],
    })) : [];
    const components = { View: 'view', Text: 'text', Button: 'button', Switch: 'switch', SettingsSection: 'section' };
    const common = {
        ...React, ...components, settingsStyles: {},
        useRouter: () => router, useInstalledPlugins: plugins,
        useHostRuntimeIsConnected: () => connected, buildPluginSurfaceRoute,
    };
    const DiagnosticDetails = runInNewContext(detailsSource + '; DiagnosticDetails', common);
    const start = shared.indexOf('function DiagnosticsSection(');
    const end = shared.indexOf('interface AboutSectionProps', start);
    const Native = runInNewContext(compile(shared.slice(start, end)) + '; DiagnosticsSection', {
        ...common, React, DiagnosticDetails, isNative: true,
        useTranslation: () => ({ t: (key) => key }),
        useAppDiagnosticStore: () => () => {},
    });
    const webStart = patched.indexOf('const PaseodogDiagnosticDetails=');
    const baseStart = patched.indexOf('function PaseodogBaseDiagnostics(', webStart);
    const webEnd = patched.indexOf('function ', baseStart + 9);
    const Web = runInNewContext(patched.slice(webStart, webEnd) + '; Me', {
        c: React, s: components, t: components, q: components, T: components, Q: components,
        p: { useRouter: common.useRouter }, he: { useInstalledPlugins: plugins },
        L: { useHostRuntimeIsConnected: common.useHostRuntimeIsConnected },
        r: (id) => { assert.equal(id, 3893); return { buildPluginSurfaceRoute }; },
        ae: { settingsStyles: {} }, l: { c: memo }, Pe: { jsx, jsxs: jsx },
        S: { useTranslation: () => ({ t: (key) => key }) },
        ce: { useAppDiagnosticStore: () => () => {} }, We() {}, Ce: { isNative: false },
    });
    for (const Component of [Native, Web]) {
        let played = 0;
        const props = {
            serverId: 'host/one', voiceAudioEngine: {}, isPlaybackTestRunning: false,
            playbackTestResult: 'playback failure', handlePlaybackTest: async () => { played++; },
            useLegacyTerminalRenderer: false, onUseLegacyTerminalRendererChange() {},
        };
        let tree;
        await act(async () => { tree = create(React.createElement(Component, props)); });
        try {
            const buttons = () => tree.root.findAllByType('button');
            const button = (label) => buttons().find((node) => node.props.accessibilityLabel === label || node.props.children === label);
            assert.equal(button('settings.diagnostics.playTest'), undefined);
            assert.equal(button('원본 스킬·훅 보기'), undefined);
            assert.ok(button('settings.diagnostics.app.run'));
            await act(async () => button('진단 상세').props.onPress());
            assert.equal(played, 0);
            assert.match(JSON.stringify(tree.toJSON()), /playback failure/);
            await act(async () => button('settings.diagnostics.playTest').props.onPress());
            assert.equal(played, 1);
            await act(async () => button('원본 스킬·훅 보기').props.onPress());
            assert.equal(routes.at(-1), '/h/host%2Fone/plugin/paseodog-provider/surface/paseodog-native-config');
            await act(async () => tree.update(React.createElement(Component, { ...props, serverId: 'host-two' })));
            await act(async () => button('원본 스킬·훅 보기').props.onPress());
            assert.equal(routes.at(-1), '/h/host-two/plugin/paseodog-provider/surface/paseodog-native-config');
            connected = false;
            await act(async () => tree.update(React.createElement(Component, { ...props, voiceAudioEngine: null })));
            assert.equal(button('원본 스킬·훅 보기').props.disabled, true);
            assert.equal(button('settings.diagnostics.playTest').props.disabled, true);
            connected = true;
            installed = false;
            await act(async () => tree.update(React.createElement(Component, { ...props, isPlaybackTestRunning: true })));
            assert.equal(button('원본 스킬·훅 보기').props.disabled, true);
            assert.equal(button('settings.diagnostics.playing').props.disabled, true);
            await act(async () => button('진단 상세').props.onPress());
            assert.equal(button('원본 스킬·훅 보기'), undefined);
            assert.equal(button('settings.diagnostics.playing'), undefined);
            assert.equal(played, 1);
        } finally {
            await act(async () => tree.unmount());
            connected = true;
            installed = true;
        }
    }
});

// 동일한 compiler cache를 유지한 채 켜기·끄기를 반복해 웹의 조건부 행 갱신을 확인한다.
test('web Auto-Clear details follow the switch without changing thresholds', () => {
    const anchor = patched.indexOf('children:[pe,...(Q?.enabled?[Te,ke,Ve]:[])]');
    const start = patched.lastIndexOf('function we(', anchor);
    const end = patched.indexOf('function je(', anchor);
    const cache = memo(104);
    const element = (type, props) => ({ type, ...props });
    const Tokens = runInNewContext('(' + patched.slice(start, end) + ')', {
        c: { c: () => cache }, C: { jsx: element, jsxs: element, Fragment: 'fragment' },
        I: 'row', D: 'select', w: { Switch: 'switch' }, j: { Button: 'button' },
        b: { SettingsSection: 'section' }, n: { View: 'view' }, S: { settingsStyles: {} },
        M: [], _: [], E: [], z: [], P: [], L: [], fe: 'usage', je: (value) => value,
    });
    const nodes = (node) => {
        if (!node || typeof node !== 'object') return [];
        if (Array.isArray(node)) return node.flatMap(nodes);
        return [node, ...nodes(node.children)];
    };
    let snapshot = { models: [], route: {}, compaction: { auto: true }, sessions: [],
        autoClear: { enabled: false, idleMs: 7200000, minContextPercent: 70 } };
    const calls = [];
    const request = (command) => {
        calls.push(command);
        if (command.action === 'autoClear') snapshot = { ...snapshot,
            autoClear: { ...snapshot.autoClear, enabled: command.enabled } };
    };
    for (const enabled of [false, true, false, true]) {
        const rendered = nodes(Tokens({ snapshot, request, disabled: false }));
        const toggle = rendered.find((node) => node.accessibilityLabel === '유휴 컨텍스트 자동 초기화');
        assert.equal(toggle.value, enabled);
        for (const title of ['유휴 기준 시간', '최소 컨텍스트 점유율', '공급자 기본값 복원']) {
            assert.equal(rendered.some((node) => node.title === title), enabled, title);
        }
        if (enabled) {
            assert.equal(rendered.find((node) => node.type === 'select' && node.title === '유휴 기준 시간').value, '7200000');
            assert.equal(rendered.find((node) => node.type === 'select' && node.title === '최소 컨텍스트 점유율').value, '70');
        }
        toggle.onValueChange(!enabled);
    }
    assert.deepEqual(calls.map((command) => ({ ...command })), [
        { action: 'autoClear', enabled: true }, { action: 'autoClear', enabled: false },
        { action: 'autoClear', enabled: true }, { action: 'autoClear', enabled: false },
    ]);
    assert.equal(snapshot.autoClear.idleMs, 7200000);
    assert.equal(snapshot.autoClear.minContextPercent, 70);
});

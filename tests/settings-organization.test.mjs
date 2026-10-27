import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { runSharedAppTests } from './shared-app-tests.mjs';

const require = createRequire(new URL('../plugin/package.json', import.meta.url));
const React = require('react');
const { create, act } = require('react-test-renderer');
const ts = createRequire(new URL('../android/package.json', import.meta.url))('typescript');
const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const shared = read('android/packages/app/src/screens/settings-screen.tsx');
const plain = (source) => stripTypeScriptTypes(source).replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
const routeSource = plain(read('android/packages/app/src/plugins/routes.ts'));
const buildPluginSurfaceRoute = runInNewContext(routeSource + '; buildPluginSurfaceRoute');
const detailsSource = plain(read('android/packages/app/src/screens/settings/diagnostic-details.ts'));
const compile = (source) => ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.React, jsxFactory: 'React.createElement' },
}).outputText;

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
    for (const Component of [Native]) {
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

// 실제 화면의 Auto-Clear 토글·임계값 보존·섹션 분리를 검사한다.
test('shared Auto-Clear and workflow sections preserve confirmed values', () =>
    runSharedAppTests(['src/screens/settings/ai-engine-page.test.tsx']));

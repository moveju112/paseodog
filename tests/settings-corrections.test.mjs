import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { MAX_TURN_MINUTES } from '../plugin/shared/turn-duration.mjs';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { controlRuntime } from '../engine/src/controls.mjs';
import { compactionSummaryPlan } from '../engine/node_modules/mixdog/src/runtime/agent/orchestrator/session/loop/fresh-context.mjs';
import { createCompactionSettings } from '../engine/node_modules/mixdog/src/session-runtime/settings-compaction-api.mjs';
import { normalizeCompactionConfig } from '../engine/node_modules/mixdog/src/runtime/agent/orchestrator/runtime-core/config-helpers.mjs';
import { runSharedAppTests } from './shared-app-tests.mjs';

// 실제 RPC 스키마와 네이티브 설정 저장기를 메모리 구성으로 연결한다.
test('zero token override resets the native budget through the actual RPC contract', async () => {
    const require = createRequire(new URL('../plugin/package.json', import.meta.url));
    const source = stripTypeScriptTypes(readFileSync(new URL('../plugin/shared/controls.ts', import.meta.url), 'utf8'))
        .replace(/^import .*;\s*$/gm, '').replace(/export const /g, 'const ');
    const { input } = new Function('defineRpc', 'z', 'MAX_TURN_MINUTES', source + '; return engineControls;')(
        (value) => value, require('zod').z, MAX_TURN_MINUTES);
    assert.equal(input.parse({ action: 'turnDuration', maxTurnMinutes: 120 }).maxTurnMinutes, 120);
    for (const value of [0, -1, 1.5, '120', 35792]) {
        assert.equal(input.safeParse({ action: 'turnDuration', maxTurnMinutes: value }).success, false);
    }
    let config = { compaction: { mainBufferTokens: 32000, summaryModel: 'other/small' } };
    const session = { compaction: { ...config.compaction } };
    const native = createCompactionSettings({
        getConfig: () => config, getSession: () => session,
        saveConfigAndAdopt: (value) => { config = value; },
        hasOwn: Object.hasOwn, normalizeCompactionConfig, invalidateContextStatusCache() {},
    });
    const runtime = {
        ...native,
        listProviderModels: async () => [], listWorkflows: () => [], listAgents: () => [],
        getOrchestrationMode: () => 'swarm',
        getAutoClear: () => ({}),
    };
    await controlRuntime(runtime, input.parse({ action: 'compaction', mainBufferTokens: 0, summaryModel: '' }));
    assert.equal(config.compaction.mainBufferTokens, 0);
    assert.equal(config.compaction.summaryModel, undefined);
    assert.equal(session.compaction.summaryModel, undefined);
    for (const mainBufferTokens of [-1, 1, 999, 500001]) {
        assert.equal(input.safeParse({ action: 'compaction', mainBufferTokens }).success, false);
        await assert.rejects(controlRuntime(runtime, { action: 'compaction', mainBufferTokens }), /Invalid mainBufferTokens/);
    }
    assert.equal(input.safeParse({ action: 'compaction', memoryTimeoutMs: 30000 }).success, false);
    await assert.rejects(controlRuntime(runtime, { action: 'compaction', memoryTimeoutMs: 30000 }), /지원하지/);
});

// 공급자 선택·모델 이름·원래 세션 유지와 명시적 비활성·초기화 실패 전파를 검증한다.
test('summary route uses its configured provider and preserves model IDs containing slashes', async () => {
    const resolveRoute = async request => {
        const plan = compactionSummaryPlan(request);
        assert.equal(plan.steps.length, 1);
        return plan.steps[0]();
    };
    const main = { name: 'main', send() {} }, summary = { name: 'summary', send() {} };
    const session = { provider: 'main', model: 'large', compaction: { summaryModel: 'summary/org/small' } };
    const calls = [];
    const request = {
        sessionRef: session, provider: main, model: 'large',
        config: { providers: { main: {}, summary: {} } },
        getProviderFn: (name) => { calls.push(name); return name === 'summary' ? summary : main; },
        initProvidersFn: async () => { calls.push('init'); },
    };
    const result = await resolveRoute(request);
    assert.equal(result.provider, summary);
    assert.equal(result.model, 'org/small');
    assert.equal(result.source, 'summary');
    assert.deepEqual(calls, ['init', 'summary']);
    assert.equal(session.provider, 'main');
    assert.equal(session.model, 'large');
    await assert.rejects(resolveRoute({
        ...request, config: { providers: { summary: { enabled: false } } },
    }), /disabled/);
    await assert.rejects(resolveRoute({
        ...request, initProvidersFn: async () => { throw new Error('initialization failed'); },
    }), /initialization failed/);
    const fallback = await resolveRoute({
        ...request, sessionRef: { provider: 'main', model: 'large' },
        config: { ...request.config, compaction: { summaryMode: 'self' } },
    });
    assert.equal(fallback.provider, main);
    assert.equal(fallback.model, 'large');
});

// 실제 공유 설정 화면에서 토큰 섹션의 저장·실패·연결 상태 계약을 검증한다.
test('shared token settings retain supported controls and confirmed values', () =>
    runSharedAppTests(['src/screens/settings/ai-engine-page.test.tsx']));

// 실제 공통 소스와 고정 번들의 컴포넌트를 평가해 숨긴 항목과 유지한 업데이트 UI를 확인한다.
test('shared and web about settings omit release channels and changelog without hiding updates', () => {
    const jsx = (type, props, ...children) => ({
        type, ...props, children: children.length ? children : props?.children,
    });
    const translation = { t: (key) => key };
    const useAppVersionText = base => `PaseoDog: 1.0.0\n빌드: 42\nPaseo: ${base}`;
    const updater = {
        isDesktopApp: true, statusText: 'up to date', availableUpdate: null,
        errorMessage: null, isChecking: false, isInstalling: false,
        checkForUpdates() {}, installUpdate() {},
    };
    const components = {
        View: 'View', Text: 'Text', Button: 'Button', SettingsSection: 'section',
        PaseodogUpdateRow: 'product-update', ConnectedHostsSection: 'hosts',
    };
    const shared = readFileSync(new URL('../android/packages/app/src/screens/settings-screen.tsx', import.meta.url), 'utf8');
    const ts = createRequire(new URL('../android/package.json', import.meta.url))('typescript');
    const aboutSource = shared.slice(shared.indexOf('function AboutSection('), shared.indexOf('function normalizeVersion('));
    const desktopStart = shared.indexOf('function DesktopAppUpdateRow(');
    const desktopSource = shared.slice(shared.indexOf('function getUpdateButtonLabel('), shared.indexOf('\n// ---', desktopStart));
    const compiled = ts.transpileModule(aboutSource + desktopSource, {
        compilerOptions: { jsx: ts.JsxEmit.React, jsxFactory: 'jsx', jsxFragmentFactory: 'Fragment' },
    }).outputText;
    const native = runInNewContext(compiled + '; [AboutSection, DesktopAppUpdateRow]', {
        ...components, jsx, Fragment: 'Fragment', settingsStyles: {}, styles: {},
        useAppVersionText,
        useTranslation: () => translation, useDesktopAppUpdater: () => updater,
        useCallback: (callback) => callback, useFocusEffect() {},
    });
    function renderedValues(node) {
        if (node == null) return [];
        if (Array.isArray(node)) return node.flatMap(renderedValues);
        if (typeof node !== 'object') return [node];
        return [node.type, ...renderedValues(node.children)];
    }
    for (const about of [native[0]]) {
        for (const isDesktopApp of [false, true]) {
            const values = renderedValues(about({ appVersion: '1.0.0', appVersionText: 'v1.0.0', isDesktopApp }));
            assert.ok(values.includes('settings.about.appVersion'));
            assert.ok(values.includes('PaseoDog: 1.0.0\n빌드: 42\nPaseo: v1.0.0'));
            assert.ok(values.includes('product-update'));
            assert.ok(!values.includes('whats-new'));
            assert.ok(!values.includes('changelog.title'));
            assert.ok(!values.includes('settings.about.whatsNewHint'));
        }
    }
    for (const desktop of [native[1]]) {
        const values = renderedValues(desktop());
        assert.ok(!values.includes('release-channel'));
        assert.ok(!values.includes('settings.about.releaseChannel.label'));
        assert.ok(!values.includes('settings.about.releaseChannel.description'));
        assert.ok(values.includes('settings.about.updates.label'));
        assert.ok(values.includes('settings.about.updates.check'));
        assert.ok(values.includes('settings.about.updates.update'));
        updater.isDesktopApp = false;
        assert.equal(desktop(), null);
        updater.isDesktopApp = true;
    }
});

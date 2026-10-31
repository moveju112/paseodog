import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext, Script } from 'node:vm';
import { installedComposerFixture } from './composer-fixture.mjs';
import { patchedComposerSource, patchedComposerWholeSource, COMPOSER_FILE } from '../scripts/patch-paseo-composer.mjs';
import { withSettingsLayout, withoutSettingsLayout } from '../patches/paseo-settings-layout.mjs';
import { isBasicAgent } from '../android/packages/app/src/screens/settings/basic-agent-roles.ts';

const require = createRequire(new URL('../plugin/package.json', import.meta.url));
const React = require('react');
const { create, act } = require('react-test-renderer');
const compiler = require('react/compiler-runtime');
const ts = createRequire(new URL('../android/package.json', import.meta.url))('typescript');
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const bundle = installedComposerFixture();
const compile = source => ts.transpileModule(source.replace(/^import[\s\S]*?;\s*/gm, '').replace(/^export /gm, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: 'React.createElement' },
}).outputText;
const jsx = (type, props, key) => React.createElement(type, { ...props, key });
const elements = {
    View: 'view', Text: 'text', Pressable: 'pressable', Button: 'button', Switch: 'switch',
    SettingsSection: 'section', AdaptiveTextInput: 'input', SelectField: 'select-field',
    DropdownMenu: 'menu', DropdownTrigger: 'menu-trigger', DropdownMenuItem: 'menu-item',
    DropdownMenuContent: () => null,
    AdaptiveModalSheet: ({ visible, children }) => visible ? React.createElement('dialog', null, children) : null,
    SegmentedControl: 'segments', EngineAccounts: 'accounts',
};
const nativeScreen = read('android/packages/app/src/screens/settings-screen.tsx');
const nativeEngine = read('android/packages/app/src/screens/settings/ai-engine-page.tsx');

function webModule(id, dependencies) {
    const source = bundle.split('\n__d(').find(part => part.includes(`},${id},[`));
    assert.ok(source, `module ${id}`);
    let factory, ids;
    runInNewContext('__d(' + source, {
        __d: (value, actualId, deps) => { assert.equal(actualId, id); factory = value; ids = deps; },
    });
    const exports = {};
    factory({}, dependency => {
        assert.ok(Object.hasOwn(dependencies, dependency), `unexpected dependency ${dependency} in ${id}`);
        return dependencies[dependency];
    }, undefined, undefined, { exports }, exports, ids);
    return exports;
}

const route = { provider: 'test', model: 'model', effort: 'medium', fast: false };
const snapshot = {
    route, models: [{ provider: 'test', id: 'model', label: 'Model', effortOptions: [] }],
    orchestration: 'none', instructionFiles: 'all', workflows: [],
    agents: [
        { id: 'context-explorer', label: 'Context Explorer', description: 'Explore', route },
        { id: 'worker', label: 'Worker', description: 'Work', route },
    ],
    compaction: { auto: true }, sessions: [], outputStyles: [{ id: 'minimal', label: 'Minimal' }],
    skills: { disabled: [], items: [] }, hooks: { rules: [] },
    toolModules: { webSearch: true, memory: { enabled: true }, localProvider: { enabled: true, installed: false } },
};

function enginePage(platform, request) {
    const settings = { snapshot, busy: false, connected: true, request };
    const client = {
        invokePluginRpc: async (_plugin, method) => method === 'agent-message-policy'
            ? { allowUnrelatedSessions: false }
            : { maxTurnMinutes: 120 },
    };
    const runtime = {
        useHostRuntimeClient: () => client,
        useHostRuntimeIsConnected: () => true,
    };
    if (platform === 'app') {
        return runInNewContext(compile(nativeEngine) + ';AiEnginePage', {
            React, ...React, ...elements, isBasicAgent, settingsStyles: {},
            useAiEngineSettings: () => settings,
            AgentMessageSettings: 'messages', TurnDurationSettings: 'duration', SpeechSettings: 'speech',
        });
    }
    return webModule(5346, {
        35: (value, excluded) => Object.fromEntries(Object.entries(value).filter(([key]) => !excluded.includes(key))),
        36: React, 455: compiler, 427: {}, 234: {}, 146: {},
        897: elements, 898: elements, 899: elements, 3922: elements, 3930: elements,
        3953: elements, 4411: elements, 3933: elements, 3949: elements, 3920: elements,
        3220: elements, 3950: { settingsStyles: {} }, 4684: {},
        4683: { useAiEngineSettings: () => settings }, 5347: elements,
        279: { jsx, jsxs: jsx, Fragment: React.Fragment }, 3762: runtime, 4659: elements,
    }).AiEnginePage;
}

test('reorganized web settings preserve the original hash gate and exact optimized output', () => {
    new Script(bundle);
    assert.equal(withSettingsLayout(withoutSettingsLayout(bundle)), bundle);
    assert.equal(patchedComposerSource(bundle), bundle);
    assert.equal(patchedComposerWholeSource(read('tools/node_modules/@getpaseo/server/' + COMPOSER_FILE)), bundle);
    assert.throws(() => patchedComposerSource(bundle.replace('title:"웹 검색 모델"', 'title:"changed"')), /hash mismatch/);
    assert.throws(() => withSettingsLayout(''), /anchor mismatch/);
});

test('all supported host pages have unique menu entries, including restored and relocated sections', () => {
    const native = nativeScreen.match(/const HOST_SECTION_ITEMS: HostSectionItem\[\] = (\[[\s\S]*?\n\]);/)[1];
    const icons = [...new Set([...native.matchAll(/icon: (\w+)/g)].map(([, name]) => name))];
    const nativeItems = runInNewContext(native, Object.fromEntries(icons.map(name => [name, name])));
    const start = bundle.indexOf('const Ae=[') + 'const Ae='.length;
    const webItems = runInNewContext(bundle.slice(start, bundle.indexOf(',Le=', start)), {
        f: Object.fromEntries(icons.map(name => [name, name])),
    });
    assert.deepEqual(Array.from(webItems, item => item.id), Array.from(nativeItems, item => item.id));
    assert.equal(new Set(nativeItems.map(item => item.id)).size, nativeItems.length);
    const expected = ['agents', 'metadata', 'providers', 'plugins', 'engine-response', 'engine-execution', 'engine-speech', 'engine-memory'];
    for (const id of expected) assert.ok(nativeItems.some(item => item.id === id), id);
    const routes = read('android/packages/app/src/utils/host-routes.ts');
    const hostSlugs = runInNewContext(routes.match(/export const HOST_SECTION_SLUGS = (\[[\s\S]*?\]) as const;/)[1]);
    for (const id of hostSlugs) assert.ok(id === 'engine-agents' || nativeItems.some(item => item.id === id), id);
});

test('app and web routes retain every host-specific control at its new destination', () => {
    const names = ['AiEnginePage', 'HostAgentsPage', 'HostToolsSection', 'HostSkillsSection',
        'AppendSystemPromptCard', 'SettingsSection', 'HostProvidersPage', 'MetadataGenerationPage',
        'HostPluginsPage', 'HostSettingsPage', 'HostConnectionsPage', 'HostPairDevicePage',
        'HostWorkspacesPage', 'HostUsagePage', 'HostTerminalsPage'];
    const components = Object.fromEntries(names.map(name => [name, name]));
    const start = nativeScreen.indexOf('const STANDALONE_ENGINE_SECTIONS:');
    const end = nativeScreen.indexOf('function sidebarItemStyle(', start);
    const native = runInNewContext(compile(nativeScreen.slice(start, end)) + ';renderHostSettingsContent', {
        React, ...components, ProjectsScreen: 'projects',
    });
    const webStart = bundle.indexOf('function Re(e,t){');
    const webEnd = bundle.indexOf('function ze(', webStart);
    const web = runInNewContext(bundle.slice(webStart, webEnd) + ';Re', {
        c: React, Pe: { jsx, jsxs: jsx }, xe: components, pe: components, T: components,
        Se: components, ye: components, fe: { default: 'projects' }, me: { default: 'project' },
    });
    const leaves = node => {
        if (!node) return [];
        if (Array.isArray(node)) return node.flatMap(leaves);
        if (node.type === React.Fragment) return leaves(node.props.children);
        if (node.type === 'SettingsSection') return leaves(node.props.children);
        return [`${node.type}${node.props.section ? ':' + node.props.section : ''}`];
    };
    const expected = {
        agents: ['AiEnginePage:agents', 'HostAgentsPage'],
        'engine-tools': ['AiEnginePage:tools', 'HostToolsSection'],
        'engine-instructions': ['AiEnginePage:instructions', 'AppendSystemPromptCard'],
        'engine-skills': ['AiEnginePage:skills', 'HostSkillsSection'],
        'engine-speech': ['AiEnginePage:speech'],
        'engine-response': ['AiEnginePage:response'],
        'engine-execution': ['AiEnginePage:execution'],
        'engine-memory': ['AiEnginePage:memory'],
        metadata: ['AiEnginePage:generation', 'MetadataGenerationPage'],
        providers: ['AiEnginePage:providers', 'HostProvidersPage'],
        plugins: ['HostPluginsPage'],
    };
    for (const render of [native, web]) {
        for (const [section, types] of Object.entries(expected)) {
            assert.deepEqual(leaves(render({ kind: 'host', serverId: 'selected-host', section }, () => {})), types);
        }
    }
});

for (const platform of ['app', 'web']) {
    test(`${platform}: each engine category renders only its controls and keeps write commands`, async t => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        const calls = [];
        const Page = enginePage(platform, async command => { calls.push(command); return true; });
        const sections = {
            workflow: ['작업 규칙', '자동 오케스트레이터 (Orchestration)'],
            agents: ['기본 에이전트', '하위 에이전트'],
            response: ['출력 스타일 및 사용자 프로필'],
            execution: ['실행 쉘'],
            generation: ['세션 제목'],
            memory: ['메모리'],
            providers: ['로컬 모델 확장'],
            tools: ['내장 도구 모듈 (Built-in Tools)', '웹 검색 모델'],
            tokens: ['Mixdog 토큰 절감 기술', '유휴 세션 자동 비우기 (Auto-Clear)', '열린 세션 컨텍스트 사용량'],
        };
        let tree;
        await act(async () => { tree = create(null); });
        t.after(async () => {
            await act(async () => tree.unmount());
            delete globalThis.IS_REACT_ACT_ENVIRONMENT;
        });
        for (const [section, titles] of Object.entries(sections)) {
            await act(async () => tree.update(React.createElement(Page, { key: section, serverId: 'one', section })));
            assert.deepEqual(tree.root.findAllByType('section').map(node => node.props.title), titles);
            const labels = tree.root.findAllByType('switch').map(node => node.props.accessibilityLabel);
            assert.equal(labels.includes('장기 메모리 도구'), section === 'memory');
            assert.equal(labels.includes('백그라운드 메모리'), section === 'memory');
            assert.equal(labels.includes('로컬 모델 공급자'), section === 'providers');
            assert.equal(labels.includes('웹 검색 도구'), section === 'tools');
            assert.equal(labels.includes('AI 세션 제목 자동 생성'), section === 'generation');
            assert.equal(tree.root.findAllByType('segments').length, 0);
            if (section === 'memory') {
                await act(async () => tree.root.findAllByType('switch')[0].props.onValueChange(false));
                await act(async () => tree.root.findAllByType('switch')[1].props.onValueChange(false));
            }
        }
        assert.deepEqual(calls.map(command => ({ ...command })), [
            { action: 'features', memoryTools: false }, { action: 'features', recap: false },
        ]);
    });
}

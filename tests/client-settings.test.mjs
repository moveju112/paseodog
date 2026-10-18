import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../plugin/package.json', import.meta.url));
const { build } = require('esbuild');
const React = require('react');
const { create, act } = require('react-test-renderer');

test('engine settings renders native options and sends scoped changes with errors visible', async (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'paseodog-client-test-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const output = join(directory, 'client.cjs');
    await build({
        entryPoints: [fileURLToPath(new URL('../plugin/index.client.tsx', import.meta.url))],
        bundle: true, platform: 'node', format: 'cjs', outfile: output,
        plugins: [{
            name: 'test-host',
            setup(builder) {
                builder.onResolve({ filter: /^react$/ }, () => ({ path: require.resolve('react'), external: true }));
                builder.onResolve({ filter: /^(react-native|@getpaseo\/plugin(?:\/client(?:\/react-native)?)?)$/ },
                    ({ path }) => ({ path, namespace: 'host' }));
                builder.onLoad({ filter: /.*/, namespace: 'host' }, ({ path }) => ({
                    contents: path === '@getpaseo/plugin'
                        ? 'export const defineRpc = value => value;'
                        : path === '@getpaseo/plugin/client'
                            ? 'export const useRpc = () => globalThis.__paseodogTestRpc;'
                            : 'export const Pressable="pressable", Text="text", TextInput="input", View="view", ScrollView="scroll"; export const AppState={currentState:"active",addEventListener:()=>({remove(){}})};',
                }));
            },
        }],
    });
    const calls = [];
    const snapshot = {
        route: { provider: 'subscription', model: 'small', effort: 'low', fast: false, autoEffort: false },
        models: [{ provider: 'subscription', id: 'small', label: 'Small', fastCapable: true,
            effortOptions: [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High' }] }],
        compaction: { auto: true }, workflows: [{ id: 'default', name: 'Default', active: true }],
        orchestration: 'balanced', agents: [{ id: 'worker', label: 'Worker', disabled: false,
            route: { provider: 'subscription', model: 'small', effort: 'low', autoEffort: false, fast: false } }],
        sessions: [{ id: 's1', running: true, model: 'small', compaction: { auto: true },
            context: { usedTokens: 42 }, jobs: [{ id: 'j1', agent: 'worker', status: 'running' }] }],
    };
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.__paseodogTestRpc = async (input) => { calls.push(input); return snapshot; };
    let screen, liveScreen, tree;
    require(output).default({
        addSettingsScreen(value) { screen = value; return () => {}; },
        addScreen(value) { liveScreen = value; return () => {}; },
        addWorkspacePanel() { return () => {}; },
        addSidebarFooterItem() { return () => {}; },
    });
    assert.equal(screen.id, 'mixdog-engine');
    await act(async () => {
        tree = create(React.createElement(screen.Component, {
            theme: { colors: { foreground: '#ffffff' } }, host: { id: 'test', label: 'test' },
            layout: { compact: true, platform: 'android' },
        }));
    });
    t.after(async () => {
        await act(async () => tree.unmount());
        delete globalThis.__paseodogTestRpc;
        delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    });
    const press = async (label) => {
        const element = tree.root.findAllByType('pressable').find((node) =>
            node.findByType('text').children.join('') === label);
        assert.ok(element, `button ${label}`);
        await act(async () => element.props.onPress());
    };
    assert.equal(calls[0].action, 'read');
    assert.match(JSON.stringify(tree.toJSON()), /usedTokens/);
    await press('자동 압축: 켜짐');
    assert.deepEqual(calls.at(-1), { action: 'compaction', enabled: false });
    await press('Worker · 켜짐');
    await press('추론: High');
    assert.deepEqual(calls.at(-1), { action: 'agent', agent: 'worker', route: { effort: 'high' } });
    await press('swarm');
    assert.deepEqual(calls.at(-1), { action: 'orchestration', mode: 'swarm' });
    globalThis.__paseodogTestRpc = async () => { throw new Error('설정 서버 연결 실패'); };
    await act(async () => tree.update(React.createElement(screen.Component, {
        theme: { colors: { foreground: '#ffffff' } }, host: { id: 'test', label: 'test' },
        layout: { compact: true, platform: 'android' },
    })));
    await press('목록·실행 상태 새로고침');
    assert.match(JSON.stringify(tree.toJSON()), /설정 서버 연결 실패/);
    assert.equal(liveScreen.id, 'mixdog-live');
    globalThis.__paseodogTestRpc = async () => ({
        observedAt: Date.now(),
        sessions: [{ id: 's1', state: 'waiting-approval', approvalCount: 1,
            workflow: { id: 'default', name: 'Default' }, orchestration: 'swarm',
            model: 'small', provider: 'subscription', effort: 'low', compaction: { auto: true },
            jobs: [{ id: 'job_native', agent: 'worker', tag: 'review', model: 'small',
                provider: 'subscription', status: 'running', waitingApproval: true }] }],
    });
    let liveTree;
    await act(async () => {
        liveTree = create(React.createElement(liveScreen.Component, {
            theme: { colors: { foreground: '#ffffff' } }, host: { id: 'test', label: 'test' },
            layout: { compact: true, platform: 'android' },
        }));
    });
    assert.match(JSON.stringify(liveTree.toJSON()), /승인 대기/);
    assert.match(JSON.stringify(liveTree.toJSON()), /job_native/);
    assert.match(JSON.stringify(liveTree.toJSON()), /Default/);
    await act(async () => liveTree.unmount());
});

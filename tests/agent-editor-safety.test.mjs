import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { controlRuntime } from '../engine/src/controls.mjs';
import { AGENT_PATCHES, gitBlob, patch, patchedAgentSource } from '../scripts/patch-mixdog.mjs';
import { AGENT_EDITOR_SAFETY_PATCHES } from '../patches/agent-editor-safety.mjs';
import { createAgentRouteApi } from '../engine/node_modules/mixdog/src/session-runtime/workflow-agents-api/agent-route.mjs';
import { runSharedAppTests } from './shared-app-tests.mjs';

test('duplicate native patch targets fail before reading or writing runtime files', () => {
    AGENT_PATCHES.push(AGENT_PATCHES[0]);
    try {
        assert.throws(() => patch('/unread-runtime'), /Duplicate Mixdog patch target/);
    } finally {
        AGENT_PATCHES.pop();
    }
});

test('native route original, previous release and installed bytes converge without hash bypass', () => {
    const spec = AGENT_PATCHES.find(({ file }) => file === 'src/session-runtime/workflow-agents-api/agent-route.mjs');
    const installed = readFileSync(new URL('../engine/node_modules/mixdog/' + spec.file, import.meta.url), 'utf8');
    const original = [...spec.edits].reverse().reduce((source, [before, after]) => source.replace(after, () => before), installed);
    assert.equal(gitBlob(original), spec.blob);
    const previous = spec.edits.slice(0, spec.previousEditCount).reduce((source, [before, after]) => source.replace(before, () => after), original);
    const expected = patchedAgentSource(original, spec);
    assert.equal(patchedAgentSource(previous, spec), expected);
    assert.equal(patchedAgentSource(installed, spec), expected);
    assert.throws(() => patchedAgentSource(previous + '// drift', spec), /hash mismatch/);
});

// 실제 제어 함수가 사용할 최소 읽기 전용 런타임을 만든다.
function runtime() {
    return {
        listAgents: () => [{ id: 'worker', route: { provider: 'openai', model: 'test' } }],
        listWorkflows: () => [],
        listProviderModels: () => [],
        getOrchestrationMode: () => 'none',
    };
}

test('create rejects an existing id; save requires the original revision and forwards it', async () => {
    const value = runtime();
    const writes = [];
    value.saveAgentDefinition = async (payload) => { writes.push(payload); return payload; };
    await assert.rejects(controlRuntime(value, { action: 'agentCreate', agent: 'worker', body: 'new' }), /already exists/);
    await assert.rejects(controlRuntime(value, { action: 'agentSave', agent: 'worker', body: 'new' }), /Reload/);
    assert.equal(writes.length, 0);
    await controlRuntime(value, { action: 'agentSave', agent: 'worker', body: 'new', expectedRevision: 'a'.repeat(24) });
    assert.equal(writes[0].expectedRevision, 'a'.repeat(24));
});

test('unsupported worktree updates fail before any other preferences are changed', async () => {
    const value = runtime();
    value.setOutputStyle = () => assert.fail('must not change preferences');
    await assert.rejects(controlRuntime(value, { action: 'preferences', outputStyle: 'concise',
        worktree: { newTaskDefault: 'worktree' } }), /not supported/);
});

// 고정 네이티브 함수 그대로 실행하되 파일·설정 쓰기만 메모리로 치환한다.
function nativeEditor(prepareRoute) {
    const spec = AGENT_EDITOR_SAFETY_PATCHES[0];
    const source = patchedAgentSource(readFileSync(new URL('../engine/node_modules/mixdog/' + spec.file, import.meta.url), 'utf8'), spec);
    const start = source.indexOf('async function saveAgentDefinition(payload = {}, options) {');
    const end = source.indexOf('\n\n  const { dropAgentRoute, deleteAgentDefinition', start);
    assert.ok(start >= 0 && end > start);
    const state = { revision: 'a'.repeat(24), current: { body: 'original' }, writes: [], routeWrites: 0 };
    const save = vm.runInNewContext(`(${source.slice(start, end)})`, {
        deps: {}, STANDALONE_ROOT: '/memory', BOT_AGENT_KIND: 'bot', AGENT_DEFINITION_CONFLICT: 'AGENT_DEFINITION_CONFLICT',
        hasOwn: Object.hasOwn, resolveDataDir: () => '/memory', resolveSaveTarget: (p) => p,
        definitionRevision: () => state.revision, loadAgentDefinition: () => state.current,
        isArchivedAgent: () => false, creationKind: () => 'agent',
        hiddenManifest: (v) => v, manifestForUpdate: () => ({}), botStoreActive: () => false,
        userDir: () => '/memory/agents/worker', botDir: () => '/memory/bots/worker',
        stableJson: JSON.stringify, readManifest: () => ({}), shippedDir: () => '/memory/shipped/worker',
        absorbSaveEqualToShipped: () => false, hiddenFrontmatter: () => ({}),
        applyManifestEdits: () => ({}),
        writeSavedDefinition: (_dir, value) => { state.writes.push(value); state.current = value; },
        clearAgentDefinitionCache: () => {}, getConfig: () => ({}), isAgentDisabled: () => false,
        setAgentRoute: async (...args) => {
            assert.equal(args[2].prepareOnly, true);
            await prepareRoute?.(state);
            return () => { state.routeWrites++; };
        },
        announceBotChange: async () => {}, getAgentDefinition: () => state.current,
    });
    return { save, state };
}

test('route validation failure leaves the original definition untouched', async () => {
    const { save, state } = nativeEditor(() => { throw new Error('model unavailable'); });
    await assert.rejects(save({ id: 'worker', body: 'replacement', route: { provider: 'openai', model: 'test' } }), /model unavailable/);
    assert.equal(state.current.body, 'original');
    assert.deepEqual(state.writes, []);
    assert.equal(state.routeWrites, 0);
});

test('revision and duplicate creation are checked again after asynchronous route preparation', async () => {
    const edit = nativeEditor((state) => { state.revision = 'b'.repeat(24); });
    await assert.rejects(edit.save({ id: 'worker', body: 'replacement', expectedRevision: 'a'.repeat(24), route: {} }), /CONFLICT/);
    assert.equal(edit.state.writes.length, 0);
    const create = nativeEditor((state) => { state.current = { body: 'created elsewhere' }; });
    create.state.current = null;
    await assert.rejects(create.save({ id: 'worker', body: 'replacement', createOnly: true, route: {} }), /already exists/);
    assert.equal(create.state.writes.length, 0);
});

test('successful prepared save applies body and route once', async () => {
    const { save, state } = nativeEditor();
    await save({ id: 'worker', body: 'replacement', expectedRevision: state.revision, route: {} });
    assert.equal(state.current.body, 'replacement');
    assert.equal(state.writes.length, 1);
    assert.equal(state.routeWrites, 1);
});

test('native route preparation performs no config write until explicitly committed', async () => {
    let config = { provider: 'openai', model: 'test', providers: { openai: { enabled: true } }, agents: {} };
    let writes = 0;
    const api = createAgentRouteApi({
        getConfig: () => config,
        resolveRoute: (_config, route) => route,
        lookupModelMeta: async () => ({ id: 'test', contextWindow: 128000 }),
        ensureProvidersReady: async () => {},
        agentRouteFromConfig: (value, id) => value.agents[id],
        saveConfigAndAdopt: (value) => { config = value; writes++; },
    });
    const commit = await api.setAgentRoute('worker', { provider: 'openai', model: 'test' }, { prepareOnly: true });
    assert.equal(typeof commit, 'function');
    assert.equal(writes, 0);
    await commit();
    assert.equal(writes, 1);
    assert.equal(config.agents.worker.model, 'test');
});

test('shared settings preserve editor failure and revision safety', () =>
    runSharedAppTests(['src/screens/settings/ai-engine-page.test.tsx']));

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { controlRuntime } from '../engine/src/controls.mjs';
import { AGENT_PATCHES, patchedAgentSource, PIN, patch } from '../scripts/patch-mixdog.mjs';
import { createWorkflowHelpers } from '../engine/node_modules/mixdog/src/runtime/agent/orchestrator/runtime-core/workflow.mjs';
import { readMarkdownDocument, normalizeAgentPermissionOrNone } from '../engine/node_modules/mixdog/src/runtime/shared/markdown-frontmatter.mjs';
import { createWorkflowPacksApi } from '../engine/node_modules/mixdog/src/session-runtime/workflow-agents-api/workflow-packs.mjs';
import { createAgentEditorApi } from '../engine/node_modules/mixdog/src/session-runtime/workflow-agents-api/agent-editor.mjs';
import { withEffectiveDisabledAgents } from '../engine/node_modules/mixdog/src/runtime/shared/agent-route-config.mjs';
import { STANDALONE_ROOT } from '../engine/node_modules/mixdog/src/session-runtime/runtime-paths.mjs';

// 설치한 npm 원본의 모든 패치 게이트와 새 콜백 전달을 함께 검증한다.
test('installed 1.3.1 preserves full-source gates and stream/completion callbacks', async () => {
    assert.equal(PIN, '1.3.1');
    const root = new URL('../engine/node_modules/mixdog/', import.meta.url);
    assert.equal(patch(root.pathname, { check: true }).version, PIN);
    for (const spec of AGENT_PATCHES) {
        const source = await readFile(new URL(spec.file, root), 'utf8');
        assert.equal(patchedAgentSource(source, spec), source);
        assert.throws(() => patchedAgentSource(source + '\n// upstream drift\n', spec), /hash mismatch/);
    }
    const { createAskCallbacks } = await import(
        '../engine/node_modules/mixdog/src/session-runtime/turn/turn-run/ask-callbacks.mjs');
    const onStreamItemStart = () => {};
    const { askCallbacks } = createAskCallbacks({ transcript: {}, hooks: {}, notifyFnForSession: () => () => {} });
    const callbacks = askCallbacks({ snapshot: {}, timing: {} }, { id: 'test' },
        { onStreamItemStart, hostManagedCompletions: true });
    assert.equal(callbacks.onStreamItemStart, onStreamItemStart);
    assert.equal(callbacks.hostManagedCompletions, true);
});

test('installed native workflow persistence retains original body and leaves native agent defaults untouched', async (t) => {
    const dataDir = await mkdtemp(join(tmpdir(), 'paseodog-native-templates-'));
    t.after(() => rm(dataDir, { recursive: true, force: true }));
    const config = withEffectiveDisabledAgents({ agents: {} });
    const initialConfig = structuredClone(config);
    const helpers = createWorkflowHelpers({
        rootDir: STANDALONE_ROOT, dataDir, readMarkdownDocument, normalizeAgentPermissionOrNone,
    });
    const deps = {
        ...helpers,
        rootDir: STANDALONE_ROOT,
        cfgMod: { getPluginData: () => dataDir },
        getConfig: () => config,
        displayConfig: () => config,
        saveConfigAndAdopt: () => { throw new Error('Unexpected config mutation'); },
        agentRouteFromConfig: () => null,
        resolveRoute: () => ({ provider: 'subscription', model: 'small' }),
        setAgentRoute: () => { throw new Error('Unexpected agent route mutation'); },
    };
    const workflows = createWorkflowPacksApi(deps);
    const agents = createAgentEditorApi(deps);
    const value = {
        ...workflows,
        listAgents: agents.listAgents,
        listProviderModels: async () => [],
        getOrchestrationMode: () => 'focused',
        setRoute: () => { throw new Error('Unexpected main route mutation'); },
        setAgentRoute: deps.setAgentRoute,
    };
    const originalWorkflow = await readFile(join(STANDALONE_ROOT, 'workflows/default/WORKFLOW.md'));
    const originals = new Map();
    for (const row of agents.listAgents()) {
        const source = await readFile(join(STANDALONE_ROOT, 'agents', row.id, 'AGENT.md'));
        originals.set(row.id, source);
        assert.deepEqual(Buffer.from(row.definition.body),
            Buffer.from(readMarkdownDocument(source.toString('utf8')).body));
        assert.equal(row.disabled, true);
    }
    assert.ok(originals.size > 0);
    // 사용자 default override가 있어도 신규 기본 본문은 설치된 원본을 사용한다.
    await workflows.saveWorkflowPack({ id: 'default', name: 'Changed', body: '# User override' });
    const expected = Buffer.from(readMarkdownDocument(originalWorkflow.toString('utf8')).body);
    for (const body of [undefined]) {
        const result = await controlRuntime(value, {
            action: 'workflowCreate', name: 'Original copy', description: 'Custom metadata',
            body, activate: false,
        });
        assert.deepEqual(Buffer.from(result.workflowPack.body), expected);
        assert.deepEqual(Buffer.from(readMarkdownDocument(await readFile(
            join(dataDir, 'workflows', result.workflowPack.id, 'WORKFLOW.md'), 'utf8',
        )).body), expected);
        assert.ok(result.agents.every((row) => row.disabled));
    }
    value.getAgentDefinition = agents.getAgentDefinition;
    for (const [id, source] of originals) {
        assert.deepEqual(Buffer.from(agents.getAgentDefinition(id).body),
            Buffer.from(readMarkdownDocument(source.toString('utf8')).body));
        const inspected = await controlRuntime(value, { action: 'agentDefinition', agent: id });
        assert.deepEqual(Buffer.from(inspected.agentDefinition.body),
            Buffer.from(readMarkdownDocument(source.toString('utf8')).body));
        assert.deepEqual(await readFile(join(STANDALONE_ROOT, 'agents', id, 'AGENT.md')), source);
    }
    assert.deepEqual(await readFile(join(STANDALONE_ROOT, 'workflows/default/WORKFLOW.md')), originalWorkflow);
    assert.deepEqual(config, initialConfig);
    assert.deepEqual(await readdir(dataDir), ['workflows']);
});

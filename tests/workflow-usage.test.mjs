import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { controlRuntime } from '../engine/src/controls.mjs';
import { createEngineControls } from '../plugin/server/controls.mjs';
import { patchPaseoUsage } from '../scripts/patch-paseo-usage.mjs';
import { createWorkflowHelpers } from '../engine/node_modules/mixdog/src/runtime/agent/orchestrator/runtime-core/workflow.mjs';
import { createWorkflowPacksApi } from '../engine/node_modules/mixdog/src/session-runtime/workflow-agents-api/workflow-packs.mjs';
import { readMarkdownDocument } from '../engine/node_modules/mixdog/src/runtime/shared/markdown-frontmatter.mjs';

test('Claude usage uses native refresh and exports only public quota fields', async () => {
    const calls = [];
    const result = await controlRuntime({
        async getUsageDashboard(input) {
            calls.push(input);
            return { rows: [{
                id: 'anthropic-oauth', authenticated: true, updatedAt: 1792378800000,
                config: { secret: 'never-export' },
                windows: [{ label: '5H', usedPct: 24, resetAt: 1792382400000 }],
            }] };
        },
    }, { action: 'usage' });
    assert.deepEqual(calls, [{
        refresh: true, refreshSetup: false, refreshProviders: ['anthropic-oauth'],
    }]);
    assert.equal(result.status, 'available');
    assert.deepEqual(result.windows, [{
        id: 'claude-0', label: '5H', summary: true, usedPct: 24,
        resetsAt: '2026-10-19T04:00:00.000Z',
    }]);
    assert.doesNotMatch(JSON.stringify(result), /never-export|config|accessToken|refreshToken/);
});

test('missing auth, failed quota and stale successful quota remain distinguishable', async () => {
    for (const rows of [[], [{ id: 'anthropic-oauth', authenticated: false }],
        [{ id: 'anthropic-oauth', authenticated: true, windows: [] }]]) {
        const result = await controlRuntime({ getUsageDashboard: async () => ({ rows }) }, { action: 'usage' });
        assert.equal(result.status, 'error');
    }
    await assert.rejects(controlRuntime({
        getUsageDashboard: async () => { throw new Error('native failure'); },
    }, { action: 'usage' }), /native failure/);
});

test('usage does not reuse or replace the settings snapshot cache', async () => {
    const calls = [];
    const controls = createEngineControls({
        async execCommand(command, args) {
            const request = JSON.parse(args.at(-1));
            calls.push(request);
            return { stdout: JSON.stringify(request.action === 'usage'
                ? { status: 'available', windows: [] } : { route: { model: 'small' } }) };
        },
    });
    controls.bind({ command: '/engine', args: [], env: {} });
    const settings = await controls.read();
    await controls.usage();
    await controls.usage();
    assert.deepEqual(await controls.read(), settings);
    assert.deepEqual(calls, [{}, { action: 'usage' }, { action: 'usage' }, {}]);
    await controls.close();
});

test('installed Paseo disables obsolete Claude and unused Copilot usage sources, not providers', async () => {
    const root = new URL('../tools/node_modules/@getpaseo/server/', import.meta.url).pathname;
    patchPaseoUsage(root, { check: true });
    const { builtinPlugins } = await import(
        '../tools/node_modules/@getpaseo/server/dist/server/server/plugins/builtin/index.js');
    assert.equal(builtinPlugins.includes('claude-usage-source'), false);
    assert.equal(builtinPlugins.includes('copilot-usage-source'), false);
    assert.equal(builtinPlugins.includes('antigravity-provider'), true);
    assert.equal(builtinPlugins.includes('muse-provider'), true);
    assert.equal(builtinPlugins.includes('codex-usage-source'), true);
});

test('disabled native workflow never reads Markdown or falls back to Default', async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'paseodog-no-workflow-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const helpers = createWorkflowHelpers({
        rootDir: directory, dataDir: directory,
        readMarkdownDocument() { throw new Error('Unexpected Markdown read'); },
    });
    let config = { workflow: { active: 'default' }, instructionFiles: 'all', orchestration: { mode: 'none' } };
    const api = createWorkflowPacksApi({
        ...helpers, cfgMod: { getPluginData: () => directory },
        getConfig: () => config, displayConfig: () => config,
        saveConfigAndAdopt: (next) => { config = next; },
    });
    await api.setWorkflow('none');
    assert.equal(config.workflow.active, 'none');
    assert.equal(config.instructionFiles, 'all');
    assert.equal(api.listWorkflows().find((row) => row.id === 'none').active, true);
    assert.equal(helpers.activeWorkflowContext(config, directory).packContext, '');
    assert.equal(helpers.activeWorkflowSummary(config, directory).id, 'none');
    await assert.rejects(api.saveWorkflowPack({ id: 'none', body: '# Unexpected' }), /reserved/);
});

test('empty native workflow round-trips without a built-in fallback or prompt header', async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'paseodog-empty-workflow-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const helpers = createWorkflowHelpers({
        rootDir: directory, dataDir: directory, readMarkdownDocument,
    });
    const config = { workflow: { active: 'default' } };
    const api = createWorkflowPacksApi({
        ...helpers, rootDir: directory, cfgMod: { getPluginData: () => directory },
        getConfig: () => config, displayConfig: () => config,
        saveConfigAndAdopt: (next) => { Object.assign(config, next); },
    });
    const saved = await api.saveWorkflowPack({ id: 'default', name: 'Default', body: ' \n\t' });
    assert.equal(saved.body, '');
    assert.equal(config.workflow.active, 'none');
    assert.equal(api.getWorkflowPack('default').body, '');
    assert.equal(helpers.activeWorkflowContext(config, directory).packContext, '');
    assert.match(await readFile(join(directory, 'workflows/default/WORKFLOW.md'), 'utf8'), /id: default/);
});

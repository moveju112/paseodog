import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPaseoToolCatalog } from '../tools/node_modules/@getpaseo/server/dist/server/server/agent/tools/paseo-tools.js';
import { PASEO_ISOLATION_PATCHES, patchedSessionIsolationSource } from '../scripts/patch-paseo-session-isolation.mjs';
import { fixture, until } from './helpers.mjs';

test('the actual pinned MCP catalog has no inter-session sender but retains ordinary agent tools', async () => {
    const logger = { child() { return this; } };
    for (const callerAgentId of [undefined, 'fixture-caller']) {
        const catalog = await createPaseoToolCatalog({
            agentManager: {}, agentStorage: {}, providerSnapshotManager: {}, logger, callerAgentId,
        });
        assert.equal(catalog.tools.has('send_agent_prompt'), false);
        assert.equal(catalog.tools.has('create_agent'), true);
        assert.equal(catalog.tools.has('get_agent_status'), true);
        await assert.rejects(catalog.executeTool('send_agent_prompt', { agentId: 'another', prompt: 'must not run' }),
            /Unknown tool|not found|not available/);
    }
});

test('the removed session sender cannot enter through an old authenticated prompt envelope', async t => {
    const f = fixture();
    t.after(() => f.connection.close());
    await f.ready();
    await f.connection.send({
        ...f.prompt,
        prompt: { ...f.prompt.prompt, source: { kind: 'agent', agentId: 'another-session' } },
    });
    await until(f.events, event => event.type === 'session.prompt_result');
    assert.equal(f.calls.length, 0);
    assert.ok(f.events.some(event => event.type === 'session.prompt_result' && event.result?.type === 'failed'
        && /Inter-session messages are not supported/.test(JSON.stringify(event))));
});

test('agent-scoped metadata updates still cannot forge a parent relationship', async () => {
    const logger = { child() { return this; } };
    const catalog = await createPaseoToolCatalog({
        agentManager: {}, agentStorage: {}, providerSnapshotManager: {}, logger, callerAgentId: 'fixture-caller',
    });
    await assert.rejects(catalog.executeTool('update_agent', {
        agentId: 'target', labels: { 'paseo.parent-agent-id': 'fixture-caller' }, settings: { modeId: 'bypassPermissions' },
    }), /Agent parent relationship is assigned by the server/);
});

test('MCP identity and sender removal remain version/blob gated and idempotent', () => {
    for (const spec of PASEO_ISOLATION_PATCHES) {
        const source = readFileSync(new URL('../tools/node_modules/@getpaseo/server/' + spec.file, import.meta.url), 'utf8');
        const patched = patchedSessionIsolationSource(source, spec);
        assert.equal(patchedSessionIsolationSource(patched, spec), patched);
        assert.throws(() => patchedSessionIsolationSource(source + '// drift', spec), /hash mismatch/);
    }
});

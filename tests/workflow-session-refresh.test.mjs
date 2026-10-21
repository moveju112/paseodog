import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolPolicyRefresh } from '../engine/node_modules/mixdog/src/session-runtime/tool-policy-refresh.mjs';

function setup() {
    const conversation = [{ role: 'user', content: 'Keep my conversation' }, { role: 'assistant', content: 'Prior answer' }];
    const session = {
        id: 'same-session', provider: 'test', owner: 'cli', cwd: '/project',
        tools: [{ name: 'read' }], deferredToolCatalog: [{ name: 'shell' }],
        callerDisallowedTools: [], schemaAllowedTools: null,
        workflow: { id: 'default' }, bp3CoreContext: '# Active Workflow: Default\nOld approval rule',
        bp3EnvironmentContext: 'ORIGINAL ENV', bp3EnvSplit: true,
        promptIdentity: { skipAgentRules: true, systemPrompt: 'PRIVATE USER PROMPT', profileSkip: { claudemd: true } },
        messages: [{ role: 'system', content: 'BASE RULES' }, { role: 'system', cacheTier: 'tier3', content: '# Active Workflow: Default\nOld approval rule' },
            { role: 'system', cacheTier: 'env', content: 'ORIGINAL ENV' }, ...conversation],
        providerState: { continuation: 'old' }, _providerPrefixGuardState: { old: true },
    };
    let active = 0, context = '', memoryFailure = false;
    const policy = createToolPolicyRefresh({
        getSession: () => session, getActiveTurnCount: () => active,
        getConfig: () => ({}), getDataDir: () => '/unused', getRoute: () => ({ provider: 'test' }),
        getMode: () => 'full', featureDisallowedTools: () => [],
        loadCoreMemoryContext: async () => {
            if (memoryFailure) throw new Error('Memory unavailable');
            return 'Remember this fact';
        },
        activeWorkflowContext: () => ({ summary: { id: context ? 'custom' : 'none' }, leadPromptParts: () => ({}), packContext: context, orchestrationMode: 'swarm' }),
    });
    return { policy, session, conversation, busy: (value) => { active = value; },
        context: (value) => { context = value; }, failMemory: () => { memoryFailure = true; } };
}

test('workflow none removes frozen old rules without replacing conversation, environment or schemas', async () => {
    const f = setup(), tools = f.session.tools, catalog = f.session.deferredToolCatalog;
    assert.deepEqual(await f.policy.refreshEmptySessionToolPolicy({ workflowOnly: true }), { appliedToCurrentSession: true });
    assert.equal(f.session.id, 'same-session');
    assert.equal(f.session.workflow.id, 'none');
    assert.doesNotMatch(f.session.bp3CoreContext, /Old approval rule|Active Workflow/);
    assert.match(f.session.bp3CoreContext, /PRIVATE USER PROMPT/);
    assert.match(f.session.bp3CoreContext, /Remember this fact/);
    assert.deepEqual(f.session.messages.slice(3), f.conversation);
    assert.equal(f.session.messages[0].content, 'BASE RULES');
    assert.equal(f.session.messages[2].content, 'ORIGINAL ENV');
    assert.equal(f.session.tools, tools); assert.equal(f.session.deferredToolCatalog, catalog);
    assert.equal(f.session.providerState, undefined);
    assert.equal(f.session._providerPrefixGuardState, undefined);
});

test('an active turn cannot be rewritten and the next idle boundary applies current instructions', async () => {
    const f = setup(), before = structuredClone(f.session);
    f.busy(1);
    assert.equal((await f.policy.refreshEmptySessionToolPolicy({ workflowOnly: true })).appliedToCurrentSession, false);
    assert.deepEqual(f.session, before);
    f.busy(0); f.context('# Active Workflow: Custom\nNew rules');
    await f.policy.refreshEmptySessionToolPolicy({ workflowOnly: true });
    assert.match(f.session.bp3CoreContext, /New rules/);
    f.context('# Active Workflow: Custom\nEdited rules');
    await f.policy.refreshEmptySessionToolPolicy({ workflowOnly: true });
    assert.match(f.session.bp3CoreContext, /Edited rules/);
    assert.doesNotMatch(f.session.bp3CoreContext, /New rules/);
});

test('unidentified legacy prompts are preserved, not guessed away', async () => {
    const f = setup();
    delete f.session.promptIdentity;
    const before = structuredClone(f.session);
    assert.equal((await f.policy.refreshEmptySessionToolPolicy({ workflowOnly: true })).reason, 'missing-prompt-identity');
    assert.deepEqual(f.session, before);
});

test('a failed native memory read cannot erase existing context during refresh', async () => {
    const f = setup(), before = structuredClone(f.session);
    f.failMemory();
    await assert.rejects(f.policy.refreshEmptySessionToolPolicy({ workflowOnly: true }), /Memory unavailable/);
    assert.deepEqual(f.session, before);
});

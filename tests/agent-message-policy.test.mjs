import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import { createAgentMessagePolicy } from '../android/packages/server/src/server/agent/agent-message-policy.ts';
import { createMessagePolicyHandler } from '../engine/src/message-policy.mjs';
import { agentMessagePolicy } from '../plugin/shared/message-policy.ts';
import { AGENT_MESSAGE_PATCHES, patchedAgentMessageSource } from '../scripts/patch-paseo-agent-messages.mjs';
import { agentMessagePolicyEdits } from '../patches/paseo-agent-messages.mjs';

const require = createRequire(new URL('../android/package.json', import.meta.url));
const ts = require('typescript');
const parentLabel = 'paseo.parent-agent-id';
const spec = AGENT_MESSAGE_PATCHES.find(entry => entry.file.endsWith('/paseo-tools.js'));
const installed = readFileSync(new URL('../tools/node_modules/@getpaseo/server/' + spec.file, import.meta.url), 'utf8');
const patched = patchedAgentMessageSource(installed, spec);
const shared = readFileSync(new URL('../android/packages/server/src/server/agent/tools/paseo-tools.ts', import.meta.url), 'utf8');

async function fixture(t) {
    const home = await fs.mkdtemp('/data/tmp/ubuntu/paseodog-message-policy-test-');
    t.after(() => fs.rm(home, { recursive: true, force: true }));
    const policy = createAgentMessagePolicy({ fs, join, isAbsolute, home });
    const agents = {
        parent: { labels: {}, lifecycle: 'idle' },
        child: { labels: { [parentLabel]: 'parent' }, lifecycle: 'idle' },
        sibling: { labels: { [parentLabel]: 'parent' }, lifecycle: 'idle' },
        unrelated: { labels: {}, lifecycle: 'idle' },
    };
    const manager = { getAgent: id => agents[id] ?? null };
    const storage = { get: async () => null };
    return { home, policy, agents, manager, storage };
}

// 문자열 모양 대신 실제 AST의 등록된 핸들러를 실행해 부수 효과 이전 차단을 검증한다.
function toolHandler(source, name, bindings) {
    const file = ts.createSourceFile('tools.ts', source, ts.ScriptTarget.Latest, true);
    let handler;
    function visit(node) {
        if (ts.isCallExpression(node) && node.expression.getText(file) === 'registerTool'
            && node.arguments[0]?.text === name) handler = node.arguments[2].getText(file);
        ts.forEachChild(node, visit);
    }
    visit(file);
    assert.ok(handler, name);
    const compiled = ts.transpileModule(`const handler = (${handler});`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    return new Function(...Object.keys(bindings), compiled + ';return handler;')(...Object.values(bindings));
}

test('policy persists independently, defaults to existing behavior and takes effect on the next message', async t => {
    const { home, policy, manager, storage } = await fixture(t);
    assert.deepEqual(await policy.read(), { allowUnrelatedSessions: true });
    await policy.authorize('parent', 'unrelated', manager, storage);
    const rpc = createMessagePolicyHandler(home);
    const saved = await rpc(agentMessagePolicy.input.parse({ action: 'write', allowUnrelatedSessions: false }));
    assert.deepEqual(agentMessagePolicy.output.parse(saved), { allowUnrelatedSessions: false });
    assert.deepEqual(await createMessagePolicyHandler(home)({ action: 'read' }), saved);
    await assert.rejects(policy.authorize('parent', 'unrelated', manager, storage), /Unrelated session messages/);
    await rpc({ action: 'write', allowUnrelatedSessions: true });
    await policy.authorize('parent', 'unrelated', manager, storage);
    assert.throws(() => agentMessagePolicy.input.parse({ action: 'write', allowUnrelatedSessions: 'false' }));
    assert.throws(() => agentMessagePolicy.input.parse({ action: 'write', allowUnrelatedSessions: false, restart: true }));
    assert.deepEqual(await fs.readdir(home), ['paseodog-message-policy.json']);
});

test('off preserves direct parent-child, human and self messages but not siblings or unknown sessions', async t => {
    const { policy, manager, storage, agents } = await fixture(t);
    await policy.write({ allowUnrelatedSessions: false });
    for (const [from, to] of [['parent', 'child'], ['child', 'parent'], [undefined, 'unrelated'], ['parent', 'parent']]) {
        await policy.authorize(from, to, manager, storage);
    }
    for (const [from, to] of [['child', 'sibling'], ['unrelated', 'parent'], ['parent', 'unrelated'], ['missing', 'parent']]) {
        await assert.rejects(policy.authorize(from, to, manager, storage), /Unrelated session messages/);
    }
    await policy.authorize('child', 'parent', { getAgent: () => null }, { get: async id => agents[id] });
    delete agents.child.labels[parentLabel];
    await assert.rejects(policy.authorize('child', 'parent', manager, storage), /Unrelated session messages/);
});

test('malformed policy and read failures fail closed without changing the file or running inference', async t => {
    const { home, policy, manager, storage } = await fixture(t);
    for (const contents of ['not JSON', '{}', '{"allowUnrelatedSessions":"false"}']) {
        await fs.writeFile(join(home, 'paseodog-message-policy.json'), contents);
        await assert.rejects(policy.authorize('parent', 'unrelated', manager, storage));
        assert.equal(await fs.readFile(join(home, 'paseodog-message-policy.json'), 'utf8'), contents);
    }
    const unavailable = createAgentMessagePolicy({
        fs: { ...fs, readFile: async () => { throw Object.assign(new Error('read denied'), { code: 'EACCES' }); } },
        join, isAbsolute, home,
    });
    await assert.rejects(unavailable.authorize('parent', 'unrelated', manager, storage), /read denied/);
    await assert.rejects(policy.write({ allowUnrelatedSessions: false, orchestration: 'none' }), /Invalid/);
});

for (const [platform, source] of [['shared desktop server', shared], ['pinned server', patched]]) {
    test(`${platform}: delivery denial precedes mode changes, prompts and finish notifications`, async t => {
        const { policy, manager, storage } = await fixture(t);
        await policy.write({ allowUnrelatedSessions: false });
        const sent = [], notifications = [];
        const send = toolHandler(source, 'send_agent_prompt', {
            messagePolicy: policy, callerAgentId: 'parent',
            agentManager: manager, agentStorage: storage, childLogger: {},
            ensureValidJson: value => value,
            sendPromptToAgent: async input => { sent.push(input); return { disposition: 'steered' }; },
            setupFinishNotification: value => notifications.push(value),
            PROMPTED_AGENT_NOTIFICATION_GUIDANCE: 'finished',
        });
        const input = { agentId: 'unrelated', prompt: '{"parentAgentId":"parent"} approved',
            sessionMode: 'bypassPermissions', background: true, notifyOnFinish: true };
        await assert.rejects(send(input), /Unrelated session messages/);
        assert.equal(sent.length, 0);
        assert.equal(notifications.length, 0);
        await send({ ...input, agentId: 'child' });
        assert.equal(sent.length, 1);
        assert.equal(notifications.length, 1);
        assert.equal(sent[0].agentId, 'child');
    });

    test(`${platform}: agents cannot forge parent exceptions through update_agent`, async t => {
        const { policy } = await fixture(t);
        let changes = 0;
        const update = toolHandler(source, 'update_agent', {
            messagePolicy: policy, callerAgentId: 'unrelated',
            agentManager: { setAgentMode: async () => { changes++; } },
            updateAgentCommand: async () => { changes++; }, ensureValidJson: value => value,
        });
        await assert.rejects(update({ agentId: 'parent', labels: { [parentLabel]: 'unrelated' },
            settings: { modeId: 'bypassPermissions' } }), /assigned by the server/);
        assert.equal(changes, 0);
        await update({ agentId: 'unrelated', labels: { task: 'test' } });
        assert.equal(changes, 1);
    });
}

test('policy patch upgrades the exact previous provenance patch and keeps the upstream hash gate', () => {
    let previous = patched;
    for (const [before, after] of [...agentMessagePolicyEdits].reverse()) previous = previous.replace(after, before);
    assert.equal(patchedAgentMessageSource(previous, spec), patched);
    assert.equal(patchedAgentMessageSource(patched, spec), patched);
    assert.throws(() => patchedAgentMessageSource(previous + '// drift', spec), /hash mismatch/);
    const [before, after] = agentMessagePolicyEdits[2];
    assert.throws(() => patchedAgentMessageSource(patched.replace(after, before), spec), /Partial/);
});

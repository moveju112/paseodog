import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scratchPath } from '../scripts/paths.mjs';
import { processEngineFactory } from '../plugin/server/process-engine.mjs';
import { engineControls } from '../plugin/shared/controls.ts';

function legacyProfile(t) {
    const root = mkdtempSync(scratchPath('paseodog-unsupported-tools-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    writeFileSync(join(root, 'paseodog-computer-use.json'), '{"enabled":true}\n');
    return root;
}

test('removed computer tools are denied in every mode even with an old enabled setting', t => {
    const root = legacyProfile(t);
    const policy = new URL('../engine/src/policy.mjs', import.meta.url).href;
    const script = `
        import { attachHostPolicy } from ${JSON.stringify(policy)};
        const decisions = [];
        for (const mode of ['ask', 'review', 'bypass']) {
            for (const rewritten of [false, true]) {
                const session = { id: 'fixture-session', messages: [] };
                if (rewritten) session.beforeToolHook = async () => ({ action: 'rewrite', name: 'computer', args: {} });
                attachHostPolicy(session, { mode });
                decisions.push((await session.beforeToolHook({ name: rewritten ? 'read' : 'computer', args: {} })).action);
            }
        }
        console.log(JSON.stringify(decisions));
    `;
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
        encoding: 'utf8', env: { ...process.env, MIXDOG_DATA_DIR: root, MIXDOG_FEATURE_COMPUTER: '1' },
    }));
    assert.deepEqual(result, ['deny', 'deny', 'deny', 'deny', 'deny', 'deny']);
});

test('new workers cannot expose the removed computer tool through inherited or session overrides', async t => {
    const root = legacyProfile(t);
    let spawned;
    const factory = processEngineFactory({
        launch: { command: '/fixture-engine', args: [], env: {
            MIXDOG_DATA_DIR: root, MIXDOG_FEATURE_COMPUTER: '1',
        } },
        spawnProcess(_command, _args, options) { spawned = options.env; throw new Error('captured'); },
        terminateProcess() {},
        scopeFactory: ({ launch }) => ({ command: launch.command, args: [], detached: false, async preflight() {}, stop: null }),
    });
    await assert.rejects(factory.create({
        config: { cwd: root, env: { MIXDOG_FEATURE_COMPUTER: '1' } },
    }), /captured/);
    assert.equal(spawned.MIXDOG_FEATURE_COMPUTER, '0');
    assert.equal(Object.hasOwn(spawned, 'MIXDOG_BRIDGE_DISCOVERY_DIR'), false);
});

test('the removed computer settings action is not part of the public controls contract', () => {
    assert.equal(engineControls.input.safeParse({ action: 'computerUse', enabled: true }).success, false);
});

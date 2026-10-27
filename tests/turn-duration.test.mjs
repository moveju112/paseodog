import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { scratchPath } from '../scripts/paths.mjs';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { readTurnMinutes, writeTurnMinutes } from '../plugin/server/turn-duration.mjs';
import { createEngineControls } from '../plugin/server/controls.mjs';
import { fixture } from './helpers.mjs';

function profile(t) {
    const root = mkdtempSync(scratchPath('paseodog-turn-duration-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    return { MIXDOG_DATA_DIR: root };
}

test('duration defaults to 120 minutes and persists through a fresh controls instance', async (t) => {
    const env = profile(t);
    const make = () => {
        const controls = createEngineControls({ execCommand: async () => ({ stdout: '{"models":[]}' }) });
        controls.bind({ command: '/test-engine', args: [], env });
        t.after(() => controls.close());
        return controls;
    };
    const controls = make();
    assert.equal((await controls.read()).maxTurnMinutes, 120);
    assert.equal((await controls.read({ action: 'turnDuration', maxTurnMinutes: 180 })).maxTurnMinutes, 180);
    assert.equal((await make().read()).maxTurnMinutes, 180);
    for (const value of [0, -1, 1.5, '120', null, undefined, NaN, Infinity, 35792]) {
        await assert.rejects(controls.read({ action: 'turnDuration', maxTurnMinutes: value }));
        assert.equal(readTurnMinutes(env), 180);
    }
    for (const value of [1, 35791]) {
        writeTurnMinutes(env, value);
        assert.equal(readTurnMinutes(env), value);
    }
    assert.throws(() => writeTurnMinutes({}, 120), /Dedicated/);
    writeFileSync(join(env.MIXDOG_DATA_DIR, 'paseodog-turn-duration.json'), '{}');
    assert.throws(() => readTurnMinutes(env));
});

test('default timer allows one hour, stops at two hours and adopts saved minutes only on the next turn', async (t) => {
    const env = profile(t);
    let finish, aborted = 0;
    const f = fixture({
        ask() { return new Promise(resolve => { finish = resolve; }); },
        abort() { aborted++; finish({ result: { content: '' } }); },
    }, { env, maxTurnMs: undefined });
    t.after(() => f.connection.close());
    await f.ready();
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await f.connection.send(f.prompt);
    await setImmediate();
    t.mock.timers.tick(60 * 60000);
    assert.equal(aborted, 0);
    writeTurnMinutes(env, 3);
    t.mock.timers.tick(60 * 60000 - 1);
    assert.equal(aborted, 0);
    t.mock.timers.tick(1);
    await setImmediate();
    assert.equal(aborted, 1);
    await f.connection.send({ ...f.prompt, prompt: { ...f.prompt.prompt, clientMessageId: 'second' } });
    await setImmediate();
    t.mock.timers.tick(3 * 60000 - 1);
    assert.equal(aborted, 1);
    t.mock.timers.tick(1);
    await setImmediate();
    assert.equal(aborted, 2);
    t.mock.timers.reset();
});

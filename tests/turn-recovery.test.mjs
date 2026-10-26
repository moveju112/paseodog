import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agentsBySession, interruptedTurns, resumeInterruptedTurns, scheduleTurnRecovery, CONTINUE_PROMPT } from '../plugin/server/turn-recovery.mjs';

async function fixture(t) {
    const root = await mkdtemp('/data/tmp/ubuntu/paseodog-turn-recovery-');
    t.after(() => rm(root, { recursive: true, force: true }));
    const state = join(root, 'sessions'), paseo = join(root, 'paseo');
    await mkdir(state, { mode: 0o700 }); await mkdir(join(paseo, 'agents', 'home-ubuntu'), { recursive: true });
    const session = async (id, active, owner) => {
        await writeFile(join(state, `${id}.json`), JSON.stringify({ version: 2, id, active }));
        if (owner) { await mkdir(join(state, `${id}.lock`)); await writeFile(join(state, `${id}.lock`, 'owner.json'), JSON.stringify(owner)); }
    };
    const agent = (id, bridgeId, extra = {}) => writeFile(join(paseo, 'agents', 'home-ubuntu', `${id}.json`), JSON.stringify({
        id, provider: 'paseodog', persistence: { metadata: { pluginProviderPersistence: { data: { bridgeId } } } }, ...extra }));
    return { state, paseo, session, agent };
}

// 이전 데몬이 남긴 진행 중 턴만 중단으로 보고, 현재 프로세스가 쥔 세션의 턴은 제외한다.
test('interrupted turns are those left running by a dead owner, never a live session', async (t) => {
    const { state, session } = await fixture(t);
    await session('dead', { turnId: 't1' }, { pid: 1, host: 'h', nonce: 'a' });
    await session('unlocked', { turnId: 't2' });
    await session('live', { turnId: 't3' }, { pid: 2, host: 'h', nonce: 'b' });
    await session('idle', null);
    const turns = interruptedTurns(state, { ownerAlive: (owner) => owner.pid === 2 });
    assert.deepEqual(turns.map((turn) => turn.sessionId).sort(), ['dead', 'unlocked']);
});

test('only active top-level agents are mapped to journal sessions', async (t) => {
    const { paseo, agent } = await fixture(t);
    await agent('agent-a', 'bridge-a');
    await agent('agent-archived', 'bridge-b', { archivedAt: '2026-10-26T00:00:00Z' });
    await agent('agent-internal', 'bridge-c', { internal: true });
    assert.deepEqual([...agentsBySession(paseo)], [['bridge-a', 'agent-a']]);
});

// 같은 중단 턴에는 최대 한 번만 이어가기 지시를 보내고, 실패해도 재전송하지 않는다.
test('each interrupted turn is continued at most once with a new instruction', async (t) => {
    const { state, paseo, session, agent } = await fixture(t);
    await session('s1', { turnId: 't1' });
    await session('s2', { turnId: 't2' });
    await session('s3', { turnId: 't3' });
    await agent('agent-1', 's1'); await agent('agent-2', 's2');
    const sent = [], logs = [];
    let fail = true;
    const send = async (cli, agentId) => {
        sent.push([cli, agentId]);
        if (agentId === 'agent-2' && fail) throw new Error('secret /path token');
    };
    const options = { stateRoot: state, paseoHome: paseo, cli: '/cli', send, log: (line) => logs.push(line), ownerAlive: () => false };
    assert.deepEqual(await resumeInterruptedTurns(options), ['agent-1']);
    assert.deepEqual(sent.map(([, id]) => id).sort(), ['agent-1', 'agent-2']);
    assert.ok(logs.every((line) => !line.includes('secret')));
    fail = false;
    assert.deepEqual(await resumeInterruptedTurns(options), []);
    assert.equal(sent.length, 2);
    const marker = JSON.parse(await readFile(join(state, 'auto-resume.json'), 'utf8'));
    assert.deepEqual(Object.keys(marker).sort(), ['s1:t1', 's2:t2']);
    assert.match(CONTINUE_PROMPT, /반복하지 말고/);
});

test('auto-resume can be disabled and requires the dedicated state paths', () => {
    let runs = 0;
    const run = async () => { runs++; };
    for (const env of [{ PASEODOG_AUTO_RESUME: 'false', PASEODOG_STATE_DIR: '/s', PASEO_HOME: '/p' }, { PASEO_HOME: '/p' }])
        scheduleTurnRecovery({ env, delayMs: 0, run })();
    assert.equal(runs, 0);
});

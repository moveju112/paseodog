import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lockOwnerAlive } from './journal.mjs';
import { safeKey } from './util.mjs';

// 원래 요청은 다시 보내지 않는다. 중단 사실을 알리고 상태 확인 후 남은 일만 잇게 한다.
export const CONTINUE_PROMPT = '[PaseoDog 자동 이어가기] 직전 턴이 데몬 재시작으로 중단됐어요. '
    + '먼저 작업 디렉터리와 진행 상태를 확인하고, 이미 끝난 작업은 반복하지 말고 남은 일을 이어서 진행하세요. '
    + '중단 직전 실행 중이던 명령·수정·배포가 있었다면 결과를 확인한 뒤에만 다시 실행하세요.';
const MARKER = 'auto-resume.json';

function readJsonFile(path) {
    try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

// 이전 데몬 프로세스가 진행 중으로 남긴 턴. 지금 살아 있는 소유자가 쥔 세션은 제외한다.
export function interruptedTurns(stateRoot, { ownerAlive = lockOwnerAlive } = {}) {
    if (!existsSync(stateRoot)) return [];
    const turns = [];
    for (const name of readdirSync(stateRoot)) {
        if (!name.endsWith('.json') || name === MARKER) continue;
        const record = readJsonFile(join(stateRoot, name));
        if (!record?.active?.turnId || typeof record.id !== 'string') continue;
        const owner = readJsonFile(join(stateRoot, `${safeKey(record.id)}.lock`, 'owner.json'));
        if (owner && ownerAlive(owner)) continue;
        turns.push({ sessionId: record.id, turnId: record.active.turnId });
    }
    return turns;
}

// 저널 세션(bridgeId)에 연결된 보관되지 않은 최상위 에이전트를 찾는다.
export function agentsBySession(paseoHome) {
    const agents = new Map();
    const visit = (directory) => {
        let entries;
        try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) { visit(path); continue; }
            if (!entry.name.endsWith('.json')) continue;
            const agent = readJsonFile(path);
            const bridgeId = agent?.persistence?.metadata?.pluginProviderPersistence?.data?.bridgeId;
            if (typeof agent?.id !== 'string' || typeof bridgeId !== 'string' || agent.archivedAt || agent.internal === true) continue;
            agents.set(bridgeId, agent.id);
        }
    };
    visit(join(paseoHome, 'agents'));
    return agents;
}

function sendContinue(cli, agentId) {
    return new Promise((resolve, reject) => {
        execFile(process.execPath, [cli, 'agent', 'send', '--no-wait', '--prompt', CONTINUE_PROMPT, agentId],
            { timeout: 120000, maxBuffer: 1024 * 1024 }, (error) => error ? reject(error) : resolve());
    });
}

// 중단된 턴마다 한 번만(최대 1회) 이어가기 지시를 보낸다. 기록을 먼저 남겨 재전송하지 않는다.
export async function resumeInterruptedTurns({ stateRoot, paseoHome, cli, send = sendContinue, log = console.error,
    ownerAlive } = {}) {
    if (!stateRoot || !paseoHome) return [];
    const markerPath = join(stateRoot, MARKER);
    const attempted = readJsonFile(markerPath) || {};
    const agents = agentsBySession(paseoHome);
    const resumed = [];
    for (const turn of interruptedTurns(stateRoot, { ownerAlive })) {
        const key = `${turn.sessionId}:${turn.turnId}`;
        const agentId = agents.get(turn.sessionId);
        if (attempted[key] || !agentId) continue;
        attempted[key] = new Date().toISOString();
        const temporary = `${markerPath}.${process.pid}.tmp`;
        writeFileSync(temporary, JSON.stringify(attempted, null, 2) + '\n', { mode: 0o600 });
        renameSync(temporary, markerPath);
        try {
            await send(cli, agentId);
            resumed.push(agentId);
            log(`[paseodog] auto-resumed interrupted turn for agent ${agentId}`);
        } catch {
            // 실패 원인에 경로·인증값이 섞일 수 있어 고정 문구만 남기고 재시도하지 않는다.
            log(`[paseodog] auto-resume failed for agent ${agentId}; left for manual follow-up`);
        }
    }
    return resumed;
}

// 데몬이 준비된 뒤 한 번 실행한다. PASEODOG_AUTO_RESUME=false로 끈다.
export function scheduleTurnRecovery({ env = process.env, delayMs = 20000, run = resumeInterruptedTurns } = {}) {
    if (env.PASEODOG_AUTO_RESUME === 'false' || !env.PASEODOG_STATE_DIR || !env.PASEO_HOME) return () => {};
    const timer = setTimeout(() => {
        void run({ stateRoot: env.PASEODOG_STATE_DIR, paseoHome: env.PASEO_HOME,
            cli: fileURLToPath(new URL('../../bin/paseodog.mjs', import.meta.url)) })
            .catch(() => console.error('[paseodog] auto-resume scan failed'));
    }, delayMs);
    timer.unref?.();
    return () => clearTimeout(timer);
}

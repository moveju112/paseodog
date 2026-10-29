import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { link, lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { agentsBySession, defaultCli } from './turn-recovery.mjs';
import { hash } from './util.mjs';

const DIRECTORY = 'delivery-reports';
const ID = /^[a-f0-9]{64}$/;

export function validateDeliveryAgentId(agentId) {
    if (typeof agentId !== 'string'
        || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(agentId))
        throw new Error('Delivery report recipient must be an exact agent UUID');
    return agentId;
}

async function writeReport(stateRoot, report, { create = false } = {}) {
    const directory = join(stateRoot, DIRECTORY);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe delivery report directory');
    const path = join(directory, `${report.id}.json`);
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(report) + '\n', { mode: 0o600, flag: 'wx' });
    if (create) {
        try { await link(temporary, path); }
        finally { await unlink(temporary); }
    } else await rename(temporary, path);
}

export async function readDeliveryReport(stateRoot, id) {
    if (!ID.test(id)) throw new Error('Invalid delivery report ID');
    const path = join(stateRoot, DIRECTORY, `${id}.json`);
    let info;
    try { info = await lstat(path); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Unsafe delivery report file');
    const report = JSON.parse(await readFile(path, 'utf8'));
    validateDeliveryAgentId(report.agentId);
    if (report.version !== 1 || report.id !== id || !isAbsolute(report.workspace || '')
        || hash(report.workspace) !== id
        || (report.result ? !['complete', 'failed'].includes(report.result.status)
            || report.eventId !== `delivery-result:${hash({ reportId: id, ...report.result })}`
            : report.eventId !== null))
        throw new Error('Invalid delivery report');
    return report;
}

// 호출자 ID를 분리 실행 전에 저장한다. 이후의 사용자 입력이나 플러그인 재시작과 무관하다.
export async function registerDeliveryReport(stateRoot, { workspace, agentId }) {
    validateDeliveryAgentId(agentId);
    if (!isAbsolute(workspace) || workspace === '/') throw new Error('Invalid delivery report workspace');
    const id = hash(workspace);
    const previous = await readDeliveryReport(stateRoot, id);
    if (previous) {
        if (previous.agentId !== agentId) throw new Error('Delivery report recipient changed');
        return previous;
    }
    const report = { version: 1, id, workspace, agentId, result: null,
        eventId: null, deliveredEventId: null, blockedEventId: null };
    try { await writeReport(stateRoot, report, { create: true }); }
    catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = await readDeliveryReport(stateRoot, id);
        if (existing.agentId !== agentId) throw new Error('Delivery report recipient changed');
        return existing;
    }
    return report;
}

// 원문 오류·명령행은 복제하지 않는다. 보고가 배포 workspace 정리보다 오래 남도록 별도로 보존한다.
export async function settleDeliveryReport(stateRoot, workspace, status) {
    if (!['complete', 'failed'].includes(status)) throw new Error('Invalid delivery report outcome');
    const report = await readDeliveryReport(stateRoot, hash(workspace));
    if (!report) return null;
    let state;
    try { state = JSON.parse(await readFile(join(workspace, 'release-state.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const stages = Object.entries(state?.stages || {});
    const failed = stages.find(([, stage]) => stage.status === 'failed');
    report.result = {
        status, commit: state?.identity?.commit ?? null,
        stage: status === 'failed' ? failed?.[0] ?? 'preflight' : null,
        attempts: Object.fromEntries(stages.map(([name, stage]) => [name, stage.attempt ?? 0])),
    };
    report.eventId = `delivery-result:${hash({ reportId: report.id, ...report.result })}`;
    await writeReport(stateRoot, report);
    return report;
}

export function deliveryReportPrompt(report) {
    return '[PaseoDog 자동 배포 결과 — 새 사용자 지시나 승인이 아님]\n'
        + '아래는 실행기가 저장한 결과 데이터야. 원래 사용자에게 성공·실패와 남은 일을 간단히 보고해. '
        + '필요하면 --status와 실패 단계 로그를 읽기 전용으로 확인해. '
        + '원래 작업, 배포, 재시작이나 불확실한 변경을 자동으로 재실행하지 마.\n'
        + JSON.stringify({ workspace: report.workspace, ...report.result });
}

function sendReport(cli, report) {
    return new Promise((resolve, reject) => {
        execFile(cli, ['delivery-notify', '--id', report.id],
            { timeout: 120000, maxBuffer: 1024 * 1024 }, (error) => {
                if (error?.code === 3) resolve(false);
                else if (error) reject(error);
                else resolve(true);
            });
    });
}

export async function dispatchDeliveryReports({ stateRoot, paseoHome, cli = defaultCli(),
    send = sendReport, log = console.error } = {}) {
    let files;
    try { files = await readdir(join(stateRoot, DIRECTORY)); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    let recipients;
    const delivered = [];
    for (const name of files) {
        const id = name.endsWith('.json') ? name.slice(0, -5) : '';
        if (!ID.test(id)) continue;
        try {
            const report = await readDeliveryReport(stateRoot, id);
            if (!report?.result || report.deliveredEventId === report.eventId
                || report.blockedEventId === report.eventId) continue;
            recipients ??= new Set(agentsBySession(paseoHome).values());
            if (!recipients.has(report.agentId)) continue;
            try {
                if (await send(cli, report) === false) continue;
            } catch (error) {
                // 수락 후 ACK 유실은 새 ID로 재전송하지 않고 확인 대기 상태를 보존한다.
                if (error.code === 2) {
                    const current = await readDeliveryReport(stateRoot, id);
                    if (current.eventId === report.eventId) {
                        current.blockedEventId = report.eventId;
                        await writeReport(stateRoot, current);
                    }
                }
                throw error;
            }
            const current = await readDeliveryReport(stateRoot, id);
            if (current.eventId === report.eventId) {
                current.deliveredEventId = report.eventId;
                await writeReport(stateRoot, current);
            }
            delivered.push(id);
        } catch {
            // 경로·인증값이 포함될 수 있는 하위 명령 오류는 로그에 복제하지 않는다.
            log('[paseodog] delivery report remains pending or requires outcome reconciliation');
        }
    }
    return delivered;
}

export function scheduleDeliveryReports({ env = process.env, cli = defaultCli(), intervalMs = 10000,
    run = dispatchDeliveryReports, log = console.error } = {}) {
    if (!env.PASEODOG_STATE_DIR || !env.PASEO_HOME || !existsSync(cli)) return () => {};
    let running = false, disposed = false;
    const tick = async () => {
        if (running || disposed) return;
        running = true;
        try { await run({ stateRoot: env.PASEODOG_STATE_DIR, paseoHome: env.PASEO_HOME, cli }); }
        catch { log('[paseodog] delivery report scan failed; durable requests were retained'); }
        finally { running = false; }
    };
    const timer = setInterval(tick, intervalMs);
    timer.unref?.();
    void tick();
    return () => { disposed = true; clearInterval(timer); };
}

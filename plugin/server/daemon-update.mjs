import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, lstat, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const self = fileURLToPath(import.meta.url);
const steps = ['prepare', 'verify', 'idle', 'apply', 'check', 'rollback', 'rollbackCheck'];
const terminal = new Set(['complete', 'failed', 'rolled-back', 'rollback-failed']);
const sleep = ms => new Promise(done => setTimeout(done, ms));
const defaultDirectory = () => join(process.env.PASEODOG_HOME || join(homedir(), '.local/share/paseodog'), 'daemon-update');

// 이 파일은 호스트 소유자가 준비한 고정 실행 계획만 읽는다. RPC에는 경로·명령 입력이 없다.
export function validateUpdatePlan(plan) {
    if (!plan || plan.target !== 'paseodog' || !Number.isSafeInteger(plan.versionCode) || plan.versionCode <= 0)
        throw new Error('Invalid PaseoDog update plan');
    if (Object.keys(plan).some(key => !['target', 'versionCode', ...steps].includes(key)))
        throw new Error('Unknown update plan field');
    for (const step of steps) {
        const command = plan[step];
        if (!Array.isArray(command) || !command.length || !isAbsolute(command[0])
            || command.some(value => typeof value !== 'string' || value.includes('\0')))
            throw new Error(`Invalid update step: ${step}`);
    }
    return plan;
}

async function privatePath(path, directory = false) {
    const info = await lstat(path);
    if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())
        || ![0, process.getuid()].includes(info.uid) || (info.mode & 0o022))
        throw new Error('Unsafe daemon update configuration');
}

async function readPlan(directory) {
    // 상위 디렉터리 바꿔치기와 symlink 설정도 거부한다.
    for (let path = directory; ; path = dirname(path)) {
        const info = await lstat(path);
        if (info.isSymbolicLink() || !info.isDirectory() || ![0, process.getuid()].includes(info.uid)
            || ((info.mode & 0o022) && !(path !== directory && (info.mode & 0o1000))))
            throw new Error('Unsafe daemon update directory');
        if (dirname(path) === path) break;
    }
    const path = join(directory, 'plan.json');
    await privatePath(path);
    return validateUpdatePlan(JSON.parse(await readFile(path, 'utf8')));
}

async function receipt(directory) {
    try {
        await privatePath(join(directory, 'request.json'));
        return JSON.parse(await readFile(join(directory, 'request.json'), 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

async function saveReceipt(directory, value) {
    const temporary = join(directory, `receipt-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temporary, join(directory, 'request.json'));
}

async function runStep(command) {
    const result = await execute(command[0], command.slice(1), {
        timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024,
        env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
    });
    return result.stdout;
}

export function updateServiceCommand(directory) {
    const id = createHash('sha256').update(directory).digest('hex').slice(0, 12);
    return ['systemd-run', ['--user', `--unit=paseodog-daemon-update-${id}`, '--collect',
        '--service-type=exec', '--setenv=ELECTRON_RUN_AS_NODE=1', '--setenv=NODE_OPTIONS=', '--setenv=NODE_PATH=',
        '--', process.execPath, join(directory, 'worker.mjs'), '--execute', directory]];
}

export function createDaemonUpdater({ directory = defaultDirectory(), versionCode, platform = process.platform,
    start = (command, args) => execute(command, args, { timeout: 30000, maxBuffer: 65536 }) }) {
    directory = resolve(directory);
    let queue = Promise.resolve();
    async function status() {
        let request;
        try { request = await receipt(directory); }
        catch {
            return { available: false, reason: '이전 업데이트 영수증을 호스트에서 확인해야 합니다.', request: null };
        }
        if (platform !== 'linux') return { available: false, reason: '이 호스트의 업데이트 실행기를 지원하지 않습니다.', request };
        try {
            const plan = await readPlan(directory);
            return { available: plan.versionCode > versionCode, versionCode: plan.versionCode, request,
                reason: plan.versionCode > versionCode ? null : '호스트에 준비된 새 업데이트가 없습니다.' };
        } catch {
            return { available: false, reason: '호스트 소유자가 안전한 업데이트 실행 계획을 먼저 설정해야 합니다.', request };
        }
    }
    return {
        status,
        request(input) {
            const operation = queue.then(async () => {
                if (input.confirmed !== true || !Number.isSafeInteger(input.versionCode))
                    throw new Error('업데이트 확인과 정확한 대상 버전이 필요합니다.');
                const current = await status();
                if (current.request && !terminal.has(current.request.phase)) return current;
                // 응답 유실·재연결·다른 기기의 같은 요청으로 실패한 변경을 재실행하지 않는다.
                if (current.request?.versionCode === input.versionCode) return current;
                if (!current.available || current.versionCode !== input.versionCode)
                    throw new Error('호스트에 준비된 업데이트와 요청 버전이 다릅니다.');
                const lock = await open(join(directory, 'request.lock'), 'wx', 0o600);
                try {
                    const plan = await readPlan(directory);
                    if (plan.versionCode !== input.versionCode) throw new Error('업데이트 계획이 변경됐습니다.');
                    const previous = await receipt(directory);
                    if (previous && (!terminal.has(previous.phase) || previous.versionCode === input.versionCode))
                        return status();
                    const request = { id: randomUUID(), versionCode: input.versionCode, phase: 'queued',
                        updatedAt: Date.now(), message: '업데이트 요청을 접수했습니다.' };
                    await writeFile(join(directory, 'accepted-plan.json'), JSON.stringify(plan), { mode: 0o600 });
                    // 데몬 교체에도 살아남도록 독립 실행기를 상태 디렉터리에 복사한다.
                    await copyFile(self, join(directory, 'worker.mjs'));
                    await saveReceipt(directory, request);
                    try {
                        const [command, args] = updateServiceCommand(directory);
                        await start(command, args);
                    } catch {
                        // systemd 응답 유실이면 실제 시작 여부를 모른다. 자동 재시도하지 않는다.
                        const latest = await receipt(directory);
                        if (latest.phase === 'queued') await saveReceipt(directory, { ...latest,
                            phase: 'start-unknown', message: '실행기 시작 여부를 호스트에서 확인해야 합니다.', updatedAt: Date.now() });
                    }
                    return status();
                } finally {
                    await lock.close();
                    // 잠금은 영수증과 별개다. 불확실한 실행은 request.json이 계속 차단한다.
                    await unlink(join(directory, 'request.lock'));
                }
            });
            const safeOperation = operation.catch(() => {
                throw new Error('업데이트 요청을 접수하지 못했습니다. 호스트의 계획·잠금·이전 결과를 확인하세요.');
            });
            queue = safeOperation.catch(() => {});
            return safeOperation;
        },
    };
}

export async function executeDaemonUpdate(directory, { run = runStep, wait = sleep, now = Date.now } = {}) {
    directory = await realpath(directory);
    await privatePath(directory, true);
    const lock = await open(join(directory, 'worker.lock'), 'wx', 0o600);
    try {
        const request = await receipt(directory);
        if (request?.phase !== 'queued') throw new Error('Update cannot be replayed; inspect the persisted receipt');
        await privatePath(join(directory, 'accepted-plan.json'));
        const plan = validateUpdatePlan(JSON.parse(await readFile(join(directory, 'accepted-plan.json'), 'utf8')));
        if (plan.versionCode !== request.versionCode) throw new Error('Accepted update version changed');
        const setPhase = async (phase, message) => saveReceipt(directory,
            { ...request, phase, message, updatedAt: now() });
        const step = async name => {
            try { return await run(plan[name]); }
            catch { throw new Error(`업데이트 ${name} 단계에 실패했습니다.`); }
        };
        let applying = false;
        try {
            await setPhase('preparing', '기존 데몬을 유지하며 업데이트·복구 후보를 검증하고 있습니다.');
            await step('prepare');
            await step('verify');
            await setPhase('waiting', '실행 중인 작업이 끝나기를 기다리고 있습니다.');
            const started = now();
            for (;;) {
                const rows = JSON.parse(await step('idle'));
                if (!Array.isArray(rows) || rows.some(row => !row
                    || !['initializing', 'running', 'idle', 'error', 'closed'].includes(row.status)))
                    throw new Error('호스트 작업 상태를 확인할 수 없습니다.');
                if (!rows.some(row => ['running', 'initializing'].includes(row.status))) break;
                if (now() - started >= 3600000) throw new Error('작업이 남아 있어 업데이트를 적용하지 않았습니다.');
                await wait(10000);
            }
            // apply는 호스트의 입장 차단·마지막 idle 확인·graceful cutover를 원자적으로 수행해야 한다.
            await setPhase('applying', '데몬을 업데이트하고 있습니다. 잠시 연결이 끊길 수 있습니다.');
            applying = true;
            await step('apply');
            await step('check');
            await setPhase('complete', '데몬 업데이트와 연결 확인을 완료했습니다.');
        } catch {
            if (!applying) {
                await setPhase('failed', '후보 검증 또는 작업 상태 확인에 실패해 업데이트를 적용하지 않았습니다.');
            } else {
                await setPhase('rolling-back', '업데이트에 실패해 이전 버전으로 복구하고 있습니다.');
                try {
                    await step('rollback');
                    await step('rollbackCheck');
                    await setPhase('rolled-back', '업데이트에 실패했으며 이전 버전 복구를 확인했습니다.');
                } catch {
                    await setPhase('rollback-failed', '이전 버전 복구를 확인하지 못했습니다. 호스트에서 점검해야 합니다.');
                }
            }
            throw new Error('Daemon update failed; inspect request.json on the host');
        }
    } finally {
        await lock.close();
        // worker.lock은 의도적으로 보존한다. 다음 버전 준비 시 호스트가 결과를 확인하고 제거한다.
    }
}

if (process.argv[1] && resolve(process.argv[1]) === self) {
    try {
        if (process.argv.length !== 4 || process.argv[2] !== '--execute' || !isAbsolute(process.argv[3]))
            throw new Error('Expected --execute <absolute dedicated update directory>');
        await executeDaemonUpdate(process.argv[3]);
    } catch {
        console.error('Daemon update failed; inspect the local service and persisted receipt');
        process.exitCode = 1;
    }
}

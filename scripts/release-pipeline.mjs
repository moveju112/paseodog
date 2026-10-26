import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { buildRelease } from './build-release.mjs';
import { buildWeb } from './build-web.mjs';
import { insideWorkspace, openReleaseState, fileHash } from './release-state.mjs';
import { runCommand } from './release-command.mjs';
import { releaseArtifacts, verifyReleaseArtifacts, verifyRemoteAssets } from './release-artifacts.mjs';
import { carriedAssets, deliveryPlan, describePlan, recordDeployment, validateTargets } from './release-targets.mjs';
import { verifyReleaseWeb } from './release-web-check.mjs';
import { root } from './paths.mjs';
import { restartDesktop } from './release-apply.mjs';
import { verifyReleaseSource } from './release-verification.mjs';
import { releasePreflight } from './release-preflight.mjs';
import release from '../plugin/shared/release.json' with { type: 'json' };

const self = fileURLToPath(import.meta.url);
const phases = ['verify', 'build', 'artifacts', 'github-draft', 'github-upload',
    'github-publish', 'browser-export', 'pages-deploy', 'pages-check', 'web-patch',
    'pc-install', 'plugin-reload', 'pc-launch', 'applied-check'];

export function validateReleaseConfig(input) {
    const config = { ...input, root, version: `${release.version}.${release.versionCode}`,
        versionCode: String(release.versionCode) };
    for (const key of ['workspace', 'cacheRoot', 'signingInit', 'signingKey', 'previousApk', 'androidTools']) {
        if (typeof config[key] !== 'string' || !isAbsolute(config[key]) || resolve(config[key]) === '/')
            throw new Error(`${key} must be an explicit absolute non-root path`);
        config[key] = resolve(config[key]);
    }
    if (!insideWorkspace('/data/tmp/ubuntu', config.workspace)
        || config.workspace === config.cacheRoot || insideWorkspace(config.workspace, config.cacheRoot))
        throw new Error('Use a unique workspace under /data/tmp/ubuntu, separate from reusable caches');
    if (!/^[1-9]\d*$/.test(String(config.metroWorkers))) throw new Error('metroWorkers must be positive');
    config.metroWorkers = String(config.metroWorkers);
    if (!Array.isArray(config.appTests) || !config.appTests.length
        || config.appTests.some(path => !/^src\/[\w./-]+\.(test|spec)\.tsx?$/.test(path) || path.includes('..')))
        throw new Error('appTests must explicitly name affected app tests');
    config.targets = validateTargets(config.targets);
    // 데몬 업데이터는 호스트 프로필에 둘 다 있을 때만 배포가 직접 실행한다.
    if ((config.updaterRoot === undefined) !== (config.updaterUnit === undefined)
        || (config.updaterRoot !== undefined && (!isAbsolute(config.updaterRoot)
            || !/^[\w@.-]+\.service$/.test(config.updaterUnit))))
        throw new Error('updaterRoot and updaterUnit must be set together as an absolute path and a user service');
    if (config.repo !== 'moveju112/paseodog' || config.pagesProject !== 'paseodog'
        || config.webUrl !== 'https://paseodog.choondoggy.com/')
        throw new Error('Release target must be the dedicated PaseoDog repository and Pages project');
    return config;
}

export function activeAgents(rows) {
    return rows.filter(row => ['running', 'initializing'].includes(row.status));
}

// 재시작 허용을 추정하지 않는다. 독립 서비스가 모든 턴의 idle 경계를 기다린다.
export async function waitForIdle(list, { sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    timeoutMs = 3600000, now = Date.now } = {}) {
    const started = now();
    while (activeAgents(await list()).length) {
        if (now() - started >= timeoutMs) throw new Error('Active work remains; runtime apply is pending');
        await sleep(10000);
    }
}

export function detachedCommand(configPath, workspace) {
    const id = createHash('sha256').update(workspace).digest('hex').slice(0, 12);
    const args = ['--user', `--unit=paseodog-delivery-${id}`, '--collect',
        '-p', `StandardOutput=append:${join(workspace, 'delivery.log')}`,
        '-p', `StandardError=append:${join(workspace, 'delivery.log')}`];
    for (const key of ['PATH', 'ANDROID_HOME', 'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS'])
        if (process.env[key]) args.push(`--setenv=${key}=${process.env[key]}`);
    return ['systemd-run', [...args, process.execPath, self, '--config', configPath, '--execute']];
}

export async function unlockStoppedDelivery(workspace) {
    const path = join(workspace, 'delivery.lock');
    const pid = Number(await readFile(path, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('Invalid lock owner; inspect the lock manually');
    try { process.kill(pid, 0); }
    catch (error) {
        if (error.code !== 'ESRCH') throw error;
        await rm(path);
        return;
    }
    throw new Error('Delivery process is still alive; lock was not removed');
}

export async function deliverRelease(input, { run = runCommand, retryStage, checkWeb = verifyReleaseWeb,
    build = buildRelease, verifyArtifacts = verifyReleaseArtifacts, launchDesktop = restartDesktop, sleep,
    installedRelease = () => readFile('/opt/PaseoDog/resources/paseodog-runtime/plugin/shared/release.json', 'utf8').then(JSON.parse) } = {}) {
    const config = validateReleaseConfig(input);
    const { workspace, version, versionCode } = config;
    await mkdir(workspace, { recursive: true, mode: 0o700 });
    // 같은 workspace에 대한 중복 실행은 상태 파일을 만지기 전에 거부한다.
    const lockPath = join(workspace, 'delivery.lock');
    const lock = await open(lockPath, 'wx', 0o600);
    await lock.writeFile(String(process.pid));
    try {
        const capture = (command, args, cwd = root) => run(command, args, { cwd, capture: true });
        const commit = (await capture('git', ['rev-parse', 'HEAD'])).trim();
        if ((await capture('git', ['status', '--porcelain'])).trim()) throw new Error('Release requires a clean checkout');
        const remote = (await capture('git', ['ls-remote', 'origin', 'refs/heads/main'])).split(/\s/)[0];
        if (remote !== commit) throw new Error('Release commit is not pushed to origin/main');
        const { stage } = await openReleaseState(workspace, { commit, config,
            signingInitHash: await fileHash(config.signingInit), previousApkHash: await fileHash(config.previousApk) }, { retryStage });
        const execute = (name, command, args, cwd = root, env = process.env) =>
            run(command, args, { cwd, env, log: join(workspace, `${name}.log`) });
        const tag = `v${version}`;
        const wrapper = [join(root, 'bin/paseodog.mjs')];
        const listAgents = async () => JSON.parse(await capture(process.execPath, [...wrapper, 'agent', 'ls', '--json']));
        const assertSource = async () => {
            if ((await capture('git', ['rev-parse', 'HEAD'])).trim() !== commit
                || (await capture('git', ['status', '--porcelain'])).trim())
                throw new Error('Sources changed during delivery; start from a new pushed commit');
        };
        await stage('verify', async () => {
            const init = await readFile(config.signingInit, 'utf8');
            const keyLines = init.split('\n').filter(line => line.includes('storeFile'));
            if (keyLines.length !== 1 || !keyLines[0].includes(config.signingKey))
                throw new Error('Signing init does not reference the existing approved key');
            await stat(config.signingKey);
            await verifyReleaseSource(config, run);
            await assertSource();
        });
        // 기준점은 실제 공개·설치 기록에서 읽는다. 재개 시에는 저장된 계획을 그대로 쓴다.
        const plan = await stage('plan', () => deliveryPlan(config, { capture, commit, cwd: root }));
        const { targets } = plan;
        console.log(`Delivery plan: ${describePlan(plan)}`);
        const github = targets.android || targets.desktop;
        if (!github && !targets.web && !targets.runtime) {
            console.log('No deployable changes since the deployed baselines.');
            return { commit, version, tag: null, plan };
        }
        // buildRelease의 각 단계가 자체 체크포인트·산출물 해시를 갖는다.
        await build({ ...config, targets, checkpoint: stage });
        await assertSource();
        if (targets.android) await stage('android-manifest', () => execute('android-manifest', 'python3', [
            'scripts/android-update-manifest.py', '--version-code', versionCode, '--version-name', version,
            '--tag', tag, '--target-abi', 'arm64-v8a', '--output', join(workspace, 'paseodog-android-update.json'),
            releaseArtifacts(workspace, version)[0],
        ]), { artifacts: [join(workspace, 'paseodog-android-update.json')] });
        let expected = {}, uploadAssets = [];
        if (github) {
            const carried = carriedAssets(plan.carry);
            if (carried.length) await stage('github-carry', async () => {
                await mkdir(join(workspace, 'carry'), { recursive: true, mode: 0o700 });
                await execute('github-carry', 'gh', ['release', 'download', plan.latestTag, '--repo', config.repo,
                    '--dir', join(workspace, 'carry'), '--clobber', ...carried.flatMap(name => ['--pattern', name])]);
            }, { artifacts: carried.map(name => join(workspace, 'carry', name)) });
            // 업로드 직전마다 서명·해시를 다시 확인해 재개 사이 산출물 변조를 차단한다.
            uploadAssets = await verifyArtifacts(config, run, plan);
            expected = Object.fromEntries(await Promise.all(uploadAssets.map(async path => [basename(path), (await stat(path)).size])));
            await stage('github-draft', () => execute('github-draft', 'gh', ['release', 'create', tag, '--draft',
                '--repo', config.repo, '--target', commit, '--title', `PaseoDog ${version}`, '--notes-file', join(root, 'CHANGELOG.md')]),
            { mutation: true });
        }
        const webOutput = join(workspace, 'web-cloudflare');
        if (targets.web) await mkdir(join(config.cacheRoot, 'web-cloudflare'), { recursive: true });
        // 업로드와 웹 export는 입력을 공유하지 않는다. 둘 다 끝나기 전에는 공개하거나 잠금을 해제하지 않는다.
        const prepared = await Promise.allSettled([
            github ? stage('github-upload', () => execute('github-upload', 'gh',
                ['release', 'upload', tag, '--repo', config.repo, ...uploadAssets]), { mutation: true }) : null,
            targets.web ? stage('browser-export', () => buildWeb({
                output: webOutput, hosting: 'cloudflare', metroWorkers: String(config.metroWorkers), dependenciesBuilt: true,
            }, (command, args, options) => execute('browser-export', 'systemd-run', [
                '--user', '--scope', '-q', '-p', 'MemoryHigh=16G', '-p', 'MemorySwapMax=2G', command, ...args,
            ], options.cwd, { ...options.env, TMPDIR: join(config.cacheRoot, 'web-cloudflare') })),
            { artifacts: [webOutput] }) : null,
        ].filter(Boolean));
        const failures = prepared.filter(result => result.status === 'rejected').map(result => result.reason);
        if (failures.length) throw new AggregateError(failures, failures.map(error => error.message).join('; '));
        await assertSource();
        if (github) {
            const published = JSON.parse(await capture('gh', ['release', 'view', tag, '--repo', config.repo,
                '--json', 'assets,targetCommitish']));
            if (published.targetCommitish !== commit) throw new Error('GitHub release target differs from verified commit');
            verifyRemoteAssets(published.assets, expected);
            await stage('github-publish', () => execute('github-publish', 'gh',
                ['release', 'edit', tag, '--repo', config.repo, '--draft=false', '--latest']), { mutation: true });
        }
        // 공개된 검증 산출물의 PC 설치와 웹 배포는 독립적이다. 둘 다 성공한 뒤에만 재로딩한다.
        const applied = await Promise.allSettled([
            (async () => {
                if (targets.web) {
                    await stage('pages-deploy', () => execute('pages-deploy', 'npx', ['--no-install', 'wrangler', 'pages', 'deploy',
                        webOutput, '--project-name', config.pagesProject, '--branch', 'main'], join(root, 'android/packages/app')),
                    { mutation: true });
                    await checkWeb({ url: config.webUrl, output: webOutput });
                    await recordDeployment(config.cacheRoot, 'web', { commit, version });
                }
                if (targets.runtime) await stage('web-patch', async () => {
                    await execute('web-patch', process.execPath, ['scripts/patch-paseo-composer.mjs']);
                    await execute('web-patch-check', process.execPath, ['scripts/patch-paseo-composer.mjs', '--check']);
                });
            })(),
            (async () => {
                if (!targets.desktop) return;
                console.log('Publication complete; waiting for idle before PC/runtime apply.');
                await waitForIdle(listAgents, sleep ? { sleep } : undefined);
                const installed = (await capture('dpkg-query', ['-W', '-f=${Version}', 'paseodog'])).trim();
                if (installed !== version.replace('-', '~')) await stage('pc-install', () =>
                    execute('pc-install', 'sudo', ['-n', 'dpkg', '-i', releaseArtifacts(workspace, version)[2]]), { mutation: true });
            })(),
        ]);
        const applyFailures = applied.filter(result => result.status === 'rejected').map(result => result.reason);
        if (applyFailures.length) throw new AggregateError(applyFailures, applyFailures.map(error => error.message).join('; '));
        if (targets.runtime) {
            await waitForIdle(listAgents, sleep ? { sleep } : undefined);
            // 데몬 갱신은 기존 업데이터 경로를 그대로 쓴다. 다른 세션이 이후 커밋을 올렸으면 그 커밋까지 반영될 수 있다.
            if (config.updaterRoot && config.updaterUnit) await stage('runtime-update', async () => {
                // 이 커밋은 verify를 통과했다. 같은 리비전이면 업데이터가 root 테스트를 다시 돌리지 않는다.
                await writeFile(join(config.updaterRoot, 'preverified.json'), JSON.stringify({
                    revision: commit, verifiedAt: new Date().toISOString(), workspace }) + '\n', { mode: 0o600 });
                await execute('runtime-update', 'systemctl', ['--user', 'start', config.updaterUnit]);
                const receipt = JSON.parse(await readFile(join(config.updaterRoot, 'receipt.json'), 'utf8'));
                if (receipt.phase !== 'applied' || !/^[0-9a-f]{40}$/.test(receipt.revision || ''))
                    throw new Error(`Daemon updater did not apply: ${receipt.phase}`);
                if (receipt.revision !== commit)
                    await capture('git', ['merge-base', '--is-ancestor', commit, receipt.revision]);
                return { revision: receipt.revision };
            }, { mutation: true });
            await stage('plugin-reload', () => execute('plugin-reload', process.execPath,
                [...wrapper, 'plugin', 'reload', 'paseodog-provider']), { mutation: true });
            const diagnostic = JSON.parse(await capture(process.execPath, [...wrapper, 'provider', 'diagnostic', 'paseodog', '--json']));
            if (!diagnostic.diagnostic.startsWith('Provider is available')) throw new Error('Provider not ready after reload');
        }
        if (targets.desktop) {
            await waitForIdle(listAgents, sleep ? { sleep } : undefined);
            await stage('pc-launch', () => launchDesktop(config, run), { mutation: true });
            const desktopRelease = await installedRelease();
            if (desktopRelease.versionCode !== Number(versionCode)) throw new Error('Installed desktop version mismatch');
        }
        console.log(`Delivery verified: ${describePlan(plan)}`);
        return { commit, version, tag: github ? tag : null, plan };
    } finally {
        await lock.close();
        await rm(lockPath);
    }
}

if (process.argv[1] && resolve(process.argv[1]) === self) {
    try {
        const { values } = parseArgs({ options: {
            config: { type: 'string' }, execute: { type: 'boolean' }, start: { type: 'boolean' },
            status: { type: 'boolean' }, 'retry-stage': { type: 'string' }, 'unlock-stopped': { type: 'boolean' },
            'verify-only': { type: 'boolean' },
        } });
        if (!values.config || !isAbsolute(values.config)) throw new Error('--config requires an absolute JSON path');
        const config = validateReleaseConfig(JSON.parse(await readFile(values.config, 'utf8')));
        if (values['verify-only']) {
            await releasePreflight(config);
            await verifyReleaseSource(config);
        }
        else if (values['unlock-stopped']) await unlockStoppedDelivery(config.workspace);
        else if (values.status) console.log(await readFile(join(config.workspace, 'release-state.json'), 'utf8'));
        else if (values.start) {
            if (values.execute || values['retry-stage']) throw new Error('Start and direct execute/retry are separate operations');
            await mkdir(config.workspace, { recursive: true, mode: 0o700 });
            const [command, args] = detachedCommand(values.config, config.workspace);
            await runCommand(command, args);
        } else if (values.execute) {
            await releasePreflight(config);
            await deliverRelease(config, { retryStage: values['retry-stage'] });
        }
        else console.log(JSON.stringify({ version: config.version, phases,
            note: 'Plan only. --start or --execute performs authorized publication and idle-only apply.' }, null, 2));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}

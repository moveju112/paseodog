import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { root, paseoHome } from './paths.mjs';
import { runCommand } from './release-command.mjs';
import { withTestLock } from './test.mjs';
import { advanceReleaseVersion } from './release-version.mjs';
import { desktopRootPids } from './release-apply.mjs';
import { deliveryPlan, describePlan, validateTargets } from './release-targets.mjs';

// 준비된 전용 worktree만 전진시킨다. 의존성/Gradle/Metro 복사나 사용자 트리 정리는 하지 않는다.
export async function prepareRelease(profile, commit, { run = runCommand, adopt = false, start = false, nextVersion = false,
    reconcileDesktopExit = false, reconcilePluginReload = false, reconcileRuntimeUpdate = false, targets = profile.targets } = {}) {
    const requestStartedAt = new Date().toISOString();
    if (nextVersion && !start) throw new Error('--next-version requires --start');
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('An exact pushed commit is required');
    targets = validateTargets(targets);
    if (!isAbsolute(profile.sourceRoot || '') || !isAbsolute(profile.cacheRoot || ''))
        throw new Error('sourceRoot and cacheRoot must be absolute');
    const source = await realpath(profile.sourceRoot);
    if (source === root || !(await stat(join(source, '.git'))).isFile())
        throw new Error('Use a dedicated existing worktree, not the caller checkout');
    const capture = (args, cwd = source) => run('git', args, { cwd, capture: true });
    const common = (await capture(['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim();
    const callerCommon = (await capture(['rev-parse', '--path-format=absolute', '--git-common-dir'], root)).trim();
    if (common !== callerCommon) throw new Error('Prepared worktree belongs to another repository');
    await mkdir(profile.cacheRoot, { recursive: true, mode: 0o700 });
    const marker = join(profile.cacheRoot, 'prepared-source.json');
    return withTestLock(async () => {
        let previous, reconciliation, reconciliationFile = 'desktop-exit-reconciliation.json';
        try { previous = JSON.parse(await readFile(marker, 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (!previous && !adopt) throw new Error('Adopt the existing dedicated worktree once with --adopt');
        if (!previous) {
            if (!isAbsolute(profile.previousWorkspace || ''))
                throw new Error('Adoption requires the existing delivery workspace for its active-work check');
            previous = { source, common, workspace: profile.previousWorkspace };
        }
        if (previous && (previous.source !== source || previous.common !== common))
            throw new Error('Prepared worktree identity changed');
        if (previous?.workspace) {
            const id = createHash('sha256').update(previous.workspace).digest('hex').slice(0, 12);
            const state = await run('systemctl', ['--user', 'list-units', '--all', '--no-legend', '--plain',
                `paseodog-delivery-${id}.service`], { capture: true });
            if (['active', 'activating', 'reloading', 'deactivating'].includes(state.trim().split(/\s+/)[2]))
                throw new Error('Prepared worktree is still serving an active delivery');
            let delivery;
            try { delivery = JSON.parse(await readFile(join(previous.workspace, 'release-state.json'), 'utf8')); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
            const uncertain = Object.entries(delivery?.stages || {})
                .filter(([, stage]) => stage.mutation && stage.status !== 'complete');
            if (uncertain.length) {
                if (reconcileRuntimeUpdate && uncertain.length === 1 && uncertain[0][0] === 'runtime-update'
                    && ['running', 'failed'].includes(uncertain[0][1].status)) {
                    // 업데이터를 다시 실행하지 않는다. 실제 적용 리비전과 프로바이더 준비 상태만 관찰해 기록한다.
                    const updaterRoot = delivery.identity?.config?.updaterRoot;
                    if (!isAbsolute(updaterRoot || '')) throw new Error('Previous delivery has no daemon updater');
                    const receipt = JSON.parse(await readFile(join(updaterRoot, 'receipt.json'), 'utf8'));
                    if (receipt.phase !== 'applied' || !/^[0-9a-f]{40}$/.test(receipt.revision || ''))
                        throw new Error('Daemon updater has not applied a revision');
                    await capture(['merge-base', '--is-ancestor', delivery.identity.commit, receipt.revision]);
                    const wrapper = join(source, 'bin/paseodog.mjs');
                    const diagnostic = JSON.parse(await run(process.execPath,
                        [wrapper, 'provider', 'diagnostic', 'paseodog', '--json'], { capture: true }));
                    if (!diagnostic.diagnostic?.startsWith('Provider is available'))
                        throw new Error('Daemon provider readiness is not confirmed');
                    reconciliationFile = 'runtime-update-reconciliation.json';
                    reconciliation = { previousWorkspace: previous.workspace, previousCommit: delivery.identity.commit,
                        stage: 'runtime-update', outcome: 'daemon-applied-revision-contains-delivery',
                        appliedRevision: receipt.revision, observedAt: new Date().toISOString() };
                } else if (reconcilePluginReload && uncertain.length === 1 && uncertain[0][0] === 'plugin-reload'
                    && ['running', 'failed'].includes(uncertain[0][1].status)) {
                    const wrapper = join(source, 'bin/paseodog.mjs');
                    const daemon = await run(process.execPath, [wrapper, 'daemon', 'status'], { capture: true });
                    if (!daemon.includes(`home: ${paseoHome}\n`) || !daemon.includes('desktopManaged: false'))
                        throw new Error('Dedicated daemon independence is not confirmed');
                    const plugins = JSON.parse(await run(process.execPath,
                        [wrapper, 'plugin', 'ls', 'paseodog-provider', '--json'], { capture: true }));
                    const plugin = plugins.length === 1 ? plugins[0] : null;
                    if (plugin?.id !== 'paseodog-provider' || plugin.enabled !== true || plugin.status !== 'running'
                        || !isAbsolute(plugin.path || ''))
                        throw new Error('Previous provider is not running');
                    const loaded = JSON.parse(await readFile(join(plugin.path, 'shared/release.json'), 'utf8'));
                    const expected = delivery.identity?.config;
                    const installed = (await run('dpkg-query', ['-W', '-f=${Version}', 'paseodog'], { capture: true })).trim();
                    if (loaded.versionCode !== Number(expected?.versionCode)
                        || `${loaded.version}.${loaded.versionCode}` !== expected?.version
                        || installed !== expected.version.replace('-', '~'))
                        throw new Error('Previous installed and provider versions differ');
                    const diagnostic = JSON.parse(await run(process.execPath,
                        [wrapper, 'provider', 'diagnostic', 'paseodog', '--json'], { capture: true }));
                    if (!diagnostic.diagnostic?.startsWith('Provider is available'))
                        throw new Error('Previous provider readiness is not confirmed');
                    // 이전 성공을 만들어내거나 reload를 재전송하지 않는다. 현재 관찰만 다음 배포에 보존한다.
                    reconciliationFile = 'plugin-reload-reconciliation.json';
                    reconciliation = { previousWorkspace: previous.workspace, previousCommit: delivery.identity.commit,
                        stage: 'plugin-reload', outcome: 'provider-ready-after-interrupted-reload',
                        versionCode: loaded.versionCode, observedAt: new Date().toISOString() };
                } else {
                    if (!reconcileDesktopExit || uncertain.length !== 1 || uncertain[0][0] !== 'pc-launch'
                    || uncertain[0][1].status !== 'failed')
                    throw new Error('Reconcile the previous uncertain mutation before preparing another release');
                const log = await readFile(join(previous.workspace, 'delivery.log'), 'utf8');
                if (!log.trimEnd().endsWith('Desktop did not exit gracefully; no force kill performed'))
                    throw new Error('Desktop failure was not confirmed before launch');
                if (desktopRootPids(await run('ps', ['-eo', 'pid=,args='], { capture: true })).length)
                    throw new Error('Previous desktop is still running');
                const daemon = await run(process.execPath, [join(source, 'bin/paseodog.mjs'), 'daemon', 'status'], { capture: true });
                if (!daemon.includes(`home: ${paseoHome}\n`) || !daemon.includes('desktopManaged: false'))
                    throw new Error('Dedicated daemon independence is not confirmed');
                // 실패를 성공으로 바꾸거나 이전 앱을 재실행하지 않는다. 관찰 결과만 다음 배포에 보존한다.
                reconciliation = { previousWorkspace: previous.workspace, previousCommit: delivery.identity?.commit,
                    stage: 'pc-launch', outcome: 'desktop-exited-before-replacement',
                    observedAt: new Date().toISOString(), logSha256: createHash('sha256').update(log).digest('hex') };
                }
            }
        }
        if ((await capture(['status', '--porcelain'])).trim()) throw new Error('Prepared worktree has local changes');
        const before = (await capture(['rev-parse', 'HEAD'])).trim();
        const remote = (await capture(['ls-remote', 'origin', 'refs/heads/main'])).split(/\s/)[0];
        if (remote !== commit) throw new Error('Commit must be current origin/main');
        await capture(['fetch', 'origin', 'main']);
        await capture(['merge', '--ff-only', commit]);
        // 갱신한 소스의 버전·blob 게이트로 native 패치를 적용한 뒤에만 검증·배포를 시작한다.
        await run(process.execPath, [join(source, 'scripts/patch-mixdog.mjs')], { cwd: source });
        await run(process.execPath, [join(source, 'android/scripts/patch-metro-image-size.mjs')], { cwd: source });
        const workspace = await mkdtemp('/data/tmp/ubuntu/paseodog-release-');
        try {
            // 버전을 올리기 전에 배포 대상을 판정한다. 다른 세션의 이전 커밋도 기준점 이후 변경에 포함된다.
            const plan = await deliveryPlan({ ...profile, workspace, targets },
                { capture: (command, args, cwd) => run(command, args, { cwd, capture: true }), commit, cwd: source });
            console.log(`Delivery plan: ${describePlan(plan)}`);
            if (!Object.values(plan.targets).some(Boolean))
                throw new Error('No deployable changes since the deployed baselines');
            // GitHub 릴리즈가 없는 웹·런타임 배포는 앱 버전 번호를 올리지 않는다.
            if (nextVersion && (plan.targets.android || plan.targets.desktop))
                ({ commit } = await advanceReleaseVersion(source, profile.repo, run));
        } catch (error) {
            // 배포를 시작하지 않은 이번 호출의 빈 workspace만 정리한다.
            await rm(workspace, { recursive: true, force: true });
            throw error;
        }
        const env = { ...process.env,
            ...(profile.androidHome ? { ANDROID_HOME: profile.androidHome } : {}),
            ...(profile.wineBin ? { PATH: profile.wineBin + delimiter + process.env.PATH } : {}) };
        const nativeChanged = await capture(['diff', '--name-only', before, commit, '--',
            'android/packages/app/app.config.js', 'android/packages/app/package.json',
            'android/package-lock.json', 'android/packages/app/plugins',
            ':(glob)android/packages/app/modules/**/app.plugin*']);
        if (nativeChanged.trim()) await run('npx', ['--no-install', 'expo', 'prebuild',
            '--platform', 'android', '--no-install'], { cwd: join(source, 'android/packages/app'),
            env: { ...env, CI: '1', APP_VARIANT: 'production' } });
        if (reconciliation) await writeFile(join(workspace, reconciliationFile),
            JSON.stringify(reconciliation, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
        const config = { ...profile, workspace, requestStartedAt, targets };
        const path = join(workspace, 'config.json');
        await writeFile(path, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
        await writeFile(marker, JSON.stringify({ source, common, workspace }), { mode: 0o600 });
        // 갱신된 같은 checkout의 실행기에 검증과 배포를 맡긴다.
        await run(process.execPath, [join(source, 'scripts/release-pipeline.mjs'), '--config', path,
            start ? '--start' : '--verify-only'], { cwd: source, env });
        return { workspace, commit, source };
    }, 'prepared-source:' + source);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const { values } = parseArgs({ options: { config: { type: 'string' }, commit: { type: 'string' },
            adopt: { type: 'boolean' }, start: { type: 'boolean' }, 'next-version': { type: 'boolean' },
            targets: { type: 'string' },
            'reconcile-desktop-exit': { type: 'boolean' }, 'reconcile-plugin-reload': { type: 'boolean' },
            'reconcile-runtime-update': { type: 'boolean' } } });
        if (!isAbsolute(values.config || '')) throw new Error('--config requires an absolute host profile');
        const profile = JSON.parse(await readFile(values.config, 'utf8'));
        console.log(JSON.stringify(await prepareRelease(profile, values.commit,
            { adopt: values.adopt, start: values.start, nextVersion: values['next-version'],
                reconcileDesktopExit: values['reconcile-desktop-exit'], reconcilePluginReload: values['reconcile-plugin-reload'],
                reconcileRuntimeUpdate: values['reconcile-runtime-update'],
                // auto(기본)·full 또는 쉼표로 구분한 대상 목록
                targets: !values.targets || ['auto', 'full'].includes(values.targets) ? values.targets ?? profile.targets
                    : values.targets.split(',') })));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { prepareRelease } from '../scripts/release-prepare.mjs';
import { releasePreflight } from '../scripts/release-preflight.mjs';
import { runCommand } from '../scripts/release-command.mjs';
import { paseoHome, scratchPath } from '../scripts/paths.mjs';
import { recordDeployment } from '../scripts/release-targets.mjs';

async function fixture(t) {
    const directory = await mkdtemp(scratchPath('paseodog-prepare-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const sourceRoot = join(directory, 'source'), cacheRoot = join(directory, 'cache');
    await mkdir(sourceRoot); await mkdir(cacheRoot);
    await writeFile(join(sourceRoot, '.git'), 'gitdir: fixture');
    return { sourceRoot, cacheRoot, previousWorkspace: join(directory, 'previous') };
}

test('prepared worktree preserves dependency bytes, reuses its registration and never copies a tree', async t => {
    const profile = await fixture(t);
    await writeFile(join(profile.sourceRoot, 'dependency'), 'unchanged');
    const calls = [];
    const commit = 'a'.repeat(40);
    const run = async (command, args) => {
        calls.push([command, ...args]);
        if (command === 'git') {
            if (args[0] === 'rev-parse') return '/repo/common\n';
            if (args[0] === 'ls-remote') return commit + '\trefs/heads/main\n';
        }
        return '';
    };
    const first = await prepareRelease(profile, commit, { run, adopt: true });
    t.after(() => rm(first.workspace, { recursive: true, force: true }));
    const second = await prepareRelease(profile, commit, { run, start: true });
    t.after(() => rm(second.workspace, { recursive: true, force: true }));
    assert.notEqual(first.workspace, second.workspace);
    assert.equal(await readFile(join(profile.sourceRoot, 'dependency'), 'utf8'), 'unchanged');
    assert.ok(calls.some(row => row.includes('--ff-only')));
    assert.ok(calls.some(row => row.includes('--verify-only')));
    assert.ok(calls.some(row => row.includes('--start')));
    assert.ok(calls.every(row => !['cp', 'npm', 'rsync'].includes(row[0])));
    const patches = calls.map((row, index) => row[1] === join(profile.sourceRoot, 'scripts/patch-mixdog.mjs') ? index : -1)
        .filter(index => index >= 0);
    assert.equal(patches.length, 2);
    assert.ok(calls.findIndex(row => row.includes('--ff-only')) < patches[0]);
    assert.ok(patches[0] < calls.findIndex(row => row.includes('--verify-only')));
    assert.ok(patches[1] < calls.findIndex(row => row.includes('--start')));
});

test('native patch rejection stops preparation before versioning or starting delivery', async t => {
    const profile = await fixture(t);
    const commit = 'd'.repeat(40);
    const calls = [];
    const run = async (command, args) => {
        calls.push([command, ...args]);
        if (command === 'git') {
            if (args[0] === 'rev-parse') return '/repo/common\n';
            if (args[0] === 'ls-remote') return commit + '\trefs/heads/main\n';
        }
        if (args[0] === join(profile.sourceRoot, 'scripts/patch-mixdog.mjs'))
            throw new Error('Native patch hash mismatch');
        return '';
    };
    await assert.rejects(prepareRelease(profile, commit, { run, adopt: true, start: true, nextVersion: true }),
        /Native patch hash mismatch/);
    assert.ok(calls.some(row => row.includes('--ff-only')));
    assert.ok(calls.every(row => !row.includes('commit') && !row.includes('push') && !row.includes('--start')
        && !row.includes('--verify-only') && row[0] !== 'gh'));
});

test('preparation rejects active delivery, dirty sources and uncertain mutation without advancing source', async t => {
    const profile = await fixture(t);
    const commit = 'b'.repeat(40);
    const calls = [];
    let state = 'unit loaded active running description', dirty = '';
    const run = async (command, args) => {
        calls.push([command, ...args]);
        if (command === 'systemctl') return state;
        if (args[0] === 'rev-parse') return '/repo/common';
        if (args[0] === 'status') return dirty;
        if (args[0] === 'ls-remote') return commit;
        return '';
    };
    await assert.rejects(prepareRelease(profile, commit, { run, adopt: true }), /active delivery/);
    state = ''; dirty = ' M source';
    await assert.rejects(prepareRelease(profile, commit, { run, adopt: true }), /local changes/);
    dirty = '';
    await mkdir(profile.previousWorkspace);
    await writeFile(join(profile.previousWorkspace, 'release-state.json'),
        JSON.stringify({ stages: { upload: { mutation: true, status: 'running' } } }));
    await assert.rejects(prepareRelease(profile, commit, { run, adopt: true }), /uncertain mutation/);
    assert.ok(calls.every(row => !row.includes('merge') && !row.includes('fetch')));
});

test('explicit desktop reconciliation preserves the failed receipt and rejects unresolved outcomes', async t => {
    const profile = await fixture(t);
    const commit = 'c'.repeat(40);
    await mkdir(profile.previousWorkspace);
    const statePath = join(profile.previousWorkspace, 'release-state.json');
    const logPath = join(profile.previousWorkspace, 'delivery.log');
    const original = JSON.stringify({ identity: { commit: 'b'.repeat(40) },
        stages: { 'pc-launch': { status: 'failed', mutation: true } } });
    await writeFile(statePath, original);
    await writeFile(logPath, 'pc-launch: start\nDesktop did not exit gracefully; no force kill performed\n');
    let processes = '123 /opt/PaseoDog/PaseoDog.bin\n';
    let daemon = `home: ${paseoHome}\ndesktopManaged: true\n`;
    const calls = [];
    const run = async (command, args) => {
        calls.push([command, ...args]);
        if (command === 'ps') return processes;
        if (args.includes('daemon')) return daemon;
        if (command === 'git') {
            if (args[0] === 'rev-parse') return '/repo/common';
            if (args[0] === 'ls-remote') return commit;
        }
        return '';
    };
    const options = { run, adopt: true, reconcileDesktopExit: true };
    await assert.rejects(prepareRelease(profile, commit, { run, adopt: true }), /uncertain mutation/);
    await assert.rejects(prepareRelease(profile, commit, options), /still running/);
    processes = '456 /opt/OtherApp/app\n';
    await assert.rejects(prepareRelease(profile, commit, options), /independence/);
    daemon = `home: ${paseoHome}\ndesktopManaged: false\n`;
    await writeFile(logPath, 'Desktop launch confirmation timed out; inspect desktop.log\n');
    await assert.rejects(prepareRelease(profile, commit, options), /before launch/);
    await writeFile(logPath, 'Desktop did not exit gracefully; no force kill performed\n');
    await writeFile(statePath, JSON.stringify({ stages: {
        'pc-launch': { status: 'failed', mutation: true },
        upload: { status: 'running', mutation: true },
    } }));
    await assert.rejects(prepareRelease(profile, commit, options), /uncertain mutation/);
    assert.ok(calls.every(row => !row.includes('fetch') && !row.includes('merge')));
    await writeFile(statePath, original);
    const result = await prepareRelease(profile, commit, options);
    t.after(() => rm(result.workspace, { recursive: true, force: true }));
    assert.equal(await readFile(statePath, 'utf8'), original);
    const receipt = JSON.parse(await readFile(join(result.workspace, 'desktop-exit-reconciliation.json'), 'utf8'));
    assert.equal(receipt.previousCommit, 'b'.repeat(40));
    assert.equal(receipt.outcome, 'desktop-exited-before-replacement');
    assert.equal(receipt.previousWorkspace, profile.previousWorkspace);
    assert.ok(calls.every(row => !row.includes('SIGKILL') && !row.includes('--retry-stage')));
});

test('interrupted reload reconciliation verifies actual versions and readiness without replaying or rewriting its receipt', async t => {
    const profile = await fixture(t), commit = 'e'.repeat(40);
    await mkdir(profile.previousWorkspace);
    const pluginPath = join(profile.cacheRoot, 'plugin');
    await mkdir(join(pluginPath, 'shared'), { recursive: true });
    await writeFile(join(pluginPath, 'shared/release.json'), JSON.stringify({ version: '1.0.0-rc.7', versionCode: 91 }));
    const statePath = join(profile.previousWorkspace, 'release-state.json');
    const original = JSON.stringify({ identity: { commit: 'f'.repeat(40),
        config: { version: '1.0.0-rc.7.91', versionCode: '91' } },
        stages: { 'plugin-reload': { status: 'running', mutation: true } } });
    await writeFile(statePath, original);
    const calls = [];
    let installed = '1.0.0~rc.7.90', ready = false;
    const run = async (command, args) => {
        calls.push([command, ...args]);
        if (command === 'git') {
            if (args[0] === 'rev-parse') return '/repo/common';
            if (args[0] === 'ls-remote') return commit;
        }
        if (command === 'dpkg-query') return installed;
        if (args.includes('daemon')) return `home: ${paseoHome}\ndesktopManaged: false\n`;
        if (args.includes('plugin')) return JSON.stringify([
            { id: 'paseodog-provider', enabled: true, status: 'running', path: pluginPath },
        ]);
        if (args.includes('diagnostic')) return JSON.stringify({ diagnostic: ready ? 'Provider is available\nReady' : 'Unavailable' });
        return '';
    };
    await assert.rejects(prepareRelease(profile, commit, { run, adopt: true }), /uncertain mutation/);
    const options = { run, adopt: true, reconcilePluginReload: true };
    await assert.rejects(prepareRelease(profile, commit, options), /versions differ/);
    installed = '1.0.0~rc.7.91';
    await assert.rejects(prepareRelease(profile, commit, options), /readiness/);
    ready = true;
    const result = await prepareRelease(profile, commit, options);
    t.after(() => rm(result.workspace, { recursive: true }));
    assert.equal(await readFile(statePath, 'utf8'), original);
    const receipt = JSON.parse(await readFile(join(result.workspace, 'plugin-reload-reconciliation.json'), 'utf8'));
    assert.equal(receipt.stage, 'plugin-reload');
    assert.equal(receipt.outcome, 'provider-ready-after-interrupted-reload');
    assert.equal(receipt.versionCode, 91);
    assert.ok(calls.every(row => !row.includes('reload') && !row.includes('--retry-stage')));
});

// 데몬 업데이트 단계가 불확실하게 끝나면 업데이터를 다시 실행하지 않고 적용 리비전과 준비 상태만 확인해 기록한다.
test('runtime-update reconciliation observes the applied daemon revision and readiness without rerunning the updater', async t => {
    const profile = await fixture(t), commit = 'e'.repeat(40), delivered = 'f'.repeat(40);
    await mkdir(profile.previousWorkspace);
    const updaterRoot = join(profile.cacheRoot, 'updater');
    await mkdir(updaterRoot);
    const statePath = join(profile.previousWorkspace, 'release-state.json');
    const original = JSON.stringify({ identity: { commit: delivered, config: { updaterRoot } },
        stages: { 'runtime-update': { status: 'failed', mutation: true } } });
    await writeFile(statePath, original);
    let ancestor = false, ready = false;
    const calls = [];
    const run = async (command, args) => {
        calls.push([command, ...args]);
        if (command === 'git') {
            if (args[0] === 'rev-parse') return '/repo/common';
            if (args[0] === 'ls-remote') return commit;
            if (args[0] === 'merge-base') { if (!ancestor) throw new Error('not ancestor'); return ''; }
        }
        if (args.includes('diagnostic')) return JSON.stringify({ diagnostic: ready ? 'Provider is available\nReady' : 'Unavailable' });
        return '';
    };
    const options = { run, adopt: true, reconcileRuntimeUpdate: true };
    await assert.rejects(prepareRelease(profile, commit, { run, adopt: true }), /uncertain mutation/);
    await writeFile(join(updaterRoot, 'receipt.json'), JSON.stringify({ revision: delivered, phase: 'preparing' }));
    await assert.rejects(prepareRelease(profile, commit, options), /has not applied/);
    await writeFile(join(updaterRoot, 'receipt.json'), JSON.stringify({ revision: commit, phase: 'applied' }));
    await assert.rejects(prepareRelease(profile, commit, options), /not ancestor/);
    ancestor = true;
    await assert.rejects(prepareRelease(profile, commit, options), /readiness/);
    ready = true;
    const result = await prepareRelease(profile, commit, options);
    t.after(() => rm(result.workspace, { recursive: true, force: true }));
    assert.equal(await readFile(statePath, 'utf8'), original);
    const receipt = JSON.parse(await readFile(join(result.workspace, 'runtime-update-reconciliation.json'), 'utf8'));
    assert.equal(receipt.outcome, 'daemon-applied-revision-contains-delivery');
    assert.equal(receipt.appliedRevision, commit);
    assert.ok(calls.every(row => !(row[0] === 'systemctl' && row.includes('start')) && !row.includes('--retry-stage')));
});

test('preflight rejects the wrong signing reference before a command or expensive check', async t => {
    const profile = await fixture(t);
    const signingInit = join(profile.cacheRoot, 'init.gradle');
    await writeFile(signingInit, 'storeFile = file("/wrong/key")');
    let calls = 0;
    await assert.rejects(releasePreflight({ signingInit, signingKey: '/approved/key' },
        async () => { calls++; }), /Signing init/);
    assert.equal(calls, 0);
});

test('preflight rejects incompatible installed dependencies before test commands', async t => {
    const profile = await fixture(t);
    const signingKey = join(profile.cacheRoot, 'key'), signingInit = join(profile.cacheRoot, 'init');
    const previousApk = join(profile.cacheRoot, 'previous.apk'), androidTools = join(profile.cacheRoot, 'tools');
    await mkdir(androidTools);
    for (const path of [signingKey, previousApk, ...['apksigner', 'zipalign', 'aapt'].map(name => join(androidTools, name))])
        await writeFile(path, 'fixture');
    await writeFile(signingInit, `storeFile = file("${signingKey}")`);
    const engine = join(profile.sourceRoot, 'engine');
    await mkdir(join(engine, 'node_modules'), { recursive: true });
    await writeFile(join(engine, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/model': { version: '1' } } }));
    await writeFile(join(engine, 'node_modules/.package-lock.json'),
        JSON.stringify({ packages: { 'node_modules/model': { version: '2' } } }));
    let calls = 0;
    await assert.rejects(releasePreflight({ signingKey, signingInit, previousApk, androidTools },
        async () => { calls++; }, profile.sourceRoot), /differs from lockfile/);
    assert.equal(calls, 0);
});

test('parallel syntax checks keep JSON, JavaScript and shell failure reporting', async t => {
    const profile = await fixture(t);
    const scripts = join(profile.sourceRoot, 'scripts');
    await mkdir(scripts);
    await writeFile(join(scripts, 'check.mjs'), await readFile(new URL('../scripts/check.mjs', import.meta.url)));
    await writeFile(join(scripts, 'paths.mjs'), `export const root = ${JSON.stringify(profile.sourceRoot)};`);
    await writeFile(join(profile.sourceRoot, 'bad.json'), '{bad');
    await writeFile(join(profile.sourceRoot, 'bad.mjs'), 'export const =');
    await writeFile(join(profile.sourceRoot, 'bad.sh'), 'if then');
    const log = join(profile.cacheRoot, 'check.log');
    await assert.rejects(runCommand(process.execPath, [join(scripts, 'check.mjs')], { log }), /failed/);
    const output = await readFile(log, 'utf8');
    assert.ok(output.includes('bad.json') && output.includes('bad.mjs'));
    if (process.platform !== 'win32') assert.ok(output.includes('bad.sh'));
});

test('preparation stops before versioning when nothing changed and skips versioning for runtime-only delivery', async t => {
    const profile = await fixture(t);
    const commit = 'e'.repeat(40), base = 'a'.repeat(40);
    // 웹·데몬 기준점이 기록된 상태에서 자동 판정한다.
    await recordDeployment(profile.cacheRoot, 'web', { commit: base });
    const updaterRoot = join(profile.cacheRoot, 'updater');
    await mkdir(updaterRoot);
    await writeFile(join(updaterRoot, 'receipt.json'), JSON.stringify({ phase: 'applied', revision: base }));
    const prepare = changed => {
        const calls = [];
        const run = async (command, args) => {
            calls.push([command, ...args]);
            if (command === 'git') {
                if (args[0] === 'rev-parse') return '/repo/common\n';
                if (args[0] === 'ls-remote') return commit + '\trefs/heads/main\n';
                if (args[0] === 'diff' && args.includes('-z')) return changed.join('\0');
            }
            if (command === 'gh' && args[1] === 'view' && args[2] === '--repo')
                return JSON.stringify({ tagName: 'v1.0.0-rc.7.11090', assets: [] });
            if (command === 'gh' && args[1] === 'download') {
                const output = args[args.indexOf('--dir') + 1];
                await writeFile(join(output, 'paseodog-android-update.json'),
                    JSON.stringify({ versionCode: 11090, versionName: '1.0.0-rc.7.11090' }));
                for (const name of ['latest-linux.yml', 'latest.yml']) await writeFile(join(output, name), 'version: 1.0.0-rc.7.11090\n');
            }
            if (command === 'gh' && args[1] === 'view') return JSON.stringify({ targetCommitish: base, isDraft: false });
            if (command === 'dpkg-query') return '1.0.0~rc.7.11090';
            return '';
        };
        const result = prepareRelease({ ...profile, repo: 'moveju112/paseodog', updaterRoot, updaterUnit: 'paseodog-update.service' },
            commit, { run, adopt: true, start: true, nextVersion: true });
        return { calls, result };
    };
    const versioned = calls => calls.some(row => row[0] === 'git' && ['commit', 'push'].includes(row[1]));
    let { calls, result } = prepare(['docs/a.md', 'tests/journal.test.mjs']);
    await assert.rejects(result, /No deployable changes/);
    assert.equal(versioned(calls), false);
    assert.ok(calls.every(row => !row.includes('--start')));
    // 데몬 전용 변경은 앱 버전을 올리지 않고 바로 배포를 시작한다.
    ({ calls, result } = prepare(['patches/paseo-usage-donut.mjs']));
    const runtime = await result;
    t.after(() => rm(runtime.workspace, { recursive: true, force: true }));
    assert.equal(versioned(calls), false);
    assert.ok(calls.some(row => row.includes('--start')));
    // 앱 변경은 GitHub 릴리즈가 필요하므로 버전 준비 단계로 들어간다.
    ({ calls, result } = prepare(['android/packages/app/src/app.tsx']));
    await assert.rejects(result, /release\.json|ENOENT/);
    assert.ok(calls.every(row => !row.includes('--start')));
});

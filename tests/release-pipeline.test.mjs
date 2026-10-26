import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { openReleaseState, insideWorkspace } from '../scripts/release-state.mjs';
import { validateReleaseConfig, activeAgents, waitForIdle, detachedCommand, deliverRelease, unlockStoppedDelivery } from '../scripts/release-pipeline.mjs';
import { verifiedBuildCache } from '../scripts/verified-build-cache.mjs';
import { measureBuildStep } from '../scripts/build-metrics.mjs';
import { verifyRemoteAssets, verifyUpdaterManifest } from '../scripts/release-artifacts.mjs';
import { desktopRootPids } from '../scripts/release-apply.mjs';
import { verifyReleaseWeb } from '../scripts/release-web-check.mjs';
import { buildWeb } from '../scripts/build-web.mjs';
import { verifyReleaseSource, sourceFingerprint } from '../scripts/release-verification.mjs';
import { root } from '../scripts/paths.mjs';
import { withTestLock } from '../scripts/test.mjs';
import { carriedAssets, classifyPaths, deliveryPlan, pathTargets, readLedger, recordDeployment, validateTargets } from '../scripts/release-targets.mjs';
import { runtimeChanges } from '../scripts/runtime-changes.mjs';
import { execFileSync } from 'node:child_process';

async function temporary(t) {
    const directory = await mkdtemp('/data/tmp/ubuntu/paseodog-release-test-');
    t.after(() => rm(directory, { recursive: true, force: true }));
    return directory;
}

test('checkpoint resumes only verified complete artifacts and rejects changed release identity', async t => {
    const directory = await temporary(t);
    const artifact = join(directory, 'artifact');
    let runs = 0;
    const { stage } = await openReleaseState(directory, { commit: 'first' });
    await stage('build', async () => { runs++; await writeFile(artifact, 'verified'); return 'ok'; }, { artifacts: [artifact] });
    const resumed = await openReleaseState(directory, { commit: 'first' });
    assert.equal(await resumed.stage('build', () => { runs++; }, { artifacts: [artifact] }), 'ok');
    assert.equal(runs, 1);
    await writeFile(artifact, 'changed');
    await assert.rejects(resumed.stage('build', () => { runs++; }, { artifacts: [artifact] }), /artifact drift/);
    await assert.rejects(openReleaseState(directory, { commit: 'second' }), /identity changed/);
    assert.equal(runs, 1);
});

test('failed mutation requires explicit reconciliation and retry, never an automatic replay', async t => {
    const directory = await temporary(t);
    const first = await openReleaseState(directory, {});
    let calls = 0;
    await assert.rejects(first.stage('upload', () => { calls++; throw new Error('disconnected'); }, { mutation: true }), /disconnected/);
    const resumed = await openReleaseState(directory, {});
    await assert.rejects(resumed.stage('upload', () => { calls++; }, { mutation: true }), /Uncertain mutation/);
    assert.equal(calls, 1);
    const authorizedRetry = await openReleaseState(directory, {}, { retryStage: 'upload' });
    await authorizedRetry.stage('upload', () => { calls++; }, { mutation: true });
    assert.equal(calls, 2);
});

test('running mutation and parallel build checkpoints survive restart without losing siblings', async t => {
    const directory = await temporary(t);
    const first = await openReleaseState(directory, {});
    await Promise.all(['android', 'linux'].map(name => first.stage(name, async () => name)));
    const saved = JSON.parse(await readFile(join(directory, 'release-state.json'), 'utf8'));
    assert.equal(saved.stages.android.status, 'complete');
    assert.equal(saved.stages.linux.status, 'complete');
    saved.stages.publish = { status: 'running', mutation: true };
    await writeFile(join(directory, 'release-state.json'), JSON.stringify(saved));
    const resumed = await openReleaseState(directory, {});
    await assert.rejects(resumed.stage('publish', () => assert.fail('must not replay'), { mutation: true }), /Uncertain mutation/);
});

test('active delivery locks cannot be removed and competing runs cannot enter the pipeline', async t => {
    const directory = await temporary(t);
    await writeFile(join(directory, 'delivery.lock'), String(process.pid));
    await assert.rejects(unlockStoppedDelivery(directory), /still alive/);
});

test('test harness serializes heavyweight runs and releases the slot after failure', { skip: process.platform !== 'linux' }, async t => {
    const directory = await temporary(t);
    const events = [];
    let entered, finish;
    const started = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { finish = resolve; });
    const first = withTestLock(async () => { events.push('first'); entered(); await gate; events.push('released'); }, directory);
    await started;
    const second = withTestLock(async () => { events.push('second'); throw new Error('fixture failed'); }, directory);
    const rejected = assert.rejects(second, /fixture failed/);
    finish();
    await first;
    await rejected;
    await withTestLock(async () => { events.push('third'); }, directory);
    assert.deepEqual(events, ['first', 'released', 'second', 'third']);
});

test('idle gate waits for every active turn and times out without mutating anything', async () => {
    let time = 0;
    let reads = 0;
    await waitForIdle(async () => ++reads < 3 ? [{ status: 'running' }] : [], {
        sleep: async ms => { time += ms; }, now: () => time,
    });
    assert.equal(reads, 3);
    assert.deepEqual(activeAgents([{ status: 'idle' }, { status: 'initializing' }]), [{ status: 'initializing' }]);
    await assert.rejects(waitForIdle(async () => [{ status: 'running' }], {
        sleep: async ms => { time += ms; }, now: () => time, timeoutMs: 10000,
    }), /apply is pending/);
});

test('source verification hashes directory symlinks and invalidates changed links or tracked bytes', async t => {
    const directory = await temporary(t);
    await mkdir(join(directory, 'first'));
    await mkdir(join(directory, 'second'));
    const link = join(directory, 'link');
    const file = join(directory, 'first', 'source');
    await symlink('first', link);
    await writeFile(file, 'before');
    const run = async () => [link, file].map(path => relative(root, path)).join('\0');
    const original = await sourceFingerprint(run);
    assert.equal(await sourceFingerprint(run), original);
    await writeFile(file, 'after');
    const edited = await sourceFingerprint(run);
    assert.notEqual(edited, original);
    await rm(link);
    await symlink('second', link);
    assert.notEqual(await sourceFingerprint(run), edited);
});

test('unchanged pre-commit source checks are reused for delivery and a changed test list invalidates them', async t => {
    const workspace = await temporary(t);
    let checks = 0;
    const run = async command => {
        if (command === 'git') return '';
        checks++;
        return '';
    };
    const config = { workspace, appTests: ['src/first.test.ts'] };
    assert.equal((await verifyReleaseSource(config, run)).cached, false);
    const before = checks;
    assert.equal((await verifyReleaseSource(config, run)).cached, true);
    assert.equal(checks, before);
    assert.equal((await verifyReleaseSource({ ...config, appTests: ['src/second.test.ts'] }, run)).cached, false);
    assert.equal(checks, before + 1);
});

test('verification retains completed checks across failure and output-workspace changes', async t => {
    const cacheRoot = await temporary(t);
    const workspace = await temporary(t);
    const counts = new Map();
    let fail = true;
    const run = async (command, args, options) => {
        if (command === 'git') return '';
        const name = options.log.split('/').at(-1);
        counts.set(name, (counts.get(name) || 0) + 1);
        if (name === 'test.log' && fail) throw new Error('test failure');
        return '';
    };
    const config = { cacheRoot, workspace, appTests: ['src/first.test.ts'] };
    await assert.rejects(verifyReleaseSource(config, run), /test failure/);
    assert.equal(counts.size, 5);
    fail = false;
    const resumed = await verifyReleaseSource({ ...config, workspace: await temporary(t) }, run);
    assert.equal(resumed.results.filter(result => result.cached).length, 4);
    assert.equal(counts.get('test.log'), 2);
    assert.equal(counts.get('check.log'), 1);
    assert.equal(counts.get('app-types.log'), 1);
    await verifyReleaseSource({ ...config, verificationEpoch: 1 }, run);
    assert.equal(counts.get('check.log'), 2);
});

for (const failure of [null, 'upload', 'export', 'install', 'pages']) {
test(`integrated delivery protects active turns, overlaps upload/export and resumes safely: ${failure ?? 'success'}`,
    { timeout: 10000 }, async t => {
    const directory = await temporary(t);
    const key = join(directory, 'approved.keystore'), init = join(directory, 'signing.gradle'), previous = join(directory, 'previous.apk');
    await writeFile(key, 'fixture'); await writeFile(init, `storeFile = file("${key}")`); await writeFile(previous, 'old');
    const config = validateReleaseConfig({
        workspace: directory, cacheRoot: directory + '-cache', signingInit: init, signingKey: key,
        previousApk: previous, androidTools: '/sdk/tools', metroWorkers: 2, appTests: ['src/fixture.test.ts'],
        repo: 'moveju112/paseodog', pagesProject: 'paseodog', webUrl: 'https://paseodog.choondoggy.com/',
    });
    t.after(() => rm(config.cacheRoot, { recursive: true, force: true }));
    const calls = [];
    let assets = [];
    let exportStarted;
    const exporting = new Promise(resolve => { exportStarted = resolve; });
    let installStarted;
    const installing = new Promise(resolve => { installStarted = resolve; });
    const run = async (command, args) => {
        calls.push([command, ...args]);
        if (command === 'git') {
            if (args[0] === 'rev-parse') return 'abc\n';
            if (args[0] === 'ls-remote') return 'abc\trefs/heads/main\n';
            return '';
        }
        if (command === 'python3') {
            await writeFile(join(directory, 'paseodog-android-update.json'), '{}');
        }
        if (command === 'gh' && args[1] === 'view') return JSON.stringify({
            targetCommitish: 'abc', assets: assets.map(path => ({ name: path.split('/').at(-1), size: 7 })),
        });
        if (command === 'npx' && args[0] === 'expo') throw new Error('Browser export must run in a bounded scope');
        if (command === 'gh' && args[1] === 'upload') {
            await exporting;
            await new Promise(resolve => setImmediate(resolve));
            if (failure === 'upload') throw new Error('upload failed');
        }
        if (command === 'systemd-run' && args.includes('expo')) {
            exportStarted();
            await new Promise(resolve => setImmediate(resolve));
            if (failure === 'export') throw new Error('export failed');
            const output = args[args.indexOf('--output-dir') + 1];
            const { mkdir } = await import('node:fs/promises');
            await mkdir(output); await writeFile(join(output, 'index.html'), 'fixture');
        }
        if (args.includes('ls') && args.includes('--json'))
            return JSON.stringify([{ status: 'idle' }]);
        if (command === 'dpkg-query') return '1.0.0~rc.7.11000';
        if (command === 'sudo' && args.includes('dpkg')) {
            installStarted();
            await new Promise(resolve => setImmediate(resolve));
            if (failure === 'install') throw new Error('install failed');
        }
        if (command === 'npx' && args.includes('wrangler')) {
            await installing;
            if (failure === 'pages') throw new Error('pages failed');
        }
        if (args.includes('diagnostic')) return '{"diagnostic":"Provider is available"}';
        return '';
    };
    const operations = {
        run, build: async ({ checkpoint }) => checkpoint('build-fixture', async () => { calls.push(['build']); }),
        verifyArtifacts: async () => {
            const path = join(directory, 'package.apk'); await writeFile(path, 'fixture'); assets = [path];
            calls.push(['verify-artifacts']); return assets;
        },
        checkWeb: async () => { calls.push(['check-browser']); },
        launchDesktop: async () => { calls.push(['desktop']); },
        installedRelease: async () => ({ versionCode: Number(config.versionCode) }),
    };
    if (failure) {
        await assert.rejects(deliverRelease(config, operations), new RegExp(`${failure} failed`));
        const saved = JSON.parse(await readFile(join(directory, 'release-state.json'), 'utf8'));
        assert.equal(saved.stages['github-upload'].status, failure === 'upload' ? 'failed' : 'complete');
        assert.equal(saved.stages['browser-export'].status, failure === 'export' ? 'failed' : 'complete');
        if (['install', 'pages'].includes(failure)) {
            assert.equal(saved.stages['pc-install'].status, failure === 'install' ? 'failed' : 'complete');
            assert.equal(saved.stages['pages-deploy'].status, failure === 'pages' ? 'failed' : 'complete');
            assert.equal(calls.some(row => row.includes('reload')), false);
            assert.equal(calls.some(row => row[0] === 'desktop'), false);
        } else {
            assert.equal(calls.some(row => row[0] === 'gh' && row[2] === 'edit'), false);
            assert.equal(calls.some(row => row.includes('deploy')), false);
        }
        await assert.rejects(readFile(join(directory, 'delivery.lock')), { code: 'ENOENT' });
        return;
    }
    await deliverRelease(config, operations);
    const firstCount = calls.filter(row => row[0] === 'gh' && ['create', 'upload', 'edit'].includes(row[2])).length;
    assert.equal(firstCount, 3);
    const verifyAt = calls.findIndex(row => row[0] === 'verify-artifacts');
    const publishAt = calls.findIndex(row => row[0] === 'gh' && row[2] === 'edit');
    const browserAt = calls.findIndex(row => row[0] === 'check-browser');
    const reloadAt = calls.findIndex(row => row.includes('reload'));
    assert.ok(verifyAt < publishAt && publishAt < browserAt && browserAt < reloadAt);
    const idleChecks = calls.flatMap((row, index) => row.includes('ls') && row.includes('--json') ? [index] : []);
    const installAt = calls.findIndex(row => row[0] === 'sudo' && row.includes('dpkg'));
    const desktopAt = calls.findIndex(row => row[0] === 'desktop');
    assert.equal(idleChecks.length, 3);
    assert.ok(publishAt < idleChecks[0] && idleChecks[0] < installAt);
    assert.ok(installAt < idleChecks[1] && idleChecks[1] < reloadAt);
    assert.ok(reloadAt < idleChecks[2] && idleChecks[2] < desktopAt);
    await deliverRelease(config, operations);
    assert.equal(calls.filter(row => row[0] === 'gh' && ['create', 'upload', 'edit'].includes(row[2])).length, 3);
    assert.equal(calls.filter(row => row[0] === 'desktop').length, 1);
    assert.equal(calls.filter(row => row[0] === 'build').length, 1);
});
}

test('delivery defaults are explicit targets and detached execution is a service, not a caller-owned scope', () => {
    const input = {
        workspace: '/data/tmp/ubuntu/paseodog-release-example', cacheRoot: '/data/tmp/ubuntu/cache',
        signingInit: '/approved/init.gradle', signingKey: '/approved/key', previousApk: '/approved/previous.apk',
        androidTools: '/sdk/tools', metroWorkers: 2, appTests: ['src/settings.test.ts'],
        repo: 'moveju112/paseodog', pagesProject: 'paseodog', webUrl: 'https://paseodog.choondoggy.com/',
    };
    assert.equal(validateReleaseConfig(input).metroWorkers, '2');
    assert.equal(validateReleaseConfig(input).targets, 'auto');
    assert.equal(validateReleaseConfig({ ...input, updaterRoot: '/updater', updaterUnit: 'paseodog-update.service' }).updaterUnit,
        'paseodog-update.service');
    for (const patch of [{ workspace: '/' }, { workspace: input.cacheRoot, cacheRoot: input.cacheRoot },
        { appTests: ['../../private'] }, { repo: 'another/repo' }, { targets: ['ios'] }, { updaterRoot: '/updater' },
        { updaterRoot: 'relative', updaterUnit: 'paseodog-update.service' }, { updaterRoot: '/updater', updaterUnit: 'x; rm' }])
        assert.throws(() => validateReleaseConfig({ ...input, ...patch }));
    assert.equal(insideWorkspace('/data/tmp/ubuntu', '/data/tmp/ubuntu-other/path'), false);
    const [command, args] = detachedCommand('/approved/config.json', input.workspace);
    assert.equal(command, 'systemd-run');
    assert.equal(args.includes('--scope'), false);
    assert.ok(args.includes('--execute'));
    assert.deepEqual(desktopRootPids('10 /opt/PaseoDog/PaseoDog.bin\n11 /opt/PaseoDog/PaseoDog.bin --type=renderer\n12 /other/PaseoDog.bin'), [10]);
});

test('cached build downloads are content verified, avoid a second producer call, and refuse corruption', async t => {
    const directory = await temporary(t);
    const bytes = Buffer.from('reviewed immutable archive');
    const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
    let calls = 0;
    const produce = async folder => { calls++; const path = join(folder, 'download.tgz'); await writeFile(path, bytes); return path; };
    const first = await verifiedBuildCache(directory, integrity, produce);
    assert.equal(first.cached, false);
    assert.equal((await verifiedBuildCache(directory, integrity, produce)).cached, true);
    assert.equal(calls, 1);
    await writeFile(first.path, 'tampered');
    await assert.rejects(verifiedBuildCache(directory, integrity, produce), /integrity mismatch/);
    assert.equal(calls, 1);
    await assert.rejects(verifiedBuildCache(directory, 'sha1-not-approved', produce), /SHA-512/);
});

test('packaging metrics record failure and elapsed time without converting failure to success', async t => {
    const directory = await temporary(t);
    const path = join(directory, 'metrics.jsonl');
    assert.equal(await measureBuildStep('copy', async () => 42, path), 42);
    await assert.rejects(measureBuildStep('download', async () => { throw new Error('network'); }, path), /network/);
    const rows = (await readFile(path, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(rows.map(row => [row.name, row.status]), [['copy', 'complete'], ['download', 'failed']]);
    assert.ok(rows.every(row => row.elapsedMs >= 0 && row.rssBytes > 0));
});

test('updater manifests verify both hash and size, not merely generated filenames', async t => {
    const directory = await temporary(t);
    const bytes = Buffer.from('fixture package');
    await writeFile(join(directory, 'package.deb'), bytes);
    const manifest = { version: '1.0.0', files: [{ url: 'package.deb', size: bytes.length,
        sha512: createHash('sha512').update(bytes).digest('base64') }] };
    await writeFile(join(directory, 'latest.yml'), JSON.stringify(manifest));
    assert.deepEqual(await verifyUpdaterManifest(directory, 'latest.yml', '1.0.0'), ['package.deb']);
    await writeFile(join(directory, 'package.deb'), 'tampered');
    await assert.rejects(verifyUpdaterManifest(directory, 'latest.yml', '1.0.0'));
    assert.throws(() => verifyRemoteAssets([{ name: 'a', size: 2 }], { a: 3 }));
});

test('browser export reuses the verified dependency phase but standalone export still builds dependencies', async t => {
    const output = await temporary(t);
    const calls = [];
    await buildWeb({ output, hosting: 'cloudflare', dependenciesBuilt: true }, async (command, args) => calls.push([command, ...args]));
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'npx');
});

test('real browser release check accepts omitted text type and verifies deep-link refresh without connecting', async t => {
    const output = await temporary(t);
    const html = '<!doctype html><script defer src="/index-fixture.js"></script>';
    await writeFile(join(output, 'index.html'), html);
    // 실제 앱처럼 로컬 데몬 연결 시도가 끝날 때까지 잠시 빈 화면을 유지한 뒤 환영 화면을 그린다.
    const script = `setTimeout(()=>{document.body.innerHTML='<div data-testid="welcome-screen"><button data-testid="welcome-direct-connection">Connect</button></div>';
document.querySelector('button').onclick=()=>{document.body.innerHTML='<input data-testid="direct-host-input"><input data-testid="direct-port-input"><input type="password" data-testid="direct-password-input"><button data-testid="direct-password-visibility-toggle">Show</button>';
document.querySelector('button').onclick=()=>{const p=document.querySelector('[data-testid="direct-password-input"]');if(p.type==='password')p.removeAttribute('type');else p.type='password'};};},1500);`;
    const server = createServer((request, response) => {
        response.setHeader('Content-Type', request.url === '/index-fixture.js' ? 'application/javascript' : 'text/html');
        response.end(request.url === '/index-fixture.js' ? script : html);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    await verifyReleaseWeb({ url: `http://127.0.0.1:${server.address().port}/`, output });
});

// 기준점 커밋은 실제 공개 매니페스트·설치 버전·원장·업데이터 receipt에서 읽는다.
function planFixture(directory, { changed = [], installed = '1.0.0~rc.7.11090', androidVersion = '1.0.0-rc.7.11090',
    desktopVersion = '1.0.0-rc.7.11090', bases = {}, diffFails = false } = {}) {
    const calls = [];
    const capture = async (command, args) => {
        calls.push([command, ...args]);
        if (command === 'gh' && args[1] === 'view' && args[2] === '--repo')
            return JSON.stringify({ tagName: 'v1.0.0-rc.7.11090', assets: [] });
        if (command === 'gh' && args[1] === 'download') {
            const output = args[args.indexOf('--dir') + 1];
            await writeFile(join(output, 'paseodog-android-update.json'), JSON.stringify({
                versionCode: Number(androidVersion.split('.').at(-1)), versionName: androidVersion }));
            for (const name of ['latest-linux.yml', 'latest.yml']) await writeFile(join(output, name), `version: ${desktopVersion}\n`);
            return '';
        }
        if (command === 'gh' && args[1] === 'view')
            return JSON.stringify({ targetCommitish: bases[args[2]] ?? 'a'.repeat(40), isDraft: false });
        if (command === 'dpkg-query') return installed;
        if (command === 'git' && args[0] === 'diff') {
            if (diffFails) throw new Error('unknown revision');
            return changed.join('\0');
        }
        throw new Error(`unexpected ${command}`);
    };
    return { calls, capture };
}

test('path classification separates platforms and falls back to every target for unknown paths', () => {
    // 데몬 웹 패치가 앱 소스를 가져다 쓰므로 앱 소스 변경은 런타임에도 포함한다.
    assert.deepEqual(pathTargets('android/packages/app/src/components/left-sidebar.tsx'), ['android', 'desktop', 'web', 'runtime']);
    assert.deepEqual(pathTargets('android/packages/server/src/server/conversation-titles.ts'), ['desktop', 'runtime']);
    assert.deepEqual(pathTargets('android/packages/server/package.json'), ['desktop']);
    assert.deepEqual(pathTargets('android/packages/app/android/app/build.gradle'), ['android']);
    assert.deepEqual(pathTargets('android/packages/desktop/src/main.ts'), ['desktop']);
    assert.deepEqual(pathTargets('plugin/server/connection.mjs'), ['runtime', 'desktop']);
    assert.deepEqual(pathTargets('patches/paseo-usage-donut.mjs'), ['runtime']);
    for (const path of ['docs/ai-rules/tasks/RELEASE.md', 'tests/journal.test.mjs', 'CHANGELOG.md',
        'plugin/shared/release.json', 'android/packages/app/src/polyfills/diagnostics-channel.test.ts',
        'scripts/release-pipeline.mjs', 'scripts/runtime-changes.mjs'])
        assert.deepEqual(pathTargets(path), [], path);
    assert.deepEqual(pathTargets('secrets/unknown.bin'), ['android', 'desktop', 'web', 'runtime']);
    assert.deepEqual(classifyPaths(['plugin/index.server.ts', 'docs/x.md']).runtime, ['plugin/index.server.ts']);
});

test('delivery plan selects only changed targets and carries unchanged updater manifests forward', async t => {
    const directory = await temporary(t);
    const cacheRoot = join(directory, 'cache');
    await recordDeployment(cacheRoot, 'web', { commit: 'b'.repeat(40) });
    const updaterRoot = join(directory, 'updater');
    await mkdir(updaterRoot);
    await writeFile(join(updaterRoot, 'receipt.json'), JSON.stringify({ phase: 'applied', revision: 'c'.repeat(40) }));
    const config = { workspace: directory, cacheRoot, repo: 'moveju112/paseodog', updaterRoot };
    const commit = 'f'.repeat(40);
    // 데스크톱 패키지 변경은 데스크톱만 배포한다.
    let fixture = planFixture(directory, { changed: ['android/packages/desktop/src/main.ts', 'docs/a.md'] });
    let plan = await deliveryPlan(config, { capture: fixture.capture, commit });
    assert.deepEqual(plan.targets, { android: false, desktop: true, web: false, runtime: false });
    assert.deepEqual(plan.carry, { android: { version: '1.0.0-rc.7.11090', versionCode: 11090 }, desktop: null });
    // 런타임만 바뀌면 GitHub 릴리즈 없이 데몬만 배포한다.
    fixture = planFixture(directory, { changed: ['patches/paseo-usage-donut.mjs'] });
    plan = await deliveryPlan(config, { capture: fixture.capture, commit });
    assert.deepEqual(plan.targets, { android: false, desktop: false, web: false, runtime: true });
    assert.deepEqual(plan.carry, { android: null, desktop: null });
    // APK만 바뀌면 이전 데스크톱 매니페스트와 설치 파일을 이월한다.
    fixture = planFixture(directory, { changed: ['android/packages/app/android/app/build.gradle'] });
    plan = await deliveryPlan(config, { capture: fixture.capture, commit });
    assert.deepEqual(plan.targets, { android: true, desktop: false, web: false, runtime: false });
    assert.deepEqual(plan.carry.desktop, { version: '1.0.0-rc.7.11090' });
    assert.deepEqual(carriedAssets(plan.carry), ['PaseoDog-1.0.0-rc.7.11090-amd64.deb',
        'PaseoDog-1.0.0-rc.7.11090-x86_64.AppImage', 'latest-linux.yml', 'PaseoDog-Setup-1.0.0-rc.7.11090-x64.exe',
        'PaseoDog-Setup-1.0.0-rc.7.11090-x64.exe.blockmap', 'latest.yml']);
    // 메타데이터·문서만 바뀌면 배포 대상이 없다.
    fixture = planFixture(directory, { changed: ['CHANGELOG.md', 'plugin/shared/release.json', 'docs/a.md'] });
    plan = await deliveryPlan(config, { capture: fixture.capture, commit });
    assert.equal(Object.values(plan.targets).some(Boolean), false);
});

test('delivery plan falls back to full delivery when a baseline is unknown and honors explicit targets', async t => {
    const directory = await temporary(t);
    const config = { workspace: directory, cacheRoot: join(directory, 'cache'), repo: 'moveju112/paseodog' };
    const commit = 'f'.repeat(40);
    // 원장·업데이터 기록이 없으면 웹과 런타임은 전체 배포한다.
    let fixture = planFixture(directory, { changed: ['android/packages/app/android/x.gradle'] });
    let plan = await deliveryPlan(config, { capture: fixture.capture, commit });
    assert.equal(plan.targets.web, true);
    assert.equal(plan.reasons.runtime, 'baseline unknown');
    // 기준 커밋을 로컬에서 비교할 수 없으면 해당 대상을 모두 배포한다.
    fixture = planFixture(directory, { diffFails: true });
    plan = await deliveryPlan(config, { capture: fixture.capture, commit });
    assert.deepEqual(plan.targets, { android: true, desktop: true, web: true, runtime: true });
    // PC 설치본이 뒤처졌으면 그 설치 버전 이후의 변경도 데스크톱 판정에 포함한다.
    fixture = planFixture(directory, { installed: '1.0.0~rc.7.11080' });
    plan = await deliveryPlan({ ...config, targets: ['android'] }, { capture: fixture.capture, commit });
    assert.deepEqual(plan.targets, { android: true, desktop: false, web: false, runtime: false });
    assert.equal(plan.mode, 'explicit');
    assert.ok(fixture.calls.some(row => row.includes('v1.0.0-rc.7.11080')));
    plan = await deliveryPlan({ ...config, targets: 'full' }, { capture: planFixture(directory).capture, commit });
    assert.deepEqual(plan.targets, { android: true, desktop: true, web: true, runtime: true });
    assert.throws(() => validateTargets(['ios']), /targets must be/);
});

test('web-only delivery skips GitHub and PC apply, then records the deployed web commit', { timeout: 10000 }, async t => {
    const directory = await temporary(t);
    const key = join(directory, 'approved.keystore'), init = join(directory, 'signing.gradle'), previous = join(directory, 'previous.apk');
    await writeFile(key, 'fixture'); await writeFile(init, `storeFile = file("${key}")`); await writeFile(previous, 'old');
    const config = validateReleaseConfig({
        workspace: directory, cacheRoot: directory + '-cache', signingInit: init, signingKey: key,
        previousApk: previous, androidTools: '/sdk/tools', metroWorkers: 2, appTests: ['src/fixture.test.ts'],
        repo: 'moveju112/paseodog', pagesProject: 'paseodog', webUrl: 'https://paseodog.choondoggy.com/',
        targets: ['web'],
    });
    t.after(() => rm(config.cacheRoot, { recursive: true, force: true }));
    const commit = 'f'.repeat(40);
    const calls = [];
    const run = async (command, args) => {
        calls.push([command, ...args]);
        if (command === 'git' && args[0] === 'rev-parse') return commit + '\n';
        if (command === 'git' && args[0] === 'ls-remote') return commit + '\trefs/heads/main\n';
        if (command === 'systemd-run' && args.includes('expo')) {
            const output = args[args.indexOf('--output-dir') + 1];
            await mkdir(output); await writeFile(join(output, 'index.html'), 'fixture');
        }
        if (command === 'gh' && args[1] === 'view') throw new Error('no release');
        return '';
    };
    const builds = [];
    const result = await deliverRelease(config, {
        run, build: async ({ targets }) => { builds.push(targets); },
        verifyArtifacts: async () => { throw new Error('GitHub artifacts must not be verified'); },
        checkWeb: async () => { calls.push(['check-browser']); },
        launchDesktop: async () => { throw new Error('desktop must not launch'); },
        installedRelease: async () => { throw new Error('desktop must not be read'); },
    });
    assert.equal(result.tag, null);
    assert.deepEqual(builds, [{ android: false, desktop: false, web: true, runtime: false }]);
    assert.equal(calls.some(row => row[0] === 'gh' && ['create', 'upload', 'edit'].includes(row[2])), false);
    assert.equal(calls.some(row => row[0] === 'sudo' || row.includes('reload') || row.includes('ls')), false);
    assert.ok(calls.some(row => row.includes('wrangler')));
    assert.equal((await readLedger(config.cacheRoot)).web.commit, commit);
});

test('APK and runtime delivery carries desktop assets, updates the daemon after idle and never touches the PC app',
    { timeout: 10000 }, async t => {
    const directory = await temporary(t);
    const key = join(directory, 'approved.keystore'), init = join(directory, 'signing.gradle'), previous = join(directory, 'previous.apk');
    await writeFile(key, 'fixture'); await writeFile(init, `storeFile = file("${key}")`); await writeFile(previous, 'old');
    const updaterRoot = join(directory, 'updater');
    await mkdir(updaterRoot);
    const config = validateReleaseConfig({
        workspace: join(directory, 'workspace'), cacheRoot: join(directory, 'cache'), signingInit: init, signingKey: key,
        previousApk: previous, androidTools: '/sdk/tools', metroWorkers: 2, appTests: ['src/fixture.test.ts'],
        repo: 'moveju112/paseodog', pagesProject: 'paseodog', webUrl: 'https://paseodog.choondoggy.com/',
        targets: ['android', 'runtime'], updaterRoot, updaterUnit: 'paseodog-update.service',
    });
    const commit = 'f'.repeat(40), carried = 'v1.0.0-rc.7.11090';
    const calls = [];
    let assets = [], active = [{ status: 'running' }];
    const run = async (command, args) => {
        calls.push([command, ...args]);
        if (command === 'git' && args[0] === 'rev-parse') return commit + '\n';
        if (command === 'git' && args[0] === 'ls-remote') return commit + '\trefs/heads/main\n';
        if (command === 'gh' && args[1] === 'view' && args[2] === '--repo') return JSON.stringify({ tagName: carried, assets: [] });
        if (command === 'gh' && args[1] === 'view' && args[2] === carried) return JSON.stringify({ targetCommitish: 'a'.repeat(40) });
        if (command === 'gh' && args[1] === 'view') return JSON.stringify({ targetCommitish: commit,
            assets: assets.map(path => ({ name: path.split('/').at(-1), size: 7 })) });
        if (command === 'gh' && args[1] === 'download') {
            const output = args[args.indexOf('--dir') + 1];
            for (const name of args.filter((_, index) => args[index - 1] === '--pattern'))
                await writeFile(join(output, name), name.endsWith('.yml') ? 'version: 1.0.0-rc.7.11090\n'
                    : JSON.stringify({ versionCode: 11090, versionName: '1.0.0-rc.7.11090' }));
        }
        if (command === 'python3') await writeFile(join(config.workspace, 'paseodog-android-update.json'), '{}');
        if (args.includes('ls') && args.includes('--json')) {
            const rows = active; active = [];
            return JSON.stringify(rows);
        }
        if (command === 'systemctl') {
            assert.deepEqual(active, [], 'daemon update must wait for idle');
            // 업데이터는 전환 직후 종료하고, 검증 서비스가 잠시 뒤 applied로 바꾼다.
            await writeFile(join(updaterRoot, 'receipt.json'), JSON.stringify({ phase: 'awaiting-verification', revision: commit }));
            setTimeout(() => void writeFile(join(updaterRoot, 'receipt.json'), JSON.stringify({ phase: 'applied', revision: commit })), 20);
        }
        if (args.includes('diagnostic')) return '{"diagnostic":"Provider is available"}';
        return '';
    };
    const plans = [];
    await deliverRelease(config, {
        run, build: async ({ targets }) => { calls.push(['build', targets]); },
        verifyArtifacts: async (_config, _run, plan) => {
            plans.push(plan);
            assets = [];
            for (const name of ['package.apk', 'carry/latest-linux.yml']) {
                const path = join(config.workspace, name); await writeFile(path, 'fixture'); assets.push(path);
            }
            return assets;
        },
        checkWeb: async () => { throw new Error('web must not deploy'); },
        launchDesktop: async () => { throw new Error('desktop must not launch'); },
        installedRelease: async () => { throw new Error('desktop must not be read'); },
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 10))),
    });
    const download = calls.find(row => row[0] === 'gh' && row[2] === 'download' && row.includes(join(config.workspace, 'carry')));
    assert.ok(download.includes('PaseoDog-1.0.0-rc.7.11090-amd64.deb') && download.includes('latest.yml'));
    assert.deepEqual(plans[0].carry.desktop, { version: '1.0.0-rc.7.11090' });
    assert.equal(calls.filter(row => row[0] === 'gh' && ['create', 'upload', 'edit'].includes(row[2])).length, 3);
    assert.equal(calls.some(row => row[0] === 'sudo' || row.includes('wrangler')), false);
    // 검증을 마친 리비전을 업데이터에 알려 root 테스트를 중복 실행하지 않게 한다.
    assert.equal(JSON.parse(await readFile(join(updaterRoot, 'preverified.json'), 'utf8')).revision, commit);
    const updateAt = calls.findIndex(row => row[0] === 'systemctl');
    assert.ok(updateAt > 0);
    // 업데이터가 플러그인과 사후 검증을 맡으므로 배포가 다시 로드하지 않는다.
    assert.equal(calls.some(row => row.includes('reload')), false);
    assert.ok(calls.findIndex(row => row.includes('diagnostic')) > updateAt);
});

// 업데이터는 런타임 변경이 없는 커밋을 재시작 없이 넘기고, 판정 실패는 런타임 변경으로 본다.
test('runtime change detection skips metadata and app-native commits and fails safe', async t => {
    assert.deepEqual(runtimeChanges(['plugin/shared/release.json', 'CHANGELOG.md', 'MANIFEST.sha256']),
        { runtime: false, paths: [], releaseMetadata: true });
    assert.equal(runtimeChanges(['scripts/release-pipeline.mjs', 'docs/a.md', 'android/packages/app/android/x.gradle']).runtime, false);
    assert.equal(runtimeChanges(['patches/paseo-usage-donut.mjs']).runtime, true);
    assert.equal(runtimeChanges(['android/packages/app/src/screens/settings/basic-agent-roles.ts']).runtime, true);
    const repo = await temporary(t);
    const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8' }).trim();
    git('init', '-q');
    await mkdir(join(repo, 'docs')); await writeFile(join(repo, 'docs/a.md'), 'one');
    git('add', '.'); git('commit', '-qm', 'one');
    const from = git('rev-parse', 'HEAD');
    await writeFile(join(repo, 'docs/a.md'), 'two'); await mkdir(join(repo, 'plugin/shared'), { recursive: true });
    await writeFile(join(repo, 'plugin/shared/release.json'), '{}');
    git('add', '.'); git('commit', '-qm', 'two');
    const to = git('rev-parse', 'HEAD');
    const cli = (...args) => JSON.parse(execFileSync(process.execPath, [join(root, 'scripts/runtime-changes.mjs'), ...args], { encoding: 'utf8' }));
    assert.deepEqual(cli('--repo', repo, '--from', from, '--to', to), { runtime: false, paths: [], releaseMetadata: true });
    for (const args of [['--repo', repo, '--from', 'bad', '--to', to], ['--repo', repo, '--from', to, '--to', 'f'.repeat(40)]])
        assert.equal(cli(...args).runtime, true);
});

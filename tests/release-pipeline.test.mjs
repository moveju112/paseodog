import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { openReleaseState, insideWorkspace } from '../scripts/release-state.mjs';
import { validateReleaseConfig, activeAgents, detachedCommand, waitForIdle, deliverRelease, unlockStoppedDelivery } from '../scripts/release-pipeline.mjs';
import { verifiedBuildCache } from '../scripts/verified-build-cache.mjs';
import { measureBuildStep } from '../scripts/build-metrics.mjs';
import { verifyRemoteAssets, verifyUpdaterManifest } from '../scripts/release-artifacts.mjs';
import { desktopRootPids } from '../scripts/release-apply.mjs';
import { verifyReleaseWeb } from '../scripts/release-web-check.mjs';
import { buildWeb } from '../scripts/build-web.mjs';
import { verifyReleaseSource, sourceFingerprint } from '../scripts/release-verification.mjs';
import { root } from '../scripts/paths.mjs';
import { withTestLock } from '../scripts/test.mjs';

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

test('integrated delivery verifies before publishing and resumes without replaying mutations', async t => {
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
        if (command === 'systemd-run' && args.includes('expo')) {
            const output = args[args.indexOf('--output-dir') + 1];
            const { mkdir } = await import('node:fs/promises');
            await mkdir(output); await writeFile(join(output, 'index.html'), 'fixture');
        }
        if (args.includes('ls') && args.includes('--json')) return '[]';
        if (command === 'dpkg-query') return config.version.replace('-', '~');
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
    await deliverRelease(config, operations);
    const firstCount = calls.filter(row => row[0] === 'gh' && ['create', 'upload', 'edit'].includes(row[2])).length;
    assert.equal(firstCount, 3);
    const verifyAt = calls.findIndex(row => row[0] === 'verify-artifacts');
    const publishAt = calls.findIndex(row => row[0] === 'gh' && row[2] === 'edit');
    const browserAt = calls.findIndex(row => row[0] === 'check-browser');
    const reloadAt = calls.findIndex(row => row.includes('reload'));
    assert.ok(verifyAt < publishAt && publishAt < browserAt && browserAt < reloadAt);
    await deliverRelease(config, operations);
    assert.equal(calls.filter(row => row[0] === 'gh' && ['create', 'upload', 'edit'].includes(row[2])).length, 3);
    assert.equal(calls.filter(row => row[0] === 'desktop').length, 1);
    assert.equal(calls.filter(row => row[0] === 'build').length, 1);
});

test('delivery defaults are explicit targets and detached execution is a service, not a caller-owned scope', () => {
    const input = {
        workspace: '/data/tmp/ubuntu/paseodog-release-example', cacheRoot: '/data/tmp/ubuntu/cache',
        signingInit: '/approved/init.gradle', signingKey: '/approved/key', previousApk: '/approved/previous.apk',
        androidTools: '/sdk/tools', metroWorkers: 2, appTests: ['src/settings.test.ts'],
        repo: 'moveju112/paseodog', pagesProject: 'paseodog', webUrl: 'https://paseodog.choondoggy.com/',
    };
    assert.equal(validateReleaseConfig(input).metroWorkers, '2');
    for (const patch of [{ workspace: '/' }, { workspace: input.cacheRoot, cacheRoot: input.cacheRoot },
        { appTests: ['../../private'] }, { repo: 'another/repo' }])
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
    const script = `document.body.innerHTML='<button data-testid="welcome-direct-connection">Connect</button>';
document.querySelector('button').onclick=()=>{document.body.innerHTML='<input data-testid="direct-host-input"><input data-testid="direct-port-input"><input type="password" data-testid="direct-password-input"><button data-testid="direct-password-visibility-toggle">Show</button>';
document.querySelector('button').onclick=()=>{const p=document.querySelector('[data-testid="direct-password-input"]');if(p.type==='password')p.removeAttribute('type');else p.type='password'};};`;
    const server = createServer((request, response) => {
        response.setHeader('Content-Type', request.url === '/index-fixture.js' ? 'application/javascript' : 'text/html');
        response.end(request.url === '/index-fixture.js' ? script : html);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    await verifyReleaseWeb({ url: `http://127.0.0.1:${server.address().port}/`, output });
});

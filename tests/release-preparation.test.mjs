import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { prepareRelease } from '../scripts/release-prepare.mjs';
import { releasePreflight } from '../scripts/release-preflight.mjs';
import { runCommand } from '../scripts/release-command.mjs';

async function fixture(t) {
    const directory = await mkdtemp('/data/tmp/ubuntu/paseodog-prepare-test-');
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProcessScope } from '../plugin/server/process-scope.mjs';
import { createWindowsJobScope, ensureWindowsJobHelper, windowsCompilerPath, windowsJobHelperPath } from '../plugin/server/windows-job.mjs';
import { engineInstallSteps, installSteps, launcherScript } from '../scripts/install.mjs';

const launchFor = (stateDir) => ({ command: 'C:\\Program Files\\nodejs\\node.exe', args: ['C:\\pd\\engine.mjs'],
    env: { PASEODOG_STATE_DIR: stateDir } });

// 임시 상태 디렉터리에서 테스트 본문 실행 후 정리
function withStateDir(body) {
    return async () => {
        const dir = mkdtempSync(join(tmpdir(), 'paseodog-winjob-'));
        try { await body(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
    };
}

test('Windows strict scope runs the engine under the kill-on-close job helper', withStateDir((dir) => {
    const scope = createProcessScope({ launch: launchFor(dir), platform: 'win32' });
    assert.equal(scope.kind, 'windows-job');
    assert.equal(scope.command, windowsJobHelperPath(dir));
    assert.deepEqual(scope.args, ['C:\\Program Files\\nodejs\\node.exe', 'C:\\pd\\engine.mjs', '--stdio']);
    assert.equal(scope.detached, false);
    assert.equal(scope.stop, null);
    const testOnly = createProcessScope({ launch: launchFor(dir), platform: 'win32', mode: 'test-only-process-group' });
    assert.equal(testOnly.kind, 'process-group');
}));

test('Windows job scope fails closed without a dedicated state directory', () => {
    assert.throws(() => createProcessScope({ launch: { command: 'node.exe', env: {} }, platform: 'win32' }),
        /PASEODOG_STATE_DIR/);
});

test('Windows job scope preflight builds the helper before any spawn', withStateDir(async (dir) => {
    const runCommand = async () => {};
    let seen;
    const scope = createWindowsJobScope({ launch: launchFor(dir), runCommand, ensureHelper: async (options) => { seen = options; } });
    await scope.preflight();
    assert.equal(seen.stateDir, dir);
    assert.equal(seen.runCommand, runCommand);
}));

test('job helper is compiled once from a temporary source and moved atomically', withStateDir(async (dir) => {
    const env = { SystemRoot: 'C:\\Windows' };
    const calls = [];
    const runCommand = async (command, args) => {
        calls.push({ command, args });
        const source = args.at(-1);
        assert.ok(existsSync(source), 'source must exist while compiling');
        writeFileSync(args.find((arg) => arg.startsWith('/out:')).slice(5), 'MZ');
    };
    const helper = await ensureWindowsJobHelper({ stateDir: dir, runCommand, env });
    assert.equal(helper, windowsJobHelperPath(dir));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, windowsCompilerPath(env));
    assert.ok(calls[0].args.includes('/target:exe'));
    assert.deepEqual(readdirSync(dirname(helper)), [helper.split(/[\\/]/).at(-1)]);
    await ensureWindowsJobHelper({ stateDir: dir, runCommand, env });
    assert.equal(calls.length, 1, 'existing helper is reused');
}));

test('job helper build failure surfaces compiler output and leaves no partial files', withStateDir(async (dir) => {
    const runCommand = async () => { throw Object.assign(new Error('Command failed'), { stdout: 'Job.cs(1,1): error CS1002' }); };
    await assert.rejects(ensureWindowsJobHelper({ stateDir: dir, runCommand, env: { SystemRoot: 'C:\\Windows' } }),
        /Windows job helper: .*CS1002/s);
    assert.equal(existsSync(windowsJobHelperPath(dir)), false);
    assert.deepEqual(readdirSync(dirname(windowsJobHelperPath(dir))), []);
}));

test('install steps keep the patch order and skip only POSIX root tests on Windows', () => {
    const linux = installSteps('linux').map(({ args }) => args.join(' '));
    const windows = installSteps('win32').map(({ args }) => args.join(' '));
    const engine = engineInstallSteps().map(({ args }) => args.join(' '));
    assert.deepEqual(linux.slice(0, engine.length + 2), ['--prefix tools ci', ...engine, '--prefix plugin ci']);
    assert.deepEqual(linux.slice(engine.length + 2, engine.length + 4), ['scripts/patch-mixdog.mjs', 'scripts/patch-mixdog.mjs --check']);
    assert.deepEqual(linux.slice(-5), ['scripts/patch-paseo-composer.mjs --check', 'run check', 'test', 'run typecheck',
        'scripts/configure.mjs --trust-plugins']);
    assert.deepEqual(windows, linux.filter((step) => step !== 'test'));
});

test('engine installation completes every pinned child hook before the pruning hook', () => {
    const steps = engineInstallSteps();
    assert.deepEqual(steps[0], { command: 'npm',
        args: ['--prefix', 'engine', 'ci', '--install-strategy=nested', '--ignore-scripts'] });
    const lock = JSON.parse(readFileSync(new URL('../engine/package-lock.json', import.meta.url)));
    const required = Object.entries(lock.packages).filter(([, pkg]) => pkg.hasInstallScript).map(([path]) => path);
    const hooks = steps.slice(1).map(({ command, args }) => {
        assert.equal(command, 'npm');
        assert.deepEqual(args.slice(2), ['run', 'postinstall']);
        return args[1].slice('engine/'.length);
    });
    assert.deepEqual([...hooks].sort(), required.sort());
    assert.equal(hooks.at(-1), 'node_modules/mixdog');
    for (const path of hooks.slice(0, -1)) assert.ok(path.startsWith('node_modules/mixdog/node_modules/'));
});

test('launchers preserve paths with spaces and special characters', () => {
    assert.equal(launcherScript('win32', 'C:\\Program Files\\nodejs\\node.exe', 'C:\\100% pd\\bin\\paseodog.mjs'),
        '@echo off\r\n"C:\\Program Files\\nodejs\\node.exe" "C:\\100%% pd\\bin\\paseodog.mjs" %*\r\n');
    assert.equal(launcherScript('linux', '/usr/bin/node', "/home/a b/it's/bin/paseodog.mjs"),
        "#!/bin/sh\nexec '/usr/bin/node' '/home/a b/it'\\''s/bin/paseodog.mjs' \"$@\"\n");
});

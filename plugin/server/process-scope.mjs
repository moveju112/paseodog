import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createWindowsJobScope } from './windows-job.mjs';

const execFileAsync = promisify(execFile);
const NOT_LOADED = /(?:not loaded|not found|could not be found|does not exist)/i;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function commandError(error) {
    return `${error?.stderr || ''}\n${error?.message || error || ''}`;
}

/**
 * A process group is NOT sufficient on Linux: Mixdog's native shell helper
 * calls setpgid and escapes its parent's group. Each real session therefore
 * runs in a dedicated systemd *user scope* (one cgroup, independent of PGIDs).
 * On Windows each session runs under a kill-on-close Job Object helper
 * (windows-job.mjs). The explicit legacy group mode below is reserved for
 * tests and platforms without either; production never selects it on Linux
 * or Windows.
 */
export function createProcessScope({ launch, platform = process.platform, mode = 'strict',
    runCommand = (cmd, args, opts) => execFileAsync(cmd, args, opts),
    readCgroupEvents = (path) => readFile(path, 'utf8'),
    now = () => Date.now(), sleep = delay, unitName = `paseodog-${randomUUID().replaceAll('-', '')}.scope`,
    verifyMs = 4000 } = {}) {
    if (!launch?.command) throw new Error('Missing engine launch command');
    if (platform === 'win32' && mode === 'strict') return createWindowsJobScope({ launch, runCommand });
    if (platform !== 'linux' || mode === 'test-only-process-group') {
        if (platform === 'linux' && mode !== 'test-only-process-group') throw new Error('Invalid process scope mode');
        return {
            kind: 'process-group', unit: null,
            command: launch.command, args: [...(launch.args || []), '--stdio'],
            detached: platform !== 'win32',
            async preflight() {},
            stop: null,
        };
    }
    if (mode !== 'strict') throw new Error('Unsupported Linux process scope mode');
    if (!/^paseodog-[0-9a-f]{32}\.scope$/.test(unitName)) throw new Error('Invalid private process scope unit');
    const env = launch.env || process.env;
    const options = { env, timeout: 4500, maxBuffer: 64 * 1024, windowsHide: true };
    const control = (args) => runCommand('/usr/bin/systemctl', ['--user', ...args], options);
    let hasRequestedStop = false;

    async function showControlGroup() {
        try {
            const { stdout } = await control(['show', '--property=ControlGroup', '--value', unitName]);
            const value = String(stdout || '').trim();
            if (!value) return null;
            if (!/^\/[a-zA-Z0-9_./@-]+$/.test(value) || value.split('/').includes('..'))
                throw new Error('Unexpected systemd cgroup path');
            return join('/sys/fs/cgroup', value);
        } catch (error) {
            if (hasRequestedStop && NOT_LOADED.test(commandError(error))) return null;
            throw new Error(`Unable to verify PaseoDog process scope: ${commandError(error).slice(0, 600)}`);
        }
    }
    async function waitForEmptyScope() {
        const end = now() + verifyMs;
        for (;;) {
            const group = await showControlGroup();
            if (!group) return;
            try {
                const events = await readCgroupEvents(join(group, 'cgroup.events'));
                if (/^populated\s+0$/m.test(events)) return;
                if (!/^populated\s+1$/m.test(events)) throw new Error('Unexpected cgroup.events payload');
            } catch (error) {
                if (error?.code === 'ENOENT') return; // systemd unloaded an empty scope
                throw error;
            }
            if (now() >= end) throw new Error(`PaseoDog process scope ${unitName} still contains processes after forced stop`);
            await sleep(100);
        }
    }
    return {
        kind: 'systemd-user-cgroup', unit: unitName, detached: false,
        command: '/usr/bin/systemd-run',
        args: ['--user', '--scope', '--collect', '--quiet', `--unit=${unitName}`,
            '--property=KillMode=control-group', '--', launch.command, ...(launch.args || []), '--stdio'],
        async preflight() {
            try { await control(['show-environment']); }
            catch (error) {
                throw new Error('A running systemd --user manager is required to isolate Mixdog shell tasks. '
                    + 'Connect via a systemd-backed SSH session or configure user lingering. '
                    + commandError(error).slice(0, 450));
            }
        },
        async stop() {
            // A stop job owns the complete cgroup, including shells that moved
            // into separate process groups. A process-only signal is unsafe.
            try { await control(['stop', '--no-block', unitName]); }
            catch (error) { if (!NOT_LOADED.test(commandError(error))) throw error; }
            hasRequestedStop = true;
            try { await control(['kill', '--kill-whom=all', '--signal=SIGKILL', unitName]); }
            catch (error) { if (!NOT_LOADED.test(commandError(error))) throw error; }
            await waitForEmptyScope();
        },
    };
}

import { readFile, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand } from './release-command.mjs';
import { root, paseoHome, mixdogHome } from './paths.mjs';

export function desktopRootPids(text) {
    return text.split('\n').flatMap(line => {
        const match = /^\s*(\d+)\s+(\S+)(.*)$/.exec(line);
        return match && match[2] === '/opt/PaseoDog/PaseoDog.bin' && !match[3].includes('--type=')
            ? [Number(match[1])] : [];
    });
}

export async function verifyDesktopLaunch({ version, versionCode, workspace }, run = runCommand,
    { sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 30 } = {}) {
    for (let attempt = 0; attempt < attempts; attempt++) {
        const status = await run('systemctl', ['--user', 'show', `paseodog-desktop-${versionCode}.service`,
            '-p', 'ActiveState', '-p', 'MainPID'], { capture: true });
        const fields = Object.fromEntries(status.trim().split('\n').map(line => line.split('=')));
        if (fields.ActiveState === 'failed' || fields.ActiveState === 'inactive')
            throw new Error('Desktop service exited before application startup');
        if (Number(fields.MainPID) > 0) {
            const executable = await readlink(`/proc/${fields.MainPID}/exe`);
            const log = await readFile(join(workspace, 'desktop.log'), 'utf8').catch(error => {
                if (error.code === 'ENOENT') return '';
                throw error;
            });
            // Electron의 login-shell 환경 병합은 /proc 환경을 바꿀 수 있다. 실행 파일과 실제 연결 로그로 확인한다.
            if (executable === '/opt/PaseoDog/PaseoDog.bin' && log.includes(`version: '${version}'`)
                && log.includes('[desktop daemon] initial status check before start') && log.includes("error: null"))
                return;
        }
        await sleep(1000);
    }
    throw new Error('Desktop launch confirmation timed out; inspect desktop.log');
}

export async function restartDesktop(config, run = runCommand) {
    const command = [join(root, 'bin/paseodog.mjs')];
    const status = await run(process.execPath, [...command, 'daemon', 'status'], { capture: true });
    if (!status.includes(`home: ${paseoHome}`) || !status.includes('desktopManaged: false'))
        throw new Error('Desktop may own a daemon; refusing an unverified service interruption');
    const roots = desktopRootPids(await run('ps', ['-eo', 'pid=,args='], { capture: true }));
    for (const pid of roots) {
        if (!['/opt/PaseoDog/PaseoDog.bin', '/opt/PaseoDog/PaseoDog.bin (deleted)']
            .includes(await readlink(`/proc/${pid}/exe`)))
            throw new Error('Desktop PID identity changed');
        process.kill(pid, 'SIGTERM');
    }
    for (let attempt = 0; attempt < 30; attempt++) {
        if (!desktopRootPids(await run('ps', ['-eo', 'pid=,args='], { capture: true })).length) break;
        if (attempt === 29) throw new Error('Desktop did not exit gracefully; no force kill performed');
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    await run('systemd-run', ['--user', `--unit=paseodog-desktop-${config.versionCode}`, '--collect',
        `--setenv=PASEO_HOME=${paseoHome}`, `--setenv=MIXDOG_HOME=${mixdogHome}`,
        ...['DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY'].filter(key => process.env[key])
            .map(key => `--setenv=${key}=${process.env[key]}`),
        '-p', `StandardOutput=append:${join(config.workspace, 'desktop.log')}`,
        '-p', `StandardError=append:${join(config.workspace, 'desktop.log')}`, '/opt/PaseoDog/PaseoDog']);
    await verifyDesktopLaunch(config, run);
}

import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { configure } from './configure.mjs';
import { paseoHome, mixdogHome, journalRoot, worker } from './paths.mjs';
import { ensureWindowsJobHelper } from '../plugin/server/windows-job.mjs';

// 데스크톱에서 확인한 신뢰를 받아 전용 프로필과 Electron 엔진 실행 환경을 준비한다.
export async function configureDesktopProfile({ trustPlugins = false } = {}) {
    configure({
        home: paseoHome, nativeHome: mixdogHome, stateDir: journalRoot, enginePath: worker,
        trustPlugins, engineEnv: { ELECTRON_RUN_AS_NODE: '1' }, defaultListen: '127.0.0.1:6768',
    });
    if (process.platform === 'win32')
        await ensureWindowsJobHelper({ stateDir: journalRoot, runCommand: promisify(execFile) });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { await configureDesktopProfile({ trustPlugins: process.argv.includes('--trust-plugins') }); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}

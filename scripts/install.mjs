import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { root, journalRoot, launcherPath, supportedNode, serverWebDist } from './paths.mjs';
import { ensureWindowsJobHelper, windowsCompilerPath } from '../plugin/server/windows-job.mjs';

// Upstream patches applied then verified at install, in this order.
const PATCHES = ['mixdog', 'paseo-usage', 'paseo-steer', 'paseo-agent-messages', 'paseo-assistant-phase',
    'paseo-workspace-name', 'paseo-session-titles', 'paseo-local-stt', 'paseo-relay-password'];

// Mixdog의 정리 훅이 하위 설치 파일을 지우므로 고정된 하위 훅부터 순서대로 완료한다.
export function engineInstallSteps() {
    const packages = [
        'engine/node_modules/mixdog/node_modules/@huggingface/transformers/node_modules/onnxruntime-web/node_modules/protobufjs',
        'engine/node_modules/mixdog/node_modules/onnxruntime-node',
        'engine/node_modules/mixdog/node_modules/tesseract.js',
        'engine/node_modules/mixdog',
    ];
    return [
        { command: 'npm', args: ['--prefix', 'engine', 'ci', '--install-strategy=nested', '--ignore-scripts'] },
        ...packages.map(path => ({ command: 'npm', args: ['--prefix', path, 'run', 'postinstall'] })),
    ];
}

// 설치 단계 목록 (잠금 파일 의존성 -> 패치 적용·검증 -> 검사 -> 프로필 설정)
export function installSteps(platform = process.platform) {
    const node = (...args) => ({ command: process.execPath, args });
    const npm = (...args) => ({ command: 'npm', args });
    return [
        npm('--prefix', 'tools', 'ci'),
        ...engineInstallSteps(),
        npm('--prefix', 'plugin', 'ci'),
        ...PATCHES.flatMap((name) => [node(`scripts/patch-${name}.mjs`), node(`scripts/patch-${name}.mjs`, '--check')]),
        // 잠긴 공유 UI 의존성을 설치한 뒤 브라우저용으로 export한다. npm 서버 번들은 수정하지 않는다.
        npm('--prefix', 'android', 'ci'),
        node('scripts/build-web.mjs', '--hosting', 'server', '--output', serverWebDist, '--metro-workers', '1'),
        npm('run', 'check'),
        // Root tests assume POSIX tooling (bash, python3, mode bits, symlinks).
        ...(platform === 'win32' ? [] : [npm('test')]),
        npm('run', 'typecheck'),
        node('scripts/configure.mjs', '--trust-plugins'),
    ];
}

// 런처 내용 (Node 절대 경로 + 진입 파일, 공백·특수 문자 경로 보존)
export function launcherScript(platform = process.platform, nodePath = process.execPath,
    entry = join(root, 'bin', 'paseodog.mjs')) {
    if (platform === 'win32') {
        const quote = (value) => `"${value.replaceAll('%', '%%')}"`;
        return `@echo off\r\n${quote(nodePath)} ${quote(entry)} %*\r\n`;
    }
    const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
    return '#!/bin/sh\nexec ' + quote(nodePath) + ' ' + quote(entry) + ' "$@"\n';
}

// 단계 하나 실행, 실패 시 설치 중단 (Windows npm은 .cmd라 셸 경유)
function run({ command, args }) {
    const result = process.platform === 'win32' && command === 'npm'
        ? spawnSync([command, ...args].join(' '), { cwd: root, stdio: 'inherit', shell: true })
        : spawnSync(command, args, { cwd: root, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        const name = command === process.execPath ? 'node' : command;
        throw new Error(`Install step failed (${result.status ?? result.signal}): ${[name, ...args].join(' ')}`);
    }
}

// 사전 확인 -> 신뢰 확인 -> 의존성·패치·검사·설정 -> 격리 헬퍼 -> 런처 -> 데몬 시작·플러그인 등록
async function install(argv) {
    if (process.getuid?.() === 0) throw new Error('Install as your dedicated non-root development user, not root.');
    if (!supportedNode()) throw new Error('Node 22.19+ (22.x) or 24+ required');
    for (const tool of ['npm', 'git']) {
        const probe = spawnSync(`${tool} --version`, { stdio: 'ignore', shell: true });
        if (probe.status !== 0) throw new Error(`${tool} is required`);
    }
    if (process.platform === 'linux'
        && spawnSync('systemctl', ['--user', 'show-environment'], { stdio: 'ignore' }).status !== 0)
        throw new Error('PaseoDog requires a running systemd --user manager for safe per-session cgroups.\n'
            + 'Use a normal systemd-backed SSH login or configure user lingering before installation.');
    if (process.platform === 'win32' && !existsSync(windowsCompilerPath()))
        throw new Error(`PaseoDog needs .NET Framework 4.x (${windowsCompilerPath()}) to build its per-session job helper.`);
    console.log('This installs third-party npm code and enables an UNSANDBOXED Paseo provider.');
    console.log("Agents/MCP servers run with this user's access. Use disposable repos first.");
    if (!argv.includes('--trust-plugins')) {
        const prompt = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await prompt.question('Type TRUST to continue: ');
        prompt.close();
        if (answer.trim() !== 'TRUST') {
            console.log('Canceled; no dependencies/config changed.');
            process.exitCode = 1;
            return;
        }
    }
    // Reviewed lockfiles are part of the release: install must never resolve new dependency versions.
    for (const name of ['tools', 'engine', 'plugin', 'android'])
        if (!existsSync(join(root, name, 'package-lock.json')))
            throw new Error(`Missing ${name}/package-lock.json; use a complete release checkout`);
    if (process.platform === 'win32') console.log('Skipping root tests on Windows (they require POSIX tooling).');
    for (const step of installSteps()) run(step);
    if (process.platform === 'win32')
        await ensureWindowsJobHelper({ stateDir: journalRoot, runCommand: promisify(execFile) });
    // Use a launcher rather than symlinking the source: spaces in paths remain valid.
    mkdirSync(dirname(launcherPath), { recursive: true });
    writeFileSync(launcherPath, launcherScript(), { mode: 0o755 });
    const cli = (...args) => ({ command: process.execPath, args: ['bin/paseodog.mjs', ...args] });
    run(cli('start'));
    run(cli('plugin', 'install', join(root, 'plugin')));
    run(cli('reload'));
    console.log(`\nInstalled. Next:\n  ${launcherPath} auth\n  ${launcherPath} password\n  ${launcherPath} doctor`);
    if (process.platform === 'win32') console.log(`Add ${dirname(launcherPath)} to your user PATH to run "paseodog" directly.`);
    console.log('Keep this project folder at its installed absolute path. See docs/ai-rules/RUNTIME_DAEMON.md for daemon and service setup.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { await install(process.argv.slice(2)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}

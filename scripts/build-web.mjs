import { spawn } from 'node:child_process';
import { copyFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const androidRoot = fileURLToPath(new URL('../android/', import.meta.url));
const appRoot = resolve(androidRoot, 'packages/app');

function runCommand(command, args, options) {
    return new Promise((resolveRun, reject) => {
        const child = spawn(command, args, { ...options, stdio: 'inherit' });
        child.on('error', reject);
        child.on('close', (code, signal) => {
            if (code === 0) resolveRun();
            else reject(new Error(`Web build failed: ${command} (${signal ?? code})`));
        });
    });
}

// 전용 웹은 공유 앱을 일반 web 대상으로 내보내며 Electron 번들과 산출물을 공유하지 않는다.
export async function buildWeb({ output, metroWorkers = '2', hosting = 'github', dependenciesBuilt = false }, run = runCommand) {
    if (!output || !isAbsolute(output)) throw new Error('output must be an absolute path');
    if (!/^[1-9]\d*$/.test(metroWorkers)) throw new Error('metro-workers must be a positive integer');
    if (!['github', 'cloudflare'].includes(hosting)) throw new Error('hosting must be github or cloudflare');
    const env = { ...process.env, CI: '1', APP_VARIANT: 'production',
        PASEO_WEB_PLATFORM: '', PASEODOG_WEB_BASE_PATH: hosting === 'github' ? '/paseodog' : '' };
    // 통합 릴리즈는 같은 커밋의 검증된 공통 빌드 뒤에만 이 경로를 사용한다.
    if (!dependenciesBuilt) await run('npm', ['run', 'build:app-deps'], { cwd: androidRoot, env });
    await run('npx', ['expo', 'export', '--platform', 'web', '--output-dir', output,
        '--max-workers', metroWorkers], { cwd: appRoot, env });
    // Cloudflare는 최상위 404.html이 없을 때 SPA fallback을 제공한다.
    if (hosting === 'github') {
        await copyFile(resolve(output, 'index.html'), resolve(output, '404.html'));
        await writeFile(resolve(output, '.nojekyll'), '');
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const { values } = parseArgs({ options: {
            output: { type: 'string' }, 'metro-workers': { type: 'string' }, hosting: { type: 'string' },
        } });
        await buildWeb({ output: values.output, metroWorkers: values['metro-workers'], hosting: values.hosting });
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}

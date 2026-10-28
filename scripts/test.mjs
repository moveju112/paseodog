import { readdir, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runTestFiles } from './test-files.mjs';
import { sourceFingerprint } from './release-verification.mjs';
import { scratchPath } from './paths.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

// 전체 테스트 목록과 프로세스 격리를 유지하며 공유 소스 회귀 검사를 실행한다.
export async function withTestLock(run, identity = 'paseodog-heavy-tests') {
    // 릴리즈 호스트의 flock만 사용한다. Windows/macOS의 기존 로컬 테스트 실행은 막지 않는다.
    if (process.platform !== 'linux') {
        console.log('Test harness: OS serialization is enabled on the Linux release host only');
        return run();
    }
    const id = createHash('sha256').update(identity).digest('hex').slice(0, 16);
    const lock = await open(scratchPath(`paseodog-test-${id}.lock`), 'a', 0o600);
    const waiting = performance.now();
    try {
        console.log('Test harness: waiting for repository test slot');
        // flock은 상속한 열린 파일 설명에 잠금을 붙인다. 부모의 fd가 닫히면 자동 해제된다.
        await new Promise((resolveLock, reject) => {
            const child = spawn('flock', ['--exclusive', '3'], { stdio: ['ignore', 'inherit', 'inherit', lock.fd] });
            child.on('error', reject);
            child.on('close', code => code === 0 ? resolveLock() : reject(new Error(`Test lock failed: ${code}`)));
        });
        console.log(`Test harness: queueMs=${Math.round(performance.now() - waiting)}`);
        const started = performance.now();
        try { return await run(); }
        finally { console.log(`Test harness: executionMs=${Math.round(performance.now() - started)}`); }
    } finally { await lock.close(); }
}

export async function runTests(args = [], selectedFiles) {
    {
        const files = selectedFiles ?? (await readdir(join(root, 'tests'))).filter(name => name.endsWith('.test.mjs'))
            .sort().map(name => join(root, 'tests', name));
        const execute = async file => {
            return new Promise((resolveRun, reject) => {
            const child = spawn(process.execPath, ['--test', ...args, file], {
                cwd: root, stdio: 'inherit', env: { ...process.env,
                    PASEODOG_TEST_COMPOSER_FIXTURE: '' },
            });
            child.on('error', reject);
            child.on('close', (code, signal) => signal ? reject(new Error(`Tests interrupted: ${signal}`)) : resolveRun(code));
            });
        };
        const expected = process.env.PASEODOG_TEST_SOURCE;
        return await runTestFiles(files, execute, {
            cache: process.env.PASEODOG_TEST_CACHE,
            identity: { input: process.env.PASEODOG_TEST_INPUT, node: process.version, args },
            validate: async () => !expected || await sourceFingerprint() === expected,
        });
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const { values } = parseArgs({ options: {
            files: { type: 'string' }, 'test-name-pattern': { type: 'string' },
        } });
        const files = values.files?.split(',');
        if (files?.some(path => !/^tests\/[\w-]+\.test\.mjs$/.test(path)))
            throw new Error('--files accepts comma-separated tests/*.test.mjs paths');
        const args = values['test-name-pattern'] ? [`--test-name-pattern=${values['test-name-pattern']}`] : [];
        process.exitCode = await withTestLock(() => runTests(args, files));
    }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}

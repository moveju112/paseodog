import { mkdtemp, readFile, readdir, rm, writeFile, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { COMPOSER_FILE, patchedComposerSource } from './patch-paseo-composer.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

export async function prepareComposerFixture(directory) {
    const source = await readFile(join(root, 'tools/node_modules/@getpaseo/server', COMPOSER_FILE), 'utf8');
    const patched = patchedComposerSource(source);
    if (patchedComposerSource(patched) !== patched) throw new Error('Composer patch is not idempotent');
    const digest = text => createHash('sha256').update(text).digest('hex');
    await writeFile(join(directory, 'patched.js'), patched);
    await writeFile(join(directory, 'receipt.json'), JSON.stringify({ input: digest(source), output: digest(patched) }));
}

// 전체 테스트 목록은 유지한다. 공통 대형 번들 생성만 한 번 하고 각 파일은 기존 격리 프로세스로 실행한다.
export async function withTestLock(run, identity = root) {
    // 릴리즈 호스트의 flock만 사용한다. Windows/macOS의 기존 로컬 테스트 실행은 막지 않는다.
    if (process.platform !== 'linux') {
        console.log('Test harness: OS serialization is enabled on the Linux release host only');
        return run();
    }
    const id = createHash('sha256').update(identity).digest('hex').slice(0, 16);
    const lock = await open(`/data/tmp/ubuntu/paseodog-test-${id}.lock`, 'a', 0o600);
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
    const directory = await mkdtemp('/data/tmp/ubuntu/paseodog-tests-');
    try {
        // 명시적 소수 파일 실행은 공통 번들 준비 비용을 지불하지 않는다.
        if (!selectedFiles) await prepareComposerFixture(directory);
        const files = selectedFiles ?? (await readdir(join(root, 'tests'))).filter(name => name.endsWith('.test.mjs'))
            .sort().map(name => join(root, 'tests', name));
        return await new Promise((resolveRun, reject) => {
            const child = spawn(process.execPath, ['--test', ...args, ...files], {
                cwd: root, stdio: 'inherit', env: { ...process.env,
                    PASEODOG_TEST_COMPOSER_FIXTURE: selectedFiles ? '' : directory },
            });
            child.on('error', reject);
            child.on('close', (code, signal) => signal ? reject(new Error(`Tests interrupted: ${signal}`)) : resolveRun(code));
        });
    } finally { await rm(directory, { recursive: true, force: true }); }
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

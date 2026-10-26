import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, lstat, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand } from './release-command.mjs';
import { root } from './paths.mjs';
import { COMPOSER_FILE } from './patch-paseo-composer.mjs';

export async function sourceFingerprint(run = runCommand, prefixes) {
    const paths = (await run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
        { cwd: root, capture: true })).split('\0').filter(Boolean).sort();
    paths.push(...['engine', 'tools', 'plugin', 'android'].map(directory => `${directory}/node_modules/.package-lock.json`),
        `tools/node_modules/@getpaseo/server/${COMPOSER_FILE}`,
        'tools/node_modules/@getpaseo/server/dist/server/server/agent/tools/paseo-tools.js');
    const hash = createHash('sha256').update(process.version).update(process.env.NODE_OPTIONS || '');
    for (const path of [...new Set(paths)].sort()) {
        if (prefixes && !prefixes.some(prefix => path === prefix || path.startsWith(prefix + '/'))) continue;
        const fullPath = join(root, path);
        const link = (await lstat(fullPath)).isSymbolicLink();
        // Git은 링크 대상 디렉터리 대신 링크 자체를 추적한다.
        const bytes = link ? Buffer.from(await readlink(fullPath)) : await readFile(fullPath);
        hash.update(`${path}\0${link ? 'symlink' : 'file'}\0${bytes.length}\0`).update(bytes);
    }
    return hash.digest('hex');
}

// 성공한 검사는 즉시 저장한다. 다른 검사의 실패나 출력 폴더 변경으로 성공 기록을 잃지 않는다.
export async function verifyReleaseSource(config, run = runCommand) {
    const fingerprint = await sourceFingerprint(run);
    const path = join(config.workspace, 'verification.json');
    const identity = { fingerprint, appTests: config.appTests };
    await mkdir(config.workspace, { recursive: true, mode: 0o700 });
    const cache = join(config.cacheRoot || config.workspace, 'verification-v2');
    await mkdir(cache, { recursive: true, mode: 0o700 });
    const results = [];
    const epoch = config.verificationEpoch ?? 0;
    const execute = async (name, args, cwd = root, prefixes) => {
        const input = { schema: 2, fingerprint: prefixes ? await sourceFingerprint(run, prefixes) : fingerprint,
            node: process.version, platform: process.platform, arch: process.arch, epoch, name, args };
        const key = createHash('sha256').update(JSON.stringify(input)).digest('hex');
        const receipt = join(cache, key + '.json');
        let previous;
        try { previous = JSON.parse(await readFile(receipt, 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
        if (previous?.status === 'complete' && JSON.stringify(previous.input) === JSON.stringify(input)) {
            console.log(`${name}: reused verified identical inputs`);
            results.push({ name, cached: true, elapsedMs: 0 });
            return;
        }
        const started = performance.now();
        await run('npm', args, { cwd, log: join(config.workspace, `${name}.log`),
            env: { ...process.env, ...(name === 'test' ? {
                PASEODOG_TEST_CACHE: join(cache, 'root-files'),
                PASEODOG_TEST_INPUT: key,
                PASEODOG_TEST_SOURCE: fingerprint,
            } : {}) } });
        if (await sourceFingerprint(run) !== fingerprint) throw new Error('Source changed during verification');
        const result = { name, cached: false, elapsedMs: Math.round(performance.now() - started) };
        const temporary = `${receipt}.${process.pid}.tmp`;
        await writeFile(temporary, JSON.stringify({ status: 'complete', input, ...result }), { mode: 0o600 });
        await rename(temporary, receipt);
        results.push(result);
    };
    // 타입/앱 검사는 루트 패치 주석이나 다른 앱 테스트 목록에 의해 무효화되지 않는다.
    const pluginInputs = ['plugin', 'engine', 'package.json'];
    const appInputs = ['android', 'plugin/shared', 'package.json'];
    const checks = await Promise.allSettled([
        (async () => { await execute('check', ['run', 'check']); await execute('test', ['test']); })(),
        execute('plugin-types', ['run', 'typecheck'], root, pluginInputs),
        execute('app-types', ['run', 'typecheck'], join(root, 'android/packages/app'), appInputs),
        execute('app-tests', ['test', '--', ...config.appTests], join(root, 'android/packages/app'), appInputs),
    ]);
    const failed = checks.filter(result => result.status === 'rejected');
    if (failed.length) throw new AggregateError(failed.map(result => result.reason),
        failed.map(result => result.reason.message).join('; '));
    if (await sourceFingerprint(run) !== fingerprint) throw new Error('Source changed during verification');
    await writeFile(path + '.tmp', JSON.stringify({ identity, results, completedAt: new Date().toISOString() }) + '\n', { mode: 0o600 });
    await rename(path + '.tmp', path);
    return { cached: results.every(result => result.cached), results };
}

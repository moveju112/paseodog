import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, lstat, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand } from './release-command.mjs';
import { root } from './paths.mjs';

export async function sourceFingerprint(run = runCommand) {
    const paths = (await run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
        { cwd: root, capture: true })).split('\0').filter(Boolean).sort();
    const hash = createHash('sha256').update(process.version);
    for (const path of [...new Set(paths)]) {
        const fullPath = join(root, path);
        const link = (await lstat(fullPath)).isSymbolicLink();
        // Git은 링크 대상 디렉터리 대신 링크 자체를 추적한다.
        const bytes = link ? Buffer.from(await readlink(fullPath)) : await readFile(fullPath);
        hash.update(`${path}\0${link ? 'symlink' : 'file'}\0${bytes.length}\0`).update(bytes);
    }
    return hash.digest('hex');
}

// 커밋 전과 배포 전의 같은 검사 결과를 재사용한다. 소스·테스트 목록·Node가 바뀌면 다시 검증한다.
export async function verifyReleaseSource(config, run = runCommand) {
    const fingerprint = await sourceFingerprint(run);
    const path = join(config.workspace, 'verification.json');
    const identity = { fingerprint, appTests: config.appTests };
    let previous;
    try { previous = JSON.parse(await readFile(path, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    if (JSON.stringify(previous?.identity) === JSON.stringify(identity)) {
        console.log('Source checks: reused verified identical inputs');
        return { cached: true };
    }
    await mkdir(config.workspace, { recursive: true, mode: 0o700 });
    const execute = (name, command, args, cwd = root) =>
        run(command, args, { cwd, log: join(config.workspace, `${name}.log`) });
    await execute('check', 'npm', ['run', 'check']);
    await execute('test', 'npm', ['test']);
    await Promise.all([
        execute('plugin-types', 'npm', ['run', 'typecheck']),
        execute('app-types', 'npm', ['run', 'typecheck'], join(root, 'android/packages/app')),
        execute('app-tests', 'npm', ['test', '--', ...config.appTests], join(root, 'android/packages/app')),
    ]);
    if (await sourceFingerprint(run) !== fingerprint) throw new Error('Source changed during verification');
    await writeFile(path + '.tmp', JSON.stringify({ identity, completedAt: new Date().toISOString() }) + '\n', { mode: 0o600 });
    await rename(path + '.tmp', path);
    return { cached: false };
}

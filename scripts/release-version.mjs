import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { runCommand } from './release-command.mjs';

// 준비된 깨끗한 checkout에서 릴리즈 메타데이터 세 파일만 변경한다. 실패한 Git 작업은 재시도하지 않는다.
export async function advanceReleaseVersion(source, repo, run = runCommand, {
    installedRelease = () => readFile('/opt/PaseoDog/resources/paseodog-runtime/plugin/shared/release.json', 'utf8').then(JSON.parse),
} = {}) {
    if (repo !== 'moveju112/paseodog') throw new Error('Unexpected release repository');
    const git = args => run('git', args, { cwd: source, capture: true });
    if ((await git(['status', '--porcelain'])).trim())
        throw new Error('Version preparation requires a clean checkout');
    const files = ['plugin/shared/release.json', 'CHANGELOG.md', 'MANIFEST.sha256'];
    const [json, changelog, manifest] = await Promise.all(files.map(path => readFile(join(source, path), 'utf8')));
    const release = JSON.parse(json);
    if (!Number.isSafeInteger(release.versionCode) || release.versionCode <= 0
        || !/^[0-9][0-9A-Za-z.+-]*$/.test(release.version))
        throw new Error('Invalid source release metadata');
    const releases = JSON.parse(await run('gh', ['release', 'list', '--repo', repo, '--limit', '100',
        '--json', 'tagName,isDraft'], { cwd: source, capture: true }));
    const installed = await installedRelease();
    if (!Number.isSafeInteger(installed.versionCode) || installed.versionCode <= 0)
        throw new Error('Invalid installed release metadata');
    const prefix = `v${release.version}.`;
    const published = releases.filter(row => row.tagName.startsWith(prefix))
        .map(row => Number(row.tagName.slice(prefix.length)));
    if (published.some(value => !Number.isSafeInteger(value) || value <= 0))
        throw new Error('Invalid published release metadata');
    const versionCode = Math.max(release.versionCode, installed.versionCode, ...published) + 1;
    if (!Number.isSafeInteger(versionCode)) throw new Error('Release version overflow');
    const headings = changelog.split('\n').filter(line => line.startsWith(`## ${release.version} - `));
    if (headings.length !== 1) throw new Error('Expected one product changelog heading');
    const updated = [
        JSON.stringify({ ...release, versionCode }, null, 2) + '\n',
        changelog.replace(headings[0], `${headings[0]}\n\n- ${versionCode}: 최신 게시 소스의 검증·전체 플랫폼 릴리즈·서버 반영을 실행한다.`),
    ];
    let hashes = manifest;
    for (let index = 0; index < updated.length; index++) {
        const suffix = `  ${files[index]}`;
        const entries = hashes.split('\n').filter(line => line.endsWith(suffix));
        if (entries.length !== 1 || !/^[a-f0-9]{64}  /.test(entries[0]))
            throw new Error(`Expected one manifest entry: ${files[index]}`);
        hashes = hashes.replace(entries[0], createHash('sha256').update(updated[index]).digest('hex') + suffix);
    }
    for (const [index, bytes] of [...updated, hashes].entries())
        await writeFile(join(source, files[index]), bytes);
    await git(['diff', '--check']);
    await git(['add', '--', ...files]);
    await git(['commit', '-m', `${versionCode} 릴리즈 메타데이터 자동 준비`]);
    await git(['push', 'origin', 'HEAD:main']);
    const commit = (await git(['rev-parse', 'HEAD'])).trim();
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid pushed commit');
    return { commit, versionCode };
}

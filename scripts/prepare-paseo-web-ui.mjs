// npm 공개 tarball의 web-ui는 composer 패치가 검토한 번들과 다르다. 검토된 원본 묶음을 고정 asset에서 받아 통째로 교체한다.
// asset은 바꾸지 않는다. 내용이 바뀌면 새 tag(0.11.4-web-ui-base.N)·asset을 만들고 paseo-web-ui-base.json 고정값을 바꾼다.
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from './paths.mjs';
import pin from './paseo-web-ui-base.json' with { type: 'json' };

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function download(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Reviewed web-ui download failed: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
}

// 파일 목록과 내용이 고정값과 정확히 같아야 한다. 빠지거나 남는 파일도 거부한다.
export async function verifyWebUi(directory, files = pin.files) {
    const entries = await readdir(directory, { recursive: true, withFileTypes: true });
    const actual = entries.filter(entry => !entry.isDirectory())
        .map(entry => relative(directory, join(entry.parentPath, entry.name)).split(sep).join('/')).sort();
    if (JSON.stringify(actual) !== JSON.stringify(Object.keys(files).sort()))
        throw new Error('Reviewed web-ui file list mismatch');
    for (const [path, hash] of Object.entries(files))
        if (sha256(await readFile(join(directory, path))) !== hash) throw new Error(`Reviewed web-ui hash mismatch: ${path}`);
}

// 검증을 모두 마친 뒤에만 기존 web-ui를 바꾼다. 실패하면 기존 설치물은 그대로 남는다.
export async function prepareWebUi(server = join(root, 'tools/node_modules/@getpaseo/server'),
    { base = pin, fetchArchive = download } = {}) {
    const manifest = JSON.parse(await readFile(join(server, 'package.json'), 'utf8'));
    if (manifest.name !== base.package || manifest.version !== base.version)
        throw new Error(`Reviewed web-ui requires ${base.package}@${base.version}`);
    const archive = await fetchArchive(base.url);
    if (sha256(archive) !== base.sha256) throw new Error('Reviewed web-ui archive hash mismatch');
    const target = join(server, base.target);
    const staging = `${target}.prepare-${randomUUID()}`;
    await mkdir(staging);
    try {
        await writeFile(join(staging, 'web-ui.tar.gz'), archive);
        // 상대 경로로 풀어 Windows 드라이브 경로를 원격 호스트로 해석하는 tar 구현을 피한다.
        const extracted = spawnSync('tar', ['-xzf', 'web-ui.tar.gz'], { cwd: staging, stdio: 'inherit' });
        if (extracted.error) throw extracted.error;
        if (extracted.status !== 0) throw new Error(`Reviewed web-ui extraction failed: ${extracted.status}`);
        await verifyWebUi(join(staging, 'web-ui'), base.files);
        await rm(target, { recursive: true, force: true });
        await rename(join(staging, 'web-ui'), target);
    } finally { await rm(staging, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        await prepareWebUi();
        console.log(`Reviewed web-ui ${pin.tag} installed`);
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}

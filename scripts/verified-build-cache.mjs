import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, stat, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileHash } from './release-state.mjs';

// lockfile 무결성으로 검증된 원본 아카이브만 재사용한다. 설치 결과나 수정된 런타임은 캐시하지 않는다.
export async function verifiedBuildCache(directory, integrity, produce) {
    const [algorithm, expected] = integrity.split('-');
    if (algorithm !== 'sha512' || !/^[A-Za-z0-9+/]+={0,2}$/.test(expected || ''))
        throw new Error('A lockfile SHA-512 integrity value is required');
    const key = createHash('sha256').update(integrity).digest('hex');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const destination = join(directory, `${key}.tgz`);
    try {
        await stat(destination);
        if (await fileHash(destination, algorithm, 'base64') !== expected) throw new Error('Build cache integrity mismatch');
        return { path: destination, cached: true };
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    const temporary = await mkdtemp(join(directory, 'download-'));
    try {
        const produced = await produce(temporary);
        if (await fileHash(produced, algorithm, 'base64') !== expected) throw new Error('Downloaded archive integrity mismatch');
        await rename(produced, destination);
        return { path: destination, cached: false };
    } finally { await rm(temporary, { recursive: true, force: true }); }
}

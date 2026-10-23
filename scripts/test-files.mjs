import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// 파일 단위 성공만 재사용한다. 실행 중 소스가 바뀌면 이번 결과를 저장하지 않는다.
export async function runTestFiles(files, execute, { cache, identity, validate = async () => true } = {}) {
    if (cache) await mkdir(cache, { recursive: true, mode: 0o700 });
    const results = [];
    let cursor = 0;
    async function worker() {
        while (cursor < files.length) {
            const file = files[cursor++];
            const key = createHash('sha256').update(JSON.stringify({ identity, file }))
                .update(await readFile(file)).digest('hex');
            const path = cache ? join(cache, key + '.json') : null;
            let previous;
            if (path) {
                try { previous = JSON.parse(await readFile(path, 'utf8')); }
                catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
            }
            if (previous?.key === key && previous?.status === 'passed') {
                results.push({ file, key, path, code: 0, cached: true });
                continue;
            }
            const code = await execute(file);
            results.push({ file, key, path, code, cached: false });
        }
    }
    // 대형 문자열 번들의 동시 메모리 사용을 제한하며 독립 파일은 병렬로 실행한다.
    const workers = await Promise.allSettled(Array.from({ length: 4 }, worker));
    const failure = workers.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    if (!await validate()) throw new Error('Source changed during tests; results were not cached');
    for (const result of results) {
        if (!result.path || result.cached || result.code !== 0) continue;
        const temporary = `${result.path}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify({ key: result.key, status: 'passed' }), { mode: 0o600 });
        await rename(temporary, result.path);
    }
    console.log(`Test files: ${results.length}, reused: ${results.filter(result => result.cached).length}, failed: ${results.filter(result => result.code !== 0).length}`);
    return results.some(result => result.code !== 0) ? 1 : 0;
}

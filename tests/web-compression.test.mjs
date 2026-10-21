import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    brotliCompressSync, brotliDecompressSync, constants, gunzipSync, gzipSync,
} from 'node:zlib';
import { compressFile } from '../android/scripts/build-daemon-web-ui.mjs';

// 실제 압축·검증을 수행할 파일과 캐시는 테스트 소유 임시 디렉터리에만 만든다.
async function fixture(context) {
    const root = await mkdtemp(join(tmpdir(), 'paseodog-compression-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    const source = Buffer.from('PaseoDog exact compression payload\n'.repeat(200));
    const file = join(root, 'bundle.js');
    const cache = join(root, 'cache');
    await writeFile(file, source);
    return { root, source, file, cache };
}

// 독립적인 zlib 결과·복원 바이트와 비교해 최대 품질과 gzip 형식을 유지한다.
test('web compression cache preserves exact maximum-quality output after target cleanup', async context => {
    const { source, file, cache } = await fixture(context);
    assert.deepEqual(await compressFile(file, cache), { cached: false });
    const br = await readFile(file + '.br');
    const gz = await readFile(file + '.gz');
    assert.deepEqual(br, brotliCompressSync(source, {
        params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY },
    }));
    assert.deepEqual(gz, gzipSync(source));
    assert.deepEqual(brotliDecompressSync(br), source);
    assert.deepEqual(gunzipSync(gz), source);
    await rm(file + '.br');
    await rm(file + '.gz');
    assert.deepEqual(await compressFile(file, cache), { cached: true });
    assert.deepEqual(await readFile(file + '.br'), br);
    assert.deepEqual(await readFile(file + '.gz'), gz);
});

// 파일명·크기가 같아도 본문이 바뀌면 기존 압축을 재사용하지 않는다.
test('content changes invalidate compressed assets without changing names', async context => {
    const { file, cache, source } = await fixture(context);
    await compressFile(file, cache);
    const changed = Buffer.from(source.toString().replaceAll('PaseoDog', 'PaseoCat'));
    assert.equal(changed.length, source.length);
    await writeFile(file, changed);
    assert.deepEqual(await compressFile(file, cache), { cached: false });
    assert.deepEqual(gunzipSync(await readFile(file + '.gz')), changed);
});

// 손상된 압축·메타데이터·누락된 파일은 정상 입력으로 다시 만들고 검증한다.
test('damaged cache payloads and receipts are rebuilt rather than served', async context => {
    const { file, cache, source } = await fixture(context);
    await compressFile(file, cache);
    const entries = await readdir(cache);
    await writeFile(join(cache, entries.find(name => name.endsWith('.br'))), 'damaged');
    assert.deepEqual(await compressFile(file, cache), { cached: false });
    assert.deepEqual(brotliDecompressSync(await readFile(file + '.br')), source);
    await writeFile(join(cache, entries.find(name => name.endsWith('.json'))), '{');
    assert.deepEqual(await compressFile(file, cache), { cached: false });
    await rm(join(cache, entries.find(name => name.endsWith('.gz'))));
    assert.deepEqual(await compressFile(file, cache), { cached: false });
    assert.deepEqual(gunzipSync(await readFile(file + '.gz')), source);
    assert.deepEqual(await compressFile(file, cache), { cached: true });
});

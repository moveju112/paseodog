import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { composerFixture } from './composer-fixture.mjs';

test('shared fixture verifies bytes and sends unknown inputs to the real hash gate', async t => {
    // 더 이상 배포하지 않는 변환기의 미검토 입력 거절은 계속 검사한다.
    // 공유 소스의 빌드 성공은 build-web 테스트와 실제 릴리즈 export에서 검증한다.
    const source = 'unreviewed fixture bytes';
    assert.throws(() => composerFixture(source), /hash mismatch/);
    assert.throws(() => composerFixture(source + '// drift'), /hash mismatch/);
    const directory = await mkdtemp('/data/tmp/ubuntu/paseodog-fixture-test-');
    t.after(() => rm(directory, { recursive: true, force: true }));
    const previous = process.env.PASEODOG_TEST_COMPOSER_FIXTURE;
    try {
        await writeFile(join(directory, 'receipt.json'), JSON.stringify({
            input: createHash('sha256').update(source).digest('hex'),
            output: createHash('sha256').update(source).digest('hex'),
        }));
        await writeFile(join(directory, 'patched.js'), 'corrupt');
        process.env.PASEODOG_TEST_COMPOSER_FIXTURE = directory;
        const fresh = await import(pathToFileURL(new URL('./composer-fixture.mjs', import.meta.url).pathname).href + '?corruption-test');
        assert.throws(() => fresh.composerFixture(source), /fixture is corrupt/);
        assert.equal(await readFile(join(directory, 'patched.js'), 'utf8'), 'corrupt');
    } finally {
        if (previous === undefined) delete process.env.PASEODOG_TEST_COMPOSER_FIXTURE;
        else process.env.PASEODOG_TEST_COMPOSER_FIXTURE = previous;
    }
});

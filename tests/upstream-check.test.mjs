import test from 'node:test';
import assert from 'node:assert/strict';
import { checkUpstream } from '../scripts/check-upstream.mjs';
import { PIN } from '../scripts/patch-mixdog.mjs';

// 실제 저장소의 pin과 lockfile을 검사하고 비교 결과를 검증한다.
test('upstream check validates pinned packages and reports differing releases without installing', async () => {
    const versions = { mixdog: PIN, '@getpaseo/cli': '99.0.0', '@getpaseo/plugin': '99.0.0' };
    const rows = await checkUpstream({ lookup: async (name) => versions[name] });
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[0], { name: 'mixdog', pinned: PIN, latest: PIN, reviewRequired: false });
    assert.equal(rows[1].reviewRequired, true);
    assert.equal(rows[2].reviewRequired, true);
    assert.equal(rows[1].pinned, rows[2].pinned);
});

// 조회 실패를 최신 버전 확인 성공으로 숨기지 않는다.
test('registry failure fails the upstream check', async () => {
    await assert.rejects(checkUpstream({ lookup: async () => { throw new Error('registry unavailable'); } }),
        /registry unavailable/);
});

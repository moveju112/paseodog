import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readUsageMetrics } from '../engine/src/usage.mjs';
import { resolveUsageStatsPeriod } from '../engine/node_modules/mixdog/src/session-runtime/services/usage-stats-period.mjs';

const originalTimezone = process.env.TZ;
process.env.TZ = 'Asia/Seoul';

// 테스트 프로세스의 현지 시간대를 복원한다.
after(() => {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
});

// 실제 원본 기간 계산만 재사용하고 원장·할당량 호출은 기록용 가짜로 대체한다.
function fakeRuntime(now) {
    const calls = { stats: [], dashboard: [], efforts: [] };
    return {
        calls,
        // 요청을 기록한 뒤 원본의 읽기 전용 기간 계산으로 통계 범위를 반환한다.
        async getUsageStats(input) {
            calls.stats.push(input);
            const range = resolveUsageStatsPeriod({ ...input, now });
            return {
                generatedAt: now, range, totals: { tokens: 42, secret: 'hidden' },
                providers: [], daily: [{ day: range.startDay, tokens: 42 }],
            };
        },
        // 할당량 요청 옵션을 기록한다.
        async getUsageDashboard(input) {
            calls.dashboard.push(input);
            return { rows: [] };
        },
        // 통계 응답 범위가 노력도 집계에 그대로 전달되는지 기록한다.
        async getEffortUsageStats(input) {
            calls.efforts.push(input);
            return [];
        },
    };
}

for (const scenario of [
    { instant: '2026-10-20T12:34:56.789+09:00', endDay: '2026-10-20', endTime: '12:34:56',
        startDay: '2026-10-20', starts: { '1h': '11:34:56', '8h': '04:34:56' } },
    { instant: '2026-10-20T00:12:34.567+09:00', endDay: '2026-10-20', endTime: '00:12:34',
        startDay: '2026-10-19', starts: { '1h': '23:12:34', '8h': '16:12:34' } },
]) {
    for (const [view, hours] of [['1h', 1], ['8h', 8]]) {
        // 고정 시각의 정확한 요청·경과 시간·자정 경계·원본 집계 범위를 함께 검증한다.
        test(`${view} uses local second-precision custom bounds at ${scenario.instant}`, async (context) => {
            const now = Date.parse(scenario.instant);
            const clock = context.mock.method(Date, 'now', () => now);
            const runtime = fakeRuntime(now);
            const result = await readUsageMetrics(runtime, { view, refresh: true });
            assert.equal(clock.mock.callCount(), 1);
            assert.deepEqual(runtime.calls.stats, [{
                view: 'custom', modelLimit: 50, source: 'all',
                startDay: scenario.startDay, endDay: scenario.endDay,
                startTime: scenario.starts[view], endTime: scenario.endTime,
            }]);
            const exactStart = now - hours * 3_600_000;
            assert.equal(result.range.fromMs, Math.floor(exactStart / 1000) * 1000);
            assert.equal(result.range.toMs, now);
            assert.ok(exactStart - result.range.fromMs >= 0 && exactStart - result.range.fromMs < 1000);
            assert.deepEqual(runtime.calls.efforts, [result.range]);
            assert.deepEqual(runtime.calls.dashboard, [{ refresh: true, refreshSetup: false }]);
            assert.deepEqual(result.totals, { tokens: 42, outputTokensPerSecond: null,
                low10OutputTokensPerSecond: null, high10OutputTokensPerSecond: null });
            assert.equal(result.series[0].tokens, 42);
        });
    }
}

// 기존 기간과 기본값은 변환하지 않으며 hour의 24시간 의미도 유지한다.
test('legacy periods and default requests retain their native contract', async (context) => {
    const now = Date.parse('2026-10-20T12:34:56.789+09:00');
    const clock = context.mock.method(Date, 'now', () => now);
    for (const view of [undefined, 'hour', '7d', 'day', 'week', 'month', 'all', 'custom']) {
        const runtime = fakeRuntime(now);
        const request = { view, startDay: '2026-10-18', endDay: '2026-10-19' };
        const result = await readUsageMetrics(runtime, request);
        assert.deepEqual(runtime.calls.stats, [{
            view: view ?? 'hour', modelLimit: 50, source: 'all',
            ...(view === 'custom' ? { startDay: request.startDay, endDay: request.endDay } : {}),
        }]);
        assert.deepEqual(runtime.calls.dashboard, [{ refresh: false, refreshSetup: false }]);
        assert.deepEqual(runtime.calls.efforts, [result.range]);
        if (view === undefined || view === 'hour') {
            assert.equal(result.range.toMs - result.range.fromMs, 24 * 3_600_000);
        }
    }
    assert.equal(clock.mock.callCount(), 0);
});

// 지원하지 않는 기간은 원본 API에 전달하기 전에 거부한다.
test('invalid usage periods do not reach the runtime', async () => {
    const runtime = fakeRuntime(Date.parse('2026-10-20T12:34:56.789+09:00'));
    await assert.rejects(readUsageMetrics(runtime, { view: '2h' }), /Invalid usage period/);
    assert.deepEqual(runtime.calls, { stats: [], dashboard: [], efforts: [] });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuotaRefreshPolicy, AUTO_REFRESH_MS, FORCE_REFRESH_MS, MIN_BACKOFF_MS, MAX_BACKOFF_MS } from '../plugin/server/quota-refresh.mjs';

// 시각을 직접 움직이는 정책 생성
function policy() {
    const clock = { at: 1000000 };
    return { clock, value: createQuotaRefreshPolicy({ now: () => clock.at }) };
}
const fresh = (at) => ({ quotas: [{ authenticated: true, updatedAt: at }, { authenticated: false, updatedAt: null }] });

test('automatic refresh is shared across clients and paced by the poll interval', () => {
    const { clock, value } = policy();
    assert.equal(value.admit(undefined), null);
    const started = value.admit('auto');
    assert.equal(started, clock.at);
    assert.equal(value.admit('auto'), null);
    value.settle(started, fresh(clock.at));
    clock.at += AUTO_REFRESH_MS - 1;
    assert.equal(value.admit('auto'), null);
    clock.at += 1;
    assert.notEqual(value.admit('auto'), null);
});

test('manual refresh skips backoff but not the minimum interval', () => {
    const { clock, value } = policy();
    const started = value.admit('force');
    value.settle(started, { quotas: [], quotaError: 'failed' });
    assert.equal(value.admit('force'), null);
    clock.at += FORCE_REFRESH_MS;
    assert.notEqual(value.admit('force'), null);
});

test('stale fallback rows back off exponentially up to the cap and reset on success', () => {
    const { clock, value } = policy();
    let backoff = MIN_BACKOFF_MS;
    clock.at += AUTO_REFRESH_MS;
    for (let round = 0; round < 6; round += 1) {
        const started = value.admit('auto');
        assert.notEqual(started, null);
        value.settle(started, fresh(started - 60000));
        const wait = Math.max(backoff, AUTO_REFRESH_MS);
        clock.at += wait - 1;
        assert.equal(value.admit('auto'), null);
        clock.at += 1;
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
    const started = value.admit('auto');
    value.settle(started, null);
    clock.at += MAX_BACKOFF_MS;
    const recovered = value.admit('auto');
    value.settle(recovered, fresh(recovered));
    clock.at += AUTO_REFRESH_MS;
    assert.notEqual(value.admit('auto'), null);
});

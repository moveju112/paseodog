// OAuth 할당량 실시간 갱신 간격 정책 (usage_widget 방식: 주기 조회·실패 백오프·수동 연타 제한).
// Anthropic /oauth/usage는 약 1분에 1회만 허용해 여러 클라이언트의 자동 조회를 호스트에서 하나로 묶는다.
export const AUTO_REFRESH_MS = 110000;
export const FORCE_REFRESH_MS = 15000;
export const MIN_BACKOFF_MS = 75000;
export const MAX_BACKOFF_MS = 600000;
// Mixdog이 직전 전체 갱신 결과를 재사용하는 30초 범위의 값은 새로 받은 값으로 본다.
const REUSE_MS = 30000;

// 갱신 허용 여부 판단 (모드 -> 시작 시각 또는 null)
export function createQuotaRefreshPolicy({ now = Date.now } = {}) {
    let lastAttempt = -Infinity, retryAt = 0, backoff = 0;
    return {
        // 자동은 주기·백오프를 지키고, 수동은 백오프를 무시하되 최소 간격만 지킨다.
        admit(mode) {
            const at = now();
            if (mode === 'force' ? at - lastAttempt < FORCE_REFRESH_MS
                : mode !== 'auto' || at < retryAt || at - lastAttempt < AUTO_REFRESH_MS) return null;
            lastAttempt = at;
            return at;
        },
        // 연결된 계정의 갱신 시각이 시도 시점 이전이면 Mixdog이 이전 값으로 대체한 실패로 본다.
        settle(startedAt, result) {
            const rows = Array.isArray(result?.quotas) ? result.quotas.filter((row) => row.authenticated) : [];
            const fresh = !!result && !result.quotaError
                && rows.every((row) => Number(row.updatedAt) >= startedAt - REUSE_MS);
            if (fresh) { backoff = 0; retryAt = 0; return; }
            backoff = Math.min(Math.max(backoff * 2, MIN_BACKOFF_MS), MAX_BACKOFF_MS);
            retryAt = now() + backoff;
        },
    };
}

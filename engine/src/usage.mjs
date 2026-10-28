const quotaProviders = {
    'anthropic-oauth': { label: 'Claude', windowPrefix: 'claude' },
    'openai-oauth': { label: 'Codex', windowPrefix: 'codex' },
};

// 인증 갱신은 전용 런타임에 맡기고 공개 할당량만 Paseo 형식으로 전달한다.
export async function readOAuthUsage(runtime, provider = 'anthropic-oauth') {
    if (!Object.hasOwn(quotaProviders, provider)) throw new Error('Unsupported usage provider');
    const { label, windowPrefix } = quotaProviders[provider];
    const dashboard = await runtime.getUsageDashboard({
        refresh: true,
        refreshSetup: false,
        refreshProviders: [provider],
    });
    const row = dashboard.rows.find((item) => item.id === provider);
    if (!row) {
        return { status: 'error', error: `PaseoDog에서 ${label} 인증 상태를 확인하지 못했어요. 새로고침으로 다시 확인해 주세요.` };
    }
    if (!row.authenticated) {
        return { status: 'error', error: `PaseoDog 설정에서 ${label} 계정을 연결해 주세요.` };
    }
    if (!row.windows?.length) {
        return { status: 'error', error: `PaseoDog에서 ${label} 사용량을 가져오지 못했어요. 새로고침으로 다시 확인해 주세요.` };
    }
    return {
        status: 'available',
        windows: row.windows.map((window, index) => ({
            id: `${windowPrefix}-${index}`,
            label: window.label,
            summary: index < 2,
            usedPct: window.usedPct ?? null,
            resetsAt: window.resetAt ? new Date(window.resetAt).toISOString() : null,
        })),
        details: row.updatedAt ? [{
            id: 'updated-at', label: 'PaseoDog 갱신 시각',
            value: new Date(row.updatedAt).toISOString(),
        }] : [],
    };
}

const metricKeys = ['turns', 'tokens', 'input', 'output', 'cacheRead', 'cacheWrite', 'cacheHitRate',
    'costUsd', 'costBilled', 'costEstimated', 'costUnpricedTurns', 'outputTokensPerSecond',
    'minOutputTokensPerSecond', 'maxOutputTokensPerSecond', 'share'];
const visibleOAuthProviders = { 'anthropic-oauth': 'Claude', 'openai-oauth': 'Codex' };

// 원본 통계에서 수치 필드만 선택해 경로·세션·인증정보가 UI로 새지 않게 한다.
function metricProjection(row = {}) {
    return Object.fromEntries(metricKeys.filter((key) => row[key] === null || Number.isFinite(row[key]))
        .map((key) => [key, row[key]]));
}

// 현재 시각 하나로 짧은 구간을 현지 날짜·초 단위로 변환한다.
function shortUsagePeriod(view) {
    const now = Date.now();
    const start = new Date(Math.floor((now - (view === '1h' ? 1 : 8) * 60 * 60 * 1000) / 1000) * 1000);
    const end = new Date(now);
    // 원본 API는 시작 초의 .000부터 끝 초의 .999와 조회 시각 중 작은 값까지 포함한다.
    // 시작을 초 단위로 내림하므로 요청 길이보다 최대 999ms 더 포함한다.
    const [startDay, endDay] = [start, end].map((date) =>
        [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'));
    const [startTime, endTime] = [start, end].map((date) =>
        [date.getHours(), date.getMinutes(), date.getSeconds()].map((part) => String(part).padStart(2, '0')).join(':'));
    return { view: 'custom', startDay, endDay, startTime, endTime };
}

// Mixdog 원장과 OAuth 대시보드를 함께 읽되 각 API의 원래 집계·갱신 방식을 유지한다.
export async function readUsageMetrics(runtime, request = {}) {
    const view = request.view || 'hour';
    if (!['1h', '8h', 'hour', '7d', 'day', 'week', 'month', 'all', 'custom'].includes(view))
        throw new Error('Invalid usage period');
    const period = view === '1h' || view === '8h' ? shortUsagePeriod(view) : {
        view,
        ...(view === 'custom' ? { startDay: request.startDay, endDay: request.endDay } : {}),
    };
    let quotaError;
    const [stats, dashboard] = await Promise.all([
        runtime.getUsageStats({
            ...period, modelLimit: 50, source: 'all',
        }),
        runtime.getUsageDashboard({ refresh: request.refresh === true, refreshSetup: false }).catch(() => {
            quotaError = 'OAuth 할당량을 불러오지 못했어요. 토큰 사용량은 정상 조회됐으며, 새로고침으로 다시 확인할 수 있어요.';
            return { rows: [] };
        }),
    ]);
    const efforts = await runtime.getEffortUsageStats?.({
        fromMs: stats.range.fromMs, toMs: stats.range.toMs,
    }) || [];
    // 요청별 속도의 단순 평균 대신 측정된 출력과 시간을 합산한다.
    const speedOf = (rows) => {
        const output = rows.reduce((sum, row) => sum + (row.speedOutput || 0), 0);
        const ms = rows.reduce((sum, row) => sum + (row.speedMs || 0), 0);
        const minimums = rows.map((row) => row.minOutputTokensPerSecond).filter(Number.isFinite);
        const maximums = rows.map((row) => row.maxOutputTokensPerSecond).filter(Number.isFinite);
        return {
            outputTokensPerSecond: ms > 0 ? Math.round(output * 10000 / ms) / 10 : null,
            minOutputTokensPerSecond: minimums.length ? Math.min(...minimums) : null,
            maxOutputTokensPerSecond: maximums.length ? Math.max(...maximums) : null,
        };
    };
    return {
        generatedAt: stats.generatedAt,
        ...(quotaError ? { quotaError } : {}),
        range: { fromMs: stats.range.fromMs, toMs: stats.range.toMs },
        totals: { ...metricProjection(stats.totals), ...speedOf(efforts) },
        efforts: efforts.map((row) => ({
            provider: row.provider, model: row.model,
            agent: row.agent || null, effort: row.effort || null,
            fast: typeof row.fast === 'boolean' ? row.fast : null, ...metricProjection(row),
        })),
        providers: stats.providers.map((row) => ({
            provider: row.provider, providerKind: row.providerKind,
            label: visibleOAuthProviders[row.provider] || row.provider, ...metricProjection(row),
            ...speedOf(efforts.filter((effort) => effort.provider === row.provider)),
            models: row.models.map((model) => ({ model: model.model, ...metricProjection(model) })),
        })),
        series: (stats.hourly || stats.daily).map((row) => ({
            label: row.label ?? row.day, ...metricProjection(row),
        })),
        quotas: dashboard.rows.filter((row) => row.group === 'oauth' && Object.hasOwn(visibleOAuthProviders, row.id)).map((row) => ({
            id: row.id, label: visibleOAuthProviders[row.id], authenticated: row.authenticated, updatedAt: row.updatedAt,
            windows: row.windows.map((window) => ({
                label: window.label, usedPct: window.usedPct ?? null, resetAt: window.resetAt ?? null,
            })),
            resetCredits: row.resetCredits ? { availableCount: row.resetCredits.availableCount } : null,
        })),
    };
}

// Request metadata extends the existing route signature; no ledger rows are rewritten.
function legacyReadEffortUsage(db, { fromMs, toMs }) {
    if (!Number.isSafeInteger(fromMs) || !Number.isSafeInteger(toMs) || fromMs < 0 || toMs < fromMs)
        throw new Error('Invalid effort usage period');
    const rows = db.prepare(`
        WITH grouped AS (
            SELECT day,route,COUNT(*) AS turns,SUM(input) AS input,SUM(output) AS output,
                SUM(cache_read) AS cache_read,SUM(cache_write) AS cache_write,
                SUM(cost_usd) AS cost_usd,SUM(duration_ms) AS duration_ms,
                SUM(CASE WHEN duration_ms>0 AND output>0 THEN output ELSE 0 END) AS speed_output,
                SUM(CASE WHEN duration_ms>0 AND output>0 THEN duration_ms ELSE 0 END) AS speed_ms
            FROM usage_events WHERE ts>=? AND ts<=? GROUP BY day,route
        ), attributed AS (
            SELECT printf('%04d-%02d-%02d',g.day/10000,(g.day/100)%100,g.day%100) AS day,
                json_extract(r.signature,'$[0]') AS provider,
                json_extract(r.signature,'$[1]') AS model,
                json_extract(r.signature,'$[4]') AS cost_source,
                json_extract(r.signature,'$[7]') AS rank,
                json_extract(r.signature,'$[9]') AS effort,
                json_extract(r.signature,'$[10]') AS agent,
                json_extract(r.signature,'$[11]') AS fast,
                COALESCE(json_extract(json_extract(r.signature,'$[5]'),'$.inputTokensKnown'),1)=0 AS unmeasured,
                g.turns,g.input,g.output,g.cache_read,g.cache_write,g.cost_usd,g.duration_ms,g.speed_output,g.speed_ms
            FROM grouped g JOIN usage_routes r ON r.id=g.route
        ), best AS (
            SELECT day,provider,model,MIN(rank) AS rank FROM daily
            WHERE day BETWEEN ? AND ? GROUP BY day,provider,model
        )
        SELECT a.* FROM attributed a JOIN best USING(day,provider,model,rank)
    `).all(fromMs, toMs, usageRollupDayKey(fromMs), usageRollupDayKey(toMs));
    const groups = new Map();
    for (const row of rows) {
        const key = JSON.stringify([row.provider, row.model, row.agent, row.effort, row.fast]);
        let bucket = groups.get(key);
        if (!bucket) {
            bucket = { ...empty(), provider: row.provider, model: row.model, agent: row.agent, effort: row.effort,
                fast: row.fast == null ? null : row.fast === 1, speedOutput: 0, speedMs: 0 };
            groups.set(key, bucket);
        }
        add(bucket, row);
        bucket.speedOutput += row.speed_output;
        bucket.speedMs += row.speed_ms;
    }
    return [...groups.values()];
}

// 기존 설치본의 정확한 패치 본문을 되돌리기 위한 보존본이다. 실행에는 새 구현만 주입한다.
const legacyReadEffortUsageSource = legacyReadEffortUsage.toString()
    .replace('function legacyReadEffortUsage(', 'function readEffortUsage(');
const previousRollupSource = legacyReadEffortUsageSource
    .replace('SUM(duration_ms) AS duration_ms,\n                SUM(CASE WHEN duration_ms>0 AND output>0 THEN output ELSE 0 END) AS speed_output,\n                SUM(CASE WHEN duration_ms>0 AND output>0 THEN duration_ms ELSE 0 END) AS speed_ms', 'SUM(duration_ms) AS duration_ms')
    .replace("                json_extract(r.signature,'$[11]') AS fast,\n", '')
    .replace('g.duration_ms,g.speed_output,g.speed_ms', 'g.duration_ms')
    .replace('row.agent, row.effort, row.fast]', 'row.agent, row.effort]')
    .replace('effort: row.effort,\n                fast: row.fast == null ? null : row.fast === 1, speedOutput: 0, speedMs: 0 };', 'effort: row.effort };')
    .replace('        bucket.speedOutput += row.speed_output;\n        bucket.speedMs += row.speed_ms;\n', '');
const extremaRollupEdits = [
    [
        'SUM(CASE WHEN duration_ms>0 AND output>0 THEN duration_ms ELSE 0 END) AS speed_ms\n            FROM usage_events',
        `SUM(CASE WHEN duration_ms>0 AND output>0 THEN duration_ms ELSE 0 END) AS speed_ms,
                MIN(CASE WHEN duration_ms>0 AND output>0 THEN output*1000.0/duration_ms END) AS speed_min,
                MAX(CASE WHEN duration_ms>0 AND output>0 THEN output*1000.0/duration_ms END) AS speed_max
            FROM usage_events`,
    ], [
        'g.duration_ms,g.speed_output,g.speed_ms',
        'g.duration_ms,g.speed_output,g.speed_ms,g.speed_min,g.speed_max',
    ], [
        'speedOutput: 0, speedMs: 0 };',
        'speedOutput: 0, speedMs: 0, minOutputTokensPerSecond: null, maxOutputTokensPerSecond: null };',
    ], [
        '        bucket.speedMs += row.speed_ms;',
        `        bucket.speedMs += row.speed_ms;
        if (row.speed_min != null) {
            bucket.minOutputTokensPerSecond = Math.min(bucket.minOutputTokensPerSecond ?? Infinity, row.speed_min);
            bucket.maxOutputTokensPerSecond = Math.max(bucket.maxOutputTokensPerSecond ?? -Infinity, row.speed_max);
        }`,
    ],
];
const legacyExtremaRollupSource = extremaRollupEdits.reduce(
    (source, [before, after]) => source.replace(before, after), legacyReadEffortUsageSource);

export function readEffortUsage(db, { fromMs, toMs }) {
    if (!Number.isSafeInteger(fromMs) || !Number.isSafeInteger(toMs) || fromMs < 0 || toMs < fromMs)
        throw new Error('Invalid effort usage period');
    // 사용량과 속도 표본이 같은 기간·출처 우선순위를 사용하도록 선택 범위를 공유한다.
    const selected = `
        WITH best AS (
            SELECT day,provider,model,MIN(rank) AS rank FROM daily
            WHERE day BETWEEN ? AND ? GROUP BY day,provider,model
        ), attributed AS (
            SELECT printf('%04d-%02d-%02d',e.day/10000,(e.day/100)%100,e.day%100) AS day,
                e.route,e.input,e.output,e.cache_read,e.cache_write,e.cost_usd,e.duration_ms,
                json_extract(r.signature,'$[0]') AS provider,
                json_extract(r.signature,'$[1]') AS model,
                json_extract(r.signature,'$[4]') AS cost_source,
                json_extract(r.signature,'$[7]') AS rank,
                json_extract(r.signature,'$[9]') AS effort,
                json_extract(r.signature,'$[10]') AS agent,
                json_extract(r.signature,'$[11]') AS fast,
                COALESCE(json_extract(json_extract(r.signature,'$[5]'),'$.inputTokensKnown'),1)=0 AS unmeasured
            FROM usage_events e JOIN usage_routes r ON r.id=e.route WHERE e.ts>=? AND e.ts<=?
        ), selected AS (
            SELECT a.* FROM attributed a JOIN best USING(day,provider,model,rank)
        )`;
    const parameters = [usageRollupDayKey(fromMs), usageRollupDayKey(toMs), fromMs, toMs];
    const rows = db.prepare(`${selected}
        SELECT provider,model,agent,effort,fast,cost_source,unmeasured,COUNT(*) AS turns,
            SUM(input) AS input,SUM(output) AS output,SUM(cache_read) AS cache_read,
            SUM(cache_write) AS cache_write,SUM(cost_usd) AS cost_usd,SUM(duration_ms) AS duration_ms,
            SUM(CASE WHEN duration_ms>0 AND output>0 THEN output ELSE 0 END) AS speed_output,
            SUM(CASE WHEN duration_ms>0 AND output>0 THEN duration_ms ELSE 0 END) AS speed_ms
        FROM selected GROUP BY day,route
    `).all(...parameters);
    // 전체·제공자·에이전트별 원래 응답을 정렬하고 각 범위에서 ceil(n/10)개를 산술 평균한다.
    const tailRows = db.prepare(`${selected}, timed AS (
            SELECT *,output*1000.0/duration_ms AS speed FROM selected WHERE duration_ms>0 AND output>0
        ), scopes AS (
            SELECT 'effort' AS scope,json_array(provider,model,agent,effort,fast) AS group_key,speed FROM timed
            UNION ALL SELECT 'provider',json_array(provider),speed FROM timed
            UNION ALL SELECT 'total','[]',speed FROM timed
        ), ranked AS (
            SELECT *,ROW_NUMBER() OVER(PARTITION BY scope,group_key ORDER BY speed) AS position,
                COUNT(*) OVER(PARTITION BY scope,group_key) AS samples FROM scopes
        )
        SELECT scope,group_key,
            AVG(CASE WHEN position<=CAST((samples+9)/10 AS INTEGER) THEN speed END) AS low,
            AVG(CASE WHEN position>samples-CAST((samples+9)/10 AS INTEGER) THEN speed END) AS high
        FROM ranked GROUP BY scope,group_key
    `).all(...parameters);
    const tails = new Map(tailRows.map(row => [JSON.stringify([row.scope, JSON.parse(row.group_key)]), {
        low10OutputTokensPerSecond: row.low, high10OutputTokensPerSecond: row.high,
    }]));
    const tailOf = (scope, key) => tails.get(JSON.stringify([scope, key]))
        || { low10OutputTokensPerSecond: null, high10OutputTokensPerSecond: null };
    const groups = new Map();
    for (const row of rows) {
        const key = JSON.stringify([row.provider, row.model, row.agent, row.effort, row.fast]);
        let bucket = groups.get(key);
        if (!bucket) {
            bucket = { ...empty(), provider: row.provider, model: row.model, agent: row.agent, effort: row.effort,
                fast: row.fast == null ? null : row.fast === 1, speedOutput: 0, speedMs: 0,
                ...tailOf('effort', JSON.parse(key)), speedTailMeans: {
                    provider: tailOf('provider', [row.provider]), total: tailOf('total', []),
                } };
            groups.set(key, bucket);
        }
        add(bucket, row);
        bucket.speedOutput += row.speed_output;
        bucket.speedMs += row.speed_ms;
    }
    return [...groups.values()];
}

const spec = (file, blob, edits, previousEditCount = 0) => ({ file: 'src/' + file, blob, edits,
    previousEditCounts: [].concat(previousEditCount) });
// 세션 없이 도는 백그라운드 호출은 기록용 이름을 넘겨 에이전트 미기록으로 남지 않게 한다.
const usageAgent = (file, blob, anchor, name) => spec(file, blob, [[anchor, `${anchor}\n        usageAgent: '${name}',`]]);
export const EFFORT_USAGE_PATCHES = [
    spec('runtime/shared/llm/usage-context.mjs', 'bdadfb0afa7548fd590256c51f6991afb7004ef9', [[
        'export const currentUsageContext = () => context.getStore();',
        `export const currentUsageContext = () => context.getStore();
export function noteRequestEffort(value) {
  const identity = context.getStore();
  if (!identity) return;
  identity.requestEffort = typeof value === 'string' && value.trim() ? value.trim() : null;
  if (identity.session) identity.session.paseodogRequestEffort = {
    effort: identity.requestEffort, at: Date.now(), model: identity.requestedModel,
  };
}`,
    ], [
        'identity.abandonedUsage.push({ usage: stored, model });',
        'identity.abandonedUsage.push({ usage: stored, model, requestEffort: identity.requestEffort });',
    ]]),
    spec('runtime/agent/orchestrator/providers/effort-configuration.mjs', '823aaaee381275d62bf56a95903eeb55e79ad3b9', [[
        "export const EFFORT_CONFIGURATION_BETA =",
        "import { noteRequestEffort } from '../../../shared/llm/usage-context.mjs';\n\nexport const EFFORT_CONFIGURATION_BETA =",
    ], [
        'export function projectEffortConfiguration(messages, provider, model, opts = {}) {',
        'export function projectEffortConfiguration(messages, provider, model, opts = {}) {\n  noteRequestEffort(opts.effort);',
    ], [
        '  return { mode, initialEffort: seed.initialEffort, effort: current, updates };',
        '  noteRequestEffort(current);\n  return { mode, initialEffort: seed.initialEffort, effort: current, updates };',
    ]]),
    spec('runtime/shared/llm/usage-accounting.mjs', '50788661666d0690dfc675d93b8013669caffd0e', [[
        "import { isNotedUsage, withUsageContext } from './usage-context.mjs';",
        "import { isNotedUsage, withUsageContext, noteRequestEffort } from './usage-context.mjs';",
    ], [
        '    requestedModel: model,\n    sessionId,',
        '    requestedModel: model,\n    session: opts.session,\n    requestEffort: null,\n    sessionId,',
    ], [
        '      sourceType,\n      inputTokens: usage.inputTokens,',
        "      sourceType,\n      effort: Object.hasOwn(result, 'requestEffort') ? result.requestEffort : identity.requestEffort,\n      agent: opts.session?.agent,\n      inputTokens: usage.inputTokens,",
    ], [
        '    result = await withUsageContext(identity, send);',
        '    result = await withUsageContext(identity, () => { noteRequestEffort(opts.effort); return send(); });',
    ], [
        '      agent: opts.session?.agent,',
        '      agent: opts.session?.agent,\n      fast: opts.fast === true,',
    ], [
        // 웹 검색 보조 호출은 세션 대신 role을, 백그라운드 호출은 usageAgent를 넘긴다.
        '      agent: opts.session?.agent,\n      fast:',
        '      agent: opts.session?.agent || opts.usageAgent || opts.role,\n      fast:',
    ]], [4, 5]),
    usageAgent('runtime/agent/orchestrator/agent-runtime/title-completion.mjs', '1f7fcb10f2fa5f1f7f35fc375ed498204679c4f6',
        '        maxOutputTokens: 128,', 'title-generator'),
    usageAgent('runtime/agent/orchestrator/agent-runtime/heartbeat-completion.mjs', 'c4a83c2f776b5e4ea597ec4736334d432d28ccdf',
        '        maxOutputTokens,', 'heartbeat'),
    usageAgent('runtime/agent/orchestrator/agent-runtime/room-supervisor-completion.mjs', '584de15de59328c4eebd91f97ad4681520d81ce7',
        '        maxOutputTokens: 400,', 'room-supervisor'),
    spec('session-runtime/services/provider-admin.mjs', '8ce26d0a5cc5636d0772aa8398b225743a20f346', [[
        '{ signal, maxTokens: 16 }',
        "{ signal, maxTokens: 16, usageAgent: 'provider-check' }",
    ]]),
    spec('runtime/shared/llm/usage-ledger.mjs', 'e7ce7a96316d3b06c02e34ae9d74fb69c3b2a860', [[
        '  readSessionUsage,\n',
        '  readSessionUsage,\n  readEffortUsage,\n',
    ], [
        '      ...(row.account ? [String(row.account)] : []),',
        "      ...(row.effort || row.agent ? [String(row.account || ''), row.effort || null, row.agent || null]\n        : row.account ? [String(row.account)] : []),",
    ], [
        '    sourceType: text(args.sourceType),',
        '    sourceType: text(args.sourceType),\n    effort: text(args.effort) || null,\n    agent: text(args.agent) || null,',
    ], [
        '  preserveLegacyDays(days) {',
        "  effortUsageAsync(options) {\n    if (this.path === ':memory:') return Promise.resolve().then(() => readEffortUsage(this.db, options));\n    return this.workerRequest('effortUsage', { options });\n  }\n\n  preserveLegacyDays(days) {",
    ], [
        "      ...(row.effort || row.agent ? [String(row.account || ''), row.effort || null, row.agent || null]\n        : row.account ? [String(row.account)] : []),",
        "      ...(row.effort || row.agent || typeof row.fast === 'boolean'\n        ? [String(row.account || ''), row.effort || null, row.agent || null, row.fast ?? null]\n        : row.account ? [String(row.account)] : []),",
    ], [
        '    agent: text(args.agent) || null,',
        "    agent: text(args.agent) || null,\n    fast: typeof args.fast === 'boolean' ? args.fast : null,",
    ]], 4),
    spec('runtime/shared/llm/usage-ledger-rollup.mjs', '924a03e8400e4efb23c4893efa921a3fd3de2f84', [[
        'export function readSessionUsage(db, sessionIds, ownerIds = []) {',
        `export ${previousRollupSource}\n\nexport function readSessionUsage(db, sessionIds, ownerIds = []) {`,
    ], [
        `export ${previousRollupSource}`,
        `export ${legacyReadEffortUsageSource}`,
    ], ...extremaRollupEdits, [
        `export ${legacyExtremaRollupSource}`,
        `export ${readEffortUsage.toString()}`,
    ]], [1, 2, 6]),
    spec('runtime/shared/llm/usage-ledger-worker.mjs', 'b9c6f15802aa8dad06a811f2db59eeaae395b8fc', [[
        "import { readSessionUsage, rollupDelta, rollupUsage } from './usage-ledger-rollup.mjs';",
        "import { readSessionUsage, readEffortUsage, rollupDelta, rollupUsage } from './usage-ledger-rollup.mjs';",
    ], [
        '  sessionUsage: ({ path, sessionIds, ownerIds }) => read(path, (db) => readSessionUsage(db, sessionIds, ownerIds)),',
        '  sessionUsage: ({ path, sessionIds, ownerIds }) => read(path, (db) => readSessionUsage(db, sessionIds, ownerIds)),\n  effortUsage: ({ path, options }) => read(path, (db) => readEffortUsage(db, options)),',
    ]]),
    spec('session-runtime/usage-stats-api.mjs', 'bc89b1f22ac721b764c2497770dc6efa77b469cd', [[
        '    async getUsageStats(options = {}) {',
        "    async getEffortUsageStats(options) {\n      const store = ledger();\n      if (!store) throw new Error('Usage ledger is unavailable');\n      await store.settleWrites();\n      return (await store.effortUsageAsync(options)).map((row) => ({\n        provider: row.provider, model: row.model, agent: row.agent, effort: row.effort,\n        ...sessionUsageSnapshot(row), costBilled: row.costBilled, costEstimated: row.costEstimated,\n      }));\n    },\n    async getUsageStats(options = {}) {",
    ], [
        '        provider: row.provider, model: row.model, agent: row.agent, effort: row.effort,',
        '        provider: row.provider, model: row.model, agent: row.agent, effort: row.effort,\n        fast: row.fast, speedOutput: row.speedOutput, speedMs: row.speedMs,',
    ], [
        '        fast: row.fast, speedOutput: row.speedOutput, speedMs: row.speedMs,',
        '        fast: row.fast, speedOutput: row.speedOutput, speedMs: row.speedMs,\n        minOutputTokensPerSecond: row.minOutputTokensPerSecond, maxOutputTokensPerSecond: row.maxOutputTokensPerSecond,',
    ], [
        '        minOutputTokensPerSecond: row.minOutputTokensPerSecond, maxOutputTokensPerSecond: row.maxOutputTokensPerSecond,',
        '        low10OutputTokensPerSecond: row.low10OutputTokensPerSecond, high10OutputTokensPerSecond: row.high10OutputTokensPerSecond,\n        speedTailMeans: row.speedTailMeans,',
    ]], [1, 2, 3]),
];

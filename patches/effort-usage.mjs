// Request metadata extends the existing route signature; no ledger rows are rewritten.
export function readEffortUsage(db, { fromMs, toMs }) {
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

// 이전 패치의 정확한 본문만 복원해 기존 설치본도 같은 원본 blob 검사를 거친다.
const previousRollupSource = readEffortUsage.toString()
    .replace('SUM(duration_ms) AS duration_ms,\n                SUM(CASE WHEN duration_ms>0 AND output>0 THEN output ELSE 0 END) AS speed_output,\n                SUM(CASE WHEN duration_ms>0 AND output>0 THEN duration_ms ELSE 0 END) AS speed_ms', 'SUM(duration_ms) AS duration_ms')
    .replace("                json_extract(r.signature,'$[11]') AS fast,\n", '')
    .replace('g.duration_ms,g.speed_output,g.speed_ms', 'g.duration_ms')
    .replace('row.agent, row.effort, row.fast]', 'row.agent, row.effort]')
    .replace('effort: row.effort,\n                fast: row.fast == null ? null : row.fast === 1, speedOutput: 0, speedMs: 0 };', 'effort: row.effort };')
    .replace('        bucket.speedOutput += row.speed_output;\n        bucket.speedMs += row.speed_ms;\n', '');
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
        `export ${readEffortUsage.toString()}`,
    ], [
        'SUM(CASE WHEN duration_ms>0 AND output>0 THEN duration_ms ELSE 0 END) AS speed_ms',
        `SUM(CASE WHEN duration_ms>0 AND output>0 THEN duration_ms ELSE 0 END) AS speed_ms,
                MIN(CASE WHEN duration_ms>0 AND output>0 THEN output*1000.0/duration_ms END) AS speed_min,
                MAX(CASE WHEN duration_ms>0 AND output>0 THEN output*1000.0/duration_ms END) AS speed_max`,
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
    ]], [1, 2]),
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
    ]], [1, 2]),
];

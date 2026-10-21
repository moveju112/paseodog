// Request metadata extends the existing route signature; no ledger rows are rewritten.
export function readEffortUsage(db, { fromMs, toMs }) {
    if (!Number.isSafeInteger(fromMs) || !Number.isSafeInteger(toMs) || fromMs < 0 || toMs < fromMs)
        throw new Error('Invalid effort usage period');
    const rows = db.prepare(`
        WITH grouped AS (
            SELECT day,route,COUNT(*) AS turns,SUM(input) AS input,SUM(output) AS output,
                SUM(cache_read) AS cache_read,SUM(cache_write) AS cache_write,
                SUM(cost_usd) AS cost_usd,SUM(duration_ms) AS duration_ms
            FROM usage_events WHERE ts>=? AND ts<=? GROUP BY day,route
        ), attributed AS (
            SELECT printf('%04d-%02d-%02d',g.day/10000,(g.day/100)%100,g.day%100) AS day,
                json_extract(r.signature,'$[0]') AS provider,
                json_extract(r.signature,'$[1]') AS model,
                json_extract(r.signature,'$[4]') AS cost_source,
                json_extract(r.signature,'$[7]') AS rank,
                json_extract(r.signature,'$[9]') AS effort,
                json_extract(r.signature,'$[10]') AS agent,
                COALESCE(json_extract(json_extract(r.signature,'$[5]'),'$.inputTokensKnown'),1)=0 AS unmeasured,
                g.turns,g.input,g.output,g.cache_read,g.cache_write,g.cost_usd,g.duration_ms
            FROM grouped g JOIN usage_routes r ON r.id=g.route
        ), best AS (
            SELECT day,provider,model,MIN(rank) AS rank FROM daily
            WHERE day BETWEEN ? AND ? GROUP BY day,provider,model
        )
        SELECT a.* FROM attributed a JOIN best USING(day,provider,model,rank)
    `).all(fromMs, toMs, usageRollupDayKey(fromMs), usageRollupDayKey(toMs));
    const groups = new Map();
    for (const row of rows) {
        const key = JSON.stringify([row.provider, row.model, row.agent, row.effort]);
        let bucket = groups.get(key);
        if (!bucket) {
            bucket = { ...empty(), provider: row.provider, model: row.model, agent: row.agent, effort: row.effort };
            groups.set(key, bucket);
        }
        add(bucket, row);
    }
    return [...groups.values()];
}

const spec = (file, blob, edits) => ({ file: 'src/' + file, blob, edits });
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
    spec('runtime/agent/orchestrator/providers/effort-configuration.mjs', '0090d911213d935ac9817aab87643997abc9d3bf', [[
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
    ]]),
    spec('runtime/shared/llm/usage-ledger-rollup.mjs', '924a03e8400e4efb23c4893efa921a3fd3de2f84', [[
        'export function readSessionUsage(db, sessionIds, ownerIds = []) {',
        `export ${readEffortUsage.toString()}\n\nexport function readSessionUsage(db, sessionIds, ownerIds = []) {`,
    ]]),
    spec('runtime/shared/llm/usage-ledger-worker.mjs', 'b9c6f15802aa8dad06a811f2db59eeaae395b8fc', [[
        "import { readSessionUsage, rollupDelta, rollupUsage } from './usage-ledger-rollup.mjs';",
        "import { readSessionUsage, readEffortUsage, rollupDelta, rollupUsage } from './usage-ledger-rollup.mjs';",
    ], [
        '  sessionUsage: ({ path, sessionIds, ownerIds }) => read(path, (db) => readSessionUsage(db, sessionIds, ownerIds)),',
        '  sessionUsage: ({ path, sessionIds, ownerIds }) => read(path, (db) => readSessionUsage(db, sessionIds, ownerIds)),\n  effortUsage: ({ path, options }) => read(path, (db) => readEffortUsage(db, options)),',
    ]]),
    spec('session-runtime/usage-stats-api.mjs', 'd1ffc18558c5db7497718b3752b2f417a74c0dd9', [[
        '    async getUsageStats(options = {}) {',
        "    async getEffortUsageStats(options) {\n      const store = ledger();\n      if (!store) throw new Error('Usage ledger is unavailable');\n      await store.settleWrites();\n      return (await store.effortUsageAsync(options)).map((row) => ({\n        provider: row.provider, model: row.model, agent: row.agent, effort: row.effort,\n        ...sessionUsageSnapshot(row), costBilled: row.costBilled, costEstimated: row.costEstimated,\n      }));\n    },\n    async getUsageStats(options = {}) {",
    ]]),
];

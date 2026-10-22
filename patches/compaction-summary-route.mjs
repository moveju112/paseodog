// 명시한 요약 모델은 유지보수 모델보다 우선하며 실제 공급자 인스턴스로 전달한다.
export const COMPACTION_SUMMARY_ROUTE_PATCH = {
    file: 'src/runtime/agent/orchestrator/session/loop/fresh-context.mjs',
    blob: 'a4bdb293a9eefe68dee178c25adda6cc6d300ae9',
    edits: [[
        '  const route =\n    allowMaintenance && builtinFeatureActive(config, \'memory\') && config.recap?.enabled !== false',
        `  // PaseoDog: 명시한 provider/model을 분리하고 비활성 공급자로 우회하지 않는다.
  const summary = sessionRef?.compaction?.summaryModel || config.compaction?.summaryModel;
  const separator = typeof summary === 'string' ? summary.indexOf('/') : -1;
  const explicitRoute = summary ? {
    provider: separator > 0 ? summary.slice(0, separator) : sessionRef?.provider || provider?.name,
    model: separator > 0 ? summary.slice(separator + 1) : summary,
  } : null;
  if (explicitRoute && config.providers?.[explicitRoute.provider]?.enabled === false)
    throw new Error('compact summary provider is disabled: ' + explicitRoute.provider);
  const route = explicitRoute || (
    allowMaintenance && builtinFeatureActive(config, 'memory') && config.recap?.enabled !== false`,
    ], [
        "      : null;\n  const useMaintenance",
        "      : null);\n  const useMaintenance",
    ], [
        "    source: useMaintenance ? 'maintenance' : 'session',",
        "    source: explicitRoute ? 'summary' : useMaintenance ? 'maintenance' : 'session',",
    ]],
};

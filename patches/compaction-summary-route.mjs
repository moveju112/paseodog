// 명시한 요약 모델은 upstream의 자동 선택 정책보다 우선하고 다른 모델로 폴백하지 않는다.
export const COMPACTION_SUMMARY_ROUTE_PATCH = {
    file: 'src/runtime/agent/orchestrator/session/loop/fresh-context.mjs',
    blob: '06f24d49b71be3140742811fa83a734948ede005',
    previousEditCount: 1,
    edits: [[
        '  const mode = normalizeCompactionSummaryMode(config.compaction);',
        `  // PaseoDog: summaryModel은 summaryMode와 다른 명시적 모델 선택이다.
  const summary = sessionRef?.compaction?.summaryModel || config.compaction?.summaryModel;
  if (summary) {
    const separator = summary.indexOf('/');
    const providerName = separator > 0 ? summary.slice(0, separator) : sessionRef?.provider || provider?.name;
    const summaryModel = separator > 0 ? summary.slice(separator + 1) : summary;
    if (config.providers?.[providerName]?.enabled === false)
      throw new Error('compact summary provider is disabled: ' + providerName);
    const explicit = async () => {
      const sameProvider = providerName === (sessionRef?.provider || provider?.name);
      if (!sameProvider) await initProvidersFn(config.providers || {}, { signal });
      signal?.throwIfAborted();
      return summaryRoute({
        sessionRef,
        provider: sameProvider && provider ? provider : getProviderFn(providerName),
        providerName,
        model: summaryModel,
        source: 'summary',
      });
    };
    return { mode: 'explicit', warm: compactionCacheWarm(sessionId, now), steps: [explicit] };
  }
  const mode = normalizeCompactionSummaryMode(config.compaction);`,
    ], [
        '  const input = { sessionRef, provider, model, config, signal, getProviderFn, initProvidersFn };',
        `  const input = { sessionRef, provider, model, config, signal, getProviderFn, initProvidersFn };
  // PaseoDog: 전용 압축 에이전트가 켜져 있고 모델을 선택했을 때만 이 경로를 쓴다.
  const compressor = resolveMaintenanceRoute({ agent: 'context-compressor', config, includeDefault: false });
  if (compressor) {
    const independent = async () => {
      await initProvidersFn(config.providers || {}, { signal });
      signal?.throwIfAborted();
      return summaryRoute({
        sessionRef,
        provider: getProviderFn(compressor.provider),
        providerName: compressor.provider,
        model: compressor.model,
        fast: compressor.fast,
        source: 'context-compressor',
      });
    };
    return { mode: 'explicit', warm: compactionCacheWarm(sessionId, now), steps: [independent] };
  }`,
    ]],
};

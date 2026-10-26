// 제목·압축은 각자 선택한 모델만 사용하고 메인·메인테이너 모델을 상속하지 않는다.
export const SESSION_TITLE_ROUTE_PATCH = {
    file: 'src/runtime/agent/orchestrator/agent-runtime/maintenance-route.mjs',
    blob: 'df81bc391dc0f41fe8941ab5666ba8201057263c',
    edits: [[
        '  const hidden = getHiddenAgent(agent);',
        `  // PaseoDog: 숨겨진 실행 역할은 편집 가능한 기본 에이전트의 독립 경로에 연결한다.
  const independentRole = agent === 'title-agent' ? 'title-generator'
    : agent === 'context-compressor' ? 'context-compressor' : '';
  if (independentRole) {
    const config = cfgIn || loadConfig({ secrets: false });
    if (isAgentDisabled(config, independentRole)) return null;
    const route = normalizeMaintenanceCandidate(configuredAgentRouteCandidates(config, independentRole)[0]);
    return route && config.providers?.[route.provider]?.enabled !== false ? route : null;
  }
  const hidden = getHiddenAgent(agent);`,
    ]],
};

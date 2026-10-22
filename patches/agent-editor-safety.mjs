// 모델 경로의 비동기 검증을 파일 쓰기보다 먼저 끝내고 동기 적용만 남긴다.
// 같은 파일의 기존 경로 패치 뒤에 이어 붙여 한 spec으로 원본 해시를 검증한다.
export const AGENT_ROUTE_SAFETY_EDITS = [
            [
                '  async function setAgentRoute(agentId, next) {',
                `  // 편집 저장은 검증된 경로의 적용 함수를 받아 본문 검증 후 실행한다.
  async function setAgentRoute(agentId, next, options = {}) {
    // 준비 모드에서는 설정을 쓰지 않고 동기 적용 함수만 반환한다.
    const commit = (write) => options.prepareOnly === true ? write : write();`,
            ],
            ['    if (onlyIfEmpty && clean(stored.provider)) return kept();',
                '    if (onlyIfEmpty && clean(stored.provider)) return commit(kept);'],
            ['    if (keepOff && !(clean(requested.provider) && clean(requested.model))) {\n      saveDisabled(id, true);',
                '    if (keepOff && !(clean(requested.provider) && clean(requested.model))) return commit(() => {\n      saveDisabled(id, true);'],
            ['      return { ...stored, id, disabled: true };\n    }',
                '      return { ...stored, id, disabled: true };\n    });'],
            ["    if (requested.disabled === false && Object.keys(requested).length === 1) {",
                "    if (requested.disabled === false && Object.keys(requested).length === 1) return commit(() => {"],
            ['      return { ...stored, id, disabled: false, inherited: !stored.provider };\n    }',
                '      return { ...stored, id, disabled: false, inherited: !stored.provider };\n    });'],
            ["    if (!clean(requested.provider)) {\n      if (next?.disabled === false)",
                "    if (!clean(requested.provider)) return commit(() => {\n      if (next?.disabled === false)"],
            ['      return clearOverride(id);\n    }\n    if (!clean(requested.model))',
                '      return clearOverride(id);\n    });\n    if (!clean(requested.model))'],
            ['    if (onlyIfEmpty && !isMixy(id) && !storeBot(id)) deps.reloadFullConfig?.();',
                '    return commit(() => {\n    if (onlyIfEmpty && !isMixy(id) && !storeBot(id)) deps.reloadFullConfig?.();'],
            ['    return stayOff ? { ...routeToSave, id, disabled: true } : routeToSave;',
                '    return stayOff ? { ...routeToSave, id, disabled: true } : routeToSave;\n    });'],
];
export const AGENT_EDITOR_SAFETY_PATCHES = [
    {
        file: 'src/session-runtime/workflow-agents-api/agent-editor.mjs',
        blob: '39ac04cc6e87e68655b65e305fb522bf509bced1',
        edits: [
            [
                "    // Opt-in (the agent profile): without `expectedRevision` the last write\n    // wins, as for the Workflows editor and the setup tool.\n    if (hasOwn(payload, 'expectedRevision') && String(payload.expectedRevision) !== definitionRevision(dataDir, id)) {\n      const conflict = new Error(`${AGENT_DEFINITION_CONFLICT}: agent \"${id}\" changed since it was loaded`);\n      conflict.code = AGENT_DEFINITION_CONFLICT;\n      throw conflict;\n    }",
                `    // 생성 충돌·수정 충돌은 모델 조회 전후에 검사해 대기 중 변경도 보존한다.
    function assertWritable() {
      if (payload.createOnly === true && loadAgentDefinition(dataDir, id)) {
        throw new Error('Agent already exists; choose a different id');
      }
      if (hasOwn(payload, 'expectedRevision') && String(payload.expectedRevision) !== definitionRevision(dataDir, id)) {
        const conflict = new Error(AGENT_DEFINITION_CONFLICT + ': agent changed since it was loaded');
        conflict.code = AGENT_DEFINITION_CONFLICT;
        throw conflict;
      }
    }
    assertWritable();
    const applyRoute = payload.route ? await setAgentRoute(id, payload.route, { prepareOnly: true }) : null;
    assertWritable();`,
            ],
            ['    if (payload.route) await setAgentRoute(id, payload.route);',
                '    if (applyRoute) applyRoute();'],
        ],
    },
];

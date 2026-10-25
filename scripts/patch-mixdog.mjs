import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EFFORT_USAGE_PATCHES } from '../patches/effort-usage.mjs';
import { DEFAULT_OUTPUT_STYLE_PATCHES } from '../patches/default-output-style.mjs';
import { COMPACTION_SUMMARY_ROUTE_PATCH } from '../patches/compaction-summary-route.mjs';
import { AGENT_ROUTE_SAFETY_EDITS, AGENT_EDITOR_SAFETY_PATCHES } from '../patches/agent-editor-safety.mjs';
export const PIN = '1.3.5';
export const ORIGINAL_BLOB = '3adfd3eeb9f354198de89d6651647d8f9afc6321';
export const ANCHOR = '      const turnContext = await dispatchPromptSubmit(turn, session0, prompt, options);';
export const ADDITION = '\n      // PaseoDog host-policy boundary v1 (local Apache-2.0 modification).\n      if (typeof options.beforeSessionAsk === \'function\') {\n        await options.beforeSessionAsk(session0);\n      }';
export const MARKER = 'PaseoDog host-policy boundary v1';
export const AGENT_PATCHES = [
    ...AGENT_EDITOR_SAFETY_PATCHES,
    COMPACTION_SUMMARY_ROUTE_PATCH,
    ...EFFORT_USAGE_PATCHES,
    ...DEFAULT_OUTPUT_STYLE_PATCHES,
    {
        // local: 단계가 늦게 오는 응답도 원래 메시지 경계와 함께 보존한다.
        file: 'src/runtime/agent/orchestrator/providers/lib/send-callbacks.mjs',
        blob: '5c218137f88094953ff5199172b1f9479c5ead9b',
        edits: [[
            "  if (type === 'message' && ASSISTANT_PHASES.has(item.phase)) return { kind: 'text', phase: item.phase };",
            "  if (type === 'message') return { kind: 'text', ...(item.id ? { messageId: item.id } : {}),\n    ...(ASSISTANT_PHASES.has(item.phase) ? { phase: item.phase } : {}) };",
        ]],
    },
    {
        // local: 같은 모델의 컨텍스트 변경도 네이티브 세션·영속 기록에 즉시 반영한다.
        file: 'src/session-runtime/model-route/set-route.mjs',
        blob: '818452668b601bd4a3ed6b5fa432951abba92ced',
        edits: [[
            '      persist.applySessionTuning();\n      refreshSessionFallbacks(deps, session);',
            '      persist.applySessionTuning();\n      // 컨텍스트 선택도 기존 네이티브 경로 갱신·저장 함수를 사용한다.\n      if (session && (route.contextPercent !== session.contextPercent\n        || (route.contextTokens || null) !== (session.contextTokens || null)\n        || route.selectedContextWindow !== session.selectedContextWindow)) {\n        updateSessionInPlace(deps, session);\n      }\n      refreshSessionFallbacks(deps, session);',
        ]],
    },
    {
        file: 'src/runtime/agent/orchestrator/session/manager/pending-messages.mjs',
        blob: 'f382c402d98a37133cbe17bc7ffdf514ac66e66c',
        edits: [[
            '// Drain order: enqueue time, then source (hydrated < buffered < memory), then',
            "// 호스트가 검증한 즉시 지시와 알림만 중간 경계에서 소모한다.\nexport function pendingQueueHoldsOnlyHostSteering(sessionId) {\n  const queued = [\n    ...(_sessionPendingMessages.get(sessionId) || []),\n    ...(_hydratedPendingMessages.get(sessionId) || []),\n  ];\n  return queued.length > 0 && queued.every((entry) =>\n    entry.options?.paseodogSteering === true || pendingEntryMode(entry) === PENDING_MODE_TASK_NOTIFICATION\n  );\n}\n\n// Drain order: enqueue time, then source (hydrated < buffered < memory), then",
        ]],
    },
    {
        file: 'src/runtime/agent/orchestrator/session/manager/ask-turn-steering-drain.mjs',
        blob: 'a5563b17f6430d631c3704d123a29e1a687e6a7a',
        edits: [[
            '  pendingQueueHoldsOnlyNotifications,\n',
            '  pendingQueueHoldsOnlyNotifications,\n  pendingQueueHoldsOnlyHostSteering,\n',
        ], [
            "    if (drainOptions?.stage === 'terminal' || pendingQueueHoldsOnlyNotifications(sessionId)) {",
            "    if (drainOptions?.stage === 'terminal' || pendingQueueHoldsOnlyNotifications(sessionId)\n      || (askOpts.hostSteering === true && pendingQueueHoldsOnlyHostSteering(sessionId))) {",
        ]],
    },
    {
        file: 'src/runtime/agent/orchestrator/runtime-core/workflow/packs.mjs',
        blob: 'bafa52c74e6d9eda6ea14a08bc7d1957d5740da3',
        previousEditCount: 6,
        edits: [
            [
                "const WORKFLOW_ENTRY = 'WORKFLOW.md';",
                "const WORKFLOW_ENTRY = 'WORKFLOW.md';\n// 사용 안 함은 파일을 읽지 않는 예약된 가상 워크플로다.\nconst NO_WORKFLOW = Object.freeze({ id: 'none', name: '사용 안 함', description: '', body: '', source: 'built-in' });",
            ],
            [
                '    if (!body) return null;',
                '    if (!body && !doc.frontmatter?.id) return null;',
            ],
            [
                '    const byId = new Map();',
                "    const byId = new Map([['none', NO_WORKFLOW]]);",
            ],
            [
                '        if (!entry.isDirectory()) continue;',
                "        if (!entry.isDirectory() || entry.name === 'none') continue;",
            ],
            [
                '    const wanted = wantedWorkflowId(id);\n    return packCache.fresh',
                "    const wanted = wantedWorkflowId(id);\n    if (wanted === 'none') return NO_WORKFLOW;\n    return packCache.fresh",
            ],
            [
                '    const wanted = wantedWorkflowId(id);\n    return packCache.shared',
                "    const wanted = wantedWorkflowId(id);\n    if (wanted === 'none') return NO_WORKFLOW;\n    return packCache.shared",
            ],
            [
                '    return wantedWorkflowId(config?.workflow?.active);',
                "    return wantedWorkflowId(config?.workflow?.active || 'none');",
            ],
        ],
    },
    {
        file: 'src/runtime/agent/orchestrator/config.mjs',
        blob: '4ac0ebe7a262e91ff9282992aab4d3392be3d8e6',
        edits: [
            [
                "    disabledAgents: [...DEFAULT_DISABLED_AGENT_ROSTER],\n    workflow: { active: 'default' },",
                "    disabledAgents: [...DEFAULT_DISABLED_AGENT_ROSTER],\n    workflow: { active: 'none' },",
            ],
            [
                "    agents: {},\n    workflow: { active: 'default' },",
                "    agents: {},\n    workflow: { active: 'none' },",
            ],
        ],
    },
    {
        file: 'src/runtime/shared/orchestration.mjs',
        blob: '22b2379c040afc63a93d4102f72d852da29c1f7d',
        edits: [[
            "  const active = String(config?.workflow?.active || 'default');",
            "  const active = String(config?.workflow?.active || 'none');",
        ]],
    },
    {
        file: 'src/runtime/agent/orchestrator/runtime-core/workflow/context.mjs',
        blob: '77187cec8a9fc824f2167ee351f05d5b99d8c060',
        edits: [[
            "    if (!pack) return '';",
            "    if (!pack || pack.id === 'none' || !String(pack.body || '').trim()) return '';",
        ]],
    },
    {
        file: 'src/session-runtime/workflow-agents-api/workflow-packs.mjs',
        blob: '4ed20e2f010211fc2165f031cdde1be6b05c3c9d',
        edits: [[
            "    const body = String(payload.body || '').trim();\n    if (!body) throw new Error('WORKFLOW.md body must not be empty');",
            "    if (id === 'none') throw new Error('none is reserved for disabled workflow instructions');\n    const body = String(payload.body || '').trim();",
        ], [
            '    return getWorkflowPack(id);',
            "    // 활성 워크플로우를 비우면 파일을 읽지 않는 사용 안 함 상태로 전환한다.\n    if (!body && activeWorkflowId(getConfig()) === id) saveActiveWorkflow('none');\n    return getWorkflowPack(id);",
        ], [
            '  async function setWorkflow(workflowId, options = {}) {',
            '  async function setWorkflow(workflowId, options = {}) {\n    // 호스트의 턴 전 갱신은 설정 파일을 다시 쓰지 않는다.\n    const persist = options?.persist !== false;',
        ], [
            '    saveActiveWorkflow(id);\n    const applied = await deps.refreshEmptySessionToolPolicy?.();',
            "    if (persist) saveActiveWorkflow(id);\n    else getConfig().workflow = { ...(getConfig().workflow || {}), active: id };\n    const applied = await deps.refreshEmptySessionToolPolicy?.({ workflowOnly: true });",
        ]],
    },
    {
        file: 'src/session-runtime/tool-policy-refresh.mjs',
        blob: '9cc3243f0972883b754b5a99e80eb0f52afa6754',
        edits: [
            [
                "import { rewriteBp3Core } from './tool-policy/surface-helpers.mjs';",
                "import { bp3Message, presentedBp3Core, rewriteBp3Core } from './tool-policy/surface-helpers.mjs';\nimport { toSessionWorkflowMeta } from '../runtime/agent/orchestrator/runtime-core/workflow.mjs';\nimport { markToolSurfaceMigrated } from '../runtime/agent/orchestrator/session/loop/tool-exposure-migration.mjs';",
            ],
            [
                '  function admitsRefresh(session) {',
                '  function admitsRefresh(session, workflowOnly = false) {',
            ],
            [
                '      !sessionHasConversationMessages(session) &&\n      !sessionHasConversationMessages({ messages: session.liveTurnMessages })',
                '      (workflowOnly || (!sessionHasConversationMessages(session) &&\n      !sessionHasConversationMessages({ messages: session.liveTurnMessages })))',
            ],
            [
                '  async function refreshEmptySessionToolPolicy() {',
                '  async function refreshEmptySessionToolPolicy({ workflowOnly = false } = {}) {',
            ],
            [
                '    if (!admitsRefresh(session)) return { appliedToCurrentSession: false };\n    // Older records',
                '    if (!admitsRefresh(session, workflowOnly)) return { appliedToCurrentSession: false, reason: \'turn-in-flight\' };\n    // Older records',
            ],
            [
                '    const staged = await stagePolicy(session, identity, getConfig());\n    // Apply: re-check admission after the await, then mutate synchronously.',
                "    const staged = await stagePolicy(session, identity, getConfig(), { workflowOnly });\n    // Preserve schemas and the entire conversation when only workflow instructions change.\n    if (workflowOnly) {\n      if (!admitsRefresh(session, true)) return { appliedToCurrentSession: false, reason: 'turn-in-flight' };\n      if (!bp3Message(session)) return { appliedToCurrentSession: false, reason: 'missing-workflow-context' };\n      session.workflow = toSessionWorkflowMeta(staged.workflow);\n      session.orchestrationMode = staged.orchestrationMode;\n      session.updatedAt = Date.now();\n      if (staged.core !== presentedBp3Core(session)) {\n        rewriteBp3Core(session, staged.core);\n        markToolSurfaceMigrated(session, 'workflow_switch');\n      }\n      return { appliedToCurrentSession: true };\n    }\n    // Apply: re-check admission after the await, then mutate synchronously.",
            ],
        ],
    },
    {
        file: 'src/session-runtime/tool-policy/policy-stage.mjs',
        blob: '7a7dc01062c33bbd1a3da4aed4d12caaed0ebe62',
        edits: [[
            '  async function stagePolicy(session, identity, config, { conversation = false } = {}) {',
            '  async function stagePolicy(session, identity, config, { conversation = false, workflowOnly = false } = {}) {',
        ], [
            "    const coreMemoryContext = conversation ? '' : await leadCoreMemoryContext();",
            "    // 워크플로 갱신 실패가 기존 기억을 지우지 않게 오류를 전파한다.\n    const coreMemoryContext = conversation ? '' : workflowOnly ? await loadCoreMemoryContext() : await leadCoreMemoryContext();",
        ]],
    },
    {
        file: 'src/session-runtime/tool-policy/surface-helpers.mjs',
        blob: '30f001be760a15f33c3711604fdcee9d04a97de2',
        edits: [['function bp3Message(session) {', 'export function bp3Message(session) {']],
    },
    {
        file: 'src/session-runtime/boot/providers.mjs',
        blob: 'f1920df6a285ff24c91d4cfa8f1f93772e8ed465',
        edits: [[
            '    resolveRoute,\n    cfgMod,\n    sharedCfgMod,',
            '    resolveRoute,\n    // 최신 설정을 읽되 호스트의 MCP·자동 실행 제한을 유지한다.\n    cfgMod: boot.params.initialConfig ? { ...cfgMod, loadConfig: (...args) => { const latest = cfgMod.loadConfig(...args); return { ...latest, mcpServers: boot.params.initialConfig.mcpServers, heartbeat: false, update: { ...latest.update, auto: false } }; } } : cfgMod,\n    sharedCfgMod,',
        ]],
    },
    {
        file: 'src/runtime/shared/profile-config.cjs',
        blob: '5b287f59843d119b76681d47939a38ccf083a97d',
        edits: [[
            "  { id: 'expert', label: 'Expert' },",
            "  { id: 'senior', label: 'Senior' },\n  { id: 'expert', label: 'Expert' },",
        ], [
            "  expert:\n",
            "  senior:\n    'Assume advanced development experience; focus on implementation tradeoffs, constraints, and correctness rather than introductory explanations.',\n  expert:\n",
        ]],
    },
    {
        file: 'src/session-runtime/turn/turn-run/ask-callbacks.mjs',
        blob: '8cfc5ed66535e233581861995d93d9776b608036',
        edits: [[
            '      beforeToolExecution: () => turn.snapshot.promise || Promise.resolve(),',
            '      hostManagedCompletions: options.hostManagedCompletions === true,\n      hostSteering: options.hostSteering === true,\n      beforeToolExecution: () => turn.snapshot.promise || Promise.resolve(),',
        ]],
    },
    {
        file: 'src/runtime/agent/orchestrator/session/manager/ask-session.mjs',
        blob: '905882d22e0555c629cd331d5280a1c307a56b0d',
        edits: [[
            '  const kickFollowUpAsk = () => {',
            '  const kickFollowUpAsk = () => {\n    if (askOpts.hostManagedCompletions === true) return;',
        ]],
    },
    {
        file: 'src/session-runtime/runtime-core.mjs',
        blob: '14ae394742a849f5cfd5bdc18123d9779ec6a7d3',
        edits: [
            ['  executeAgentControl = null,', '  agentSessionSurface = null,\n  executeAgentControl = null,'],
            ['    executeAgentControl,\n', '    agentSessionSurface,\n    executeAgentControl,\n'],
        ],
    },
    {
        file: 'src/session-runtime/boot/tools.mjs',
        blob: '44c706cf7c706f3fd9a7294a71e4f82faead409f',
        edits: [[
            '    // SubagentStart/SubagentStop: bridge internal worker spawn/finish to the',
            '    sessionSurface: params.agentSessionSurface?.({ mgr, getAgentTool: () => boot.routedAgentTool }),\n    // SubagentStart/SubagentStop: bridge internal worker spawn/finish to the',
        ], [
            '  const agentTool = createStandaloneAgent({\n    cfgMod,',
            '  const agentTool = createStandaloneAgent({\n    cfgMod: params.agentSessionSurface ? { ...cfgMod, loadConfig: () => rt.config } : cfgMod,',
        ]],
    },
    {
        file: 'src/session-runtime/settings-compaction-api.mjs',
        blob: '3cca7cd6f5febaea72271209a36e0066e064308d',
        edits: [[
            '  if (hasOwn(input, \'onModelChange\')) next.onModelChange = input.onModelChange !== false;',
            '  if (hasOwn(input, \'onModelChange\')) next.onModelChange = input.onModelChange !== false;\n  if (hasOwn(input, \'summaryModel\')) {\n    if (input.summaryModel) next.summaryModel = String(input.summaryModel).trim();\n    else delete next.summaryModel;\n  }',
        ], [
            "const SESSION_COMPACTION_KEYS = [\n",
            "const SESSION_COMPACTION_KEYS = [\n  'summaryModel',\n",
        ]],
    },
    {
        file: 'src/runtime/shared/instruction-files-mode.mjs',
        blob: '79316da38d2f5f0fca09b0dcbb015a2de8d5bde9',
        edits: [[
            'export const DEFAULT_INSTRUCTION_FILES_MODE = \'off\';',
            'export const DEFAULT_INSTRUCTION_FILES_MODE = \'all\';',
        ]],
    },
    {
        file: 'src/runtime/agent/orchestrator/context/instruction-files.mjs',
        blob: 'f904b1711b2d2d2caca200abd70f205304b071d5',
        edits: [
            [
                'export function effectiveInstructionFilesMode(mode) {\n  if (featureEnvOverride(\'MIXDOG_BOOT_INSTRUCTION_FILES\') === false) return \'off\';\n  return normalizeInstructionFilesMode(mode);\n}',
                'export function effectiveInstructionFilesMode(mode) {\n  if (featureEnvOverride(\'MIXDOG_BOOT_INSTRUCTION_FILES\') === false) return \'off\';\n  return normalizeInstructionFilesMode(mode);\n}\n\nexport function resolveInstructionFilesModeForModel(mode, { provider, model } = {}) {\n  const effective = effectiveInstructionFilesMode(mode);\n  if (effective !== \'all\') return effective;\n  const tag = `${String(provider || \'\')}/${String(model || \'\')}`.toLowerCase();\n  if (tag.includes(\'claude\') || tag.includes(\'anthropic\')) return \'claude\';\n  if (tag.includes(\'openai\') || tag.includes(\'codex\') || tag.includes(\'gpt-\')) return \'agents\';\n  return \'all\';\n}',
            ],
            [
                'function instructionFileCandidates({ mode, cwd, homeDir = homedir() } = {}) {\n  const kinds = KINDS_BY_MODE[effectiveInstructionFilesMode(mode)];',
                'function instructionFileCandidates({ mode, cwd, homeDir = homedir(), provider, model } = {}) {\n  const kinds = KINDS_BY_MODE[resolveInstructionFilesModeForModel(mode, { provider, model })];',
            ],
            [
                'export function loadInstructionFilesContext({ mode, cwd, homeDir = homedir() } = {}) {\n  const seen = new Set();\n  const sections = [];\n  for (const candidate of instructionFileCandidates({ mode, cwd, homeDir })) {',
                'export function loadInstructionFilesContext({ mode, cwd, homeDir = homedir(), provider, model } = {}) {\n  const seen = new Set();\n  const sections = [];\n  for (const candidate of instructionFileCandidates({ mode, cwd, homeDir, provider, model })) {',
            ],
        ],
    },
    {
        file: 'src/runtime/agent/orchestrator/session/manager/session-prompt-composition.mjs',
        blob: '961f27afcb8cdc378264a7110c71689a501e73ee',
        edits: [
            [
                '        : loadInstructionFilesContext({ mode: configuredInstructionFilesMode(), cwd }),',
                '        : loadInstructionFilesContext({ mode: configuredInstructionFilesMode(), cwd, provider: session?.provider, model: session?.model }),',
            ],
            [
                '      : loadInstructionFilesContext({ mode: configuredInstructionFilesMode(), cwd: opts.cwd });',
                '      : loadInstructionFilesContext({ mode: configuredInstructionFilesMode(), cwd: opts.cwd, provider: providerName, model: modelName });',
            ],
        ],
    },
    {
        file: 'src/session-runtime/boot/apis.mjs',
        blob: '8de983eab6765243bcf765d3b6729a870c4401e1',
        edits: [[
            '        : loadInstructionFilesContext({ mode: rt.config?.instructionFiles, cwd: session.cwd }),',
            '        : loadInstructionFilesContext({ mode: rt.config?.instructionFiles, cwd: session.cwd, provider: rt.route?.provider || session?.provider, model: rt.route?.model || session?.model }),',
        ]],
    },
    {
        file: 'src/session-runtime/workflow-agents-api/shared.mjs',
        blob: '42c8bda29dfa0ff1aeacc0f32fe7da7573427bb2',
        edits: [[
            'export function effectiveAgentRoute({ agentRouteFromConfig, resolveRoute }, config, agentId) {\n  return agentRouteFromConfig(config, agentId) || normalizeWorkflowRoute(resolveRoute(config, {}));\n}',
            'export function effectiveAgentRoute({ agentRouteFromConfig, resolveRoute }, config, agentId) {\n  void resolveRoute;\n  return agentRouteFromConfig(config, agentId) || { provider: \'\', model: \'\', effort: \'\', fast: false, autoEffort: true, inherited: true };\n}',
        ]],
    },
    {
        file: 'src/session-runtime/workflow-agents-api/agent-route.mjs',
        blob: 'ac4a9ba8eb8ff0af8b71cd735388681b1018ee13',
        edits: [
            [
                "    const inherited = normalizeWorkflowRoute(resolveRoute(getConfig(), {}));\n    // The bot's chats follow Main from their next turn (unless they already do).\n    if (inherited && !sameRoute(before, inherited)) await publishAgentRouteChange(id, inherited);\n    return { ...(inherited || {}), inherited: true };",
                '    void resolveRoute;\n    return { provider: \'\', model: \'\', effort: \'\', fast: false, autoEffort: true, inherited: true };',
            ],
            [
                '    if (!clean(requested.provider)) return clearOverride(id);',
                '    if (!clean(requested.provider)) {\n      if (next?.disabled === false) saveDisabled(id, false);\n      return clearOverride(id);\n    }',
            ],
            ...AGENT_ROUTE_SAFETY_EDITS,
        ],
        previousEditCount: 2,
    },
    {
        file: 'src/runtime/agent/orchestrator/config-storage.mjs',
        blob: 'b6979c4fd3e0eda8192ce25bb189b74b527a08a7',
        edits: [
            [
                '  const disabled = Array.isArray(raw.disabled)\n    ? [...new Set(raw.disabled.map((n) => String(n).trim()).filter(Boolean))]\n    : [];',
                '  const disabled = Array.isArray(raw.disabled)\n    ? [...new Set(raw.disabled.map((n) => String(n).trim()).filter(Boolean))]\n    : [\'*\'];',
            ],
            [
                '  if (Object.hasOwn(next, \'skills\')) {\n    const skills = normalizeSkillsConfig(next.skills);\n    if (skills.disabled.length) next.skills = skills;\n    else delete next.skills;\n  }',
                '  if (Object.hasOwn(next, \'skills\')) {\n    next.skills = normalizeSkillsConfig(next.skills);\n  }',
            ],
        ],
    },
    {
        file: 'src/runtime/agent/orchestrator/context/skill-catalog.mjs',
        blob: '7abd98fd470adc5915f61dc0b1f86c67524c14d6',
        edits: [
            [
                'function followsBuiltinFeature(skill) {\n  return skill?.source === \'builtin\' && Array.isArray(skill.requires) && skill.requires.length > 0;\n}',
                'function followsBuiltinFeature(skill) {\n  void skill;\n  return false;\n}',
            ],
            [
                '  if (!followsBuiltinFeature(skill) && getDisabledSkillNameSet(config).has(n)) return true;',
                '  const disabledSet = getDisabledSkillNameSet(config);\n  if (!followsBuiltinFeature(skill) && (disabledSet.has(\'*\') || disabledSet.has(n))) return true;',
            ],
            [
                '    if (key && !followsBuiltinFeature(skill) && disabled.has(key)) return false;',
                '    if (key && !followsBuiltinFeature(skill) && (disabled.has(\'*\') || disabled.has(key))) return false;',
            ],
            [
                '      (followsBuiltinFeature(s) || !disabled.has(key)) &&',
                '      (followsBuiltinFeature(s) || (!disabled.has(\'*\') && !disabled.has(key))) &&',
            ],
        ],
    },
    {
        // 복구할 수 없는 훅 설정 오류가 deny 정책을 조용히 없애지 않게 한다.
        file: 'src/session-runtime/services/hook-bus/tool-gate.mjs',
        blob: '44df75e7a868f11b6cd123b6a9e22a0c6d3eded0',
        edits: [[
            '      const cfg = loadConfig(input.cwd || cursor.cwd);\n      if (cfg.disabled) return null;',
            "      const cfg = loadConfig(input.cwd || cursor.cwd);\n      if (cfg.errors?.length) throw new Error('Hooks configuration is unreadable or malformed; repair it before running tools');\n      if (cfg.disabled) return null;",
        ]],
    },
    {
        file: 'src/session-runtime/services/hook-bus/rule-store.mjs',
        blob: 'fa073333c7ae69770860dc709fabe5eb58f917b0',
        edits: [
            [
                '    enabled: rule.enabled !== false,',
                '    enabled: rule.enabled === true,',
            ],
            [
                '    const nextEnabled = enabled !== false;',
                '    const nextEnabled = enabled === true;',
            ],
        ],
    },
    {
        file: 'src/session-runtime/services/hook-bus/rules.mjs',
        blob: '4b90fc3563b113cc85ea8f8431d44a9d22ef8c01',
        edits: [
            [
                '  if (!rule || typeof rule !== \'object\' || rule.enabled === false) return false;',
                '  if (!rule || typeof rule !== \'object\' || rule.enabled !== true) return false;',
            ],
            [
                '    enabled: rule.enabled !== false,',
                '    enabled: rule.enabled === true,',
            ],
        ],
    },
];
// 정확한 원본 또는 정확한 패치 결과만 허용한다.
export function patchedAgentSource(text, spec) {
    let original = text;
    for (const [before, after] of [...spec.edits].reverse()) original = original.replace(after, before);
    for (const [before, after] of [...(spec.previousEdits || [])].reverse()) original = original.replace(after, before);
    if (gitBlob(original) !== spec.blob) throw new Error(`Mixdog source hash mismatch: ${spec.file}`);
    let result = original;
    for (const [before, after] of spec.edits) {
        if (result.split(before).length !== 2) throw new Error(`Mixdog patch anchor mismatch: ${spec.file}`);
        result = result.replace(before, after);
    }
    const previousVersions = (spec.previousEditCounts || [spec.previousEditCount || 0]).map((count) =>
        spec.edits.slice(0, count).reduce((source, [before, after]) => source.replace(before, after), original));
    const previousVersion = (spec.previousEdits || []).reduce((source, [before, after]) => source.replace(before, after), original);
    if (text !== original && text !== result && !previousVersions.includes(text) && text !== previousVersion)
        throw new Error(`Partial Mixdog patch: ${spec.file}`);
    return result;
}
export function gitBlob(text) { const b = Buffer.from(text); return createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex'); }
export function patchedSource(text, expectedBlob = ORIGINAL_BLOB) {
    const original = text.includes(MARKER) ? text.replace(ADDITION, '') : text;
    if (gitBlob(original) !== expectedBlob) throw new Error('Mixdog source hash mismatch; refusing an unreviewed patch');
    if (original.split(ANCHOR).length !== 2) throw new Error('Mixdog patch anchor mismatch');
    return original.replace(ANCHOR, ANCHOR + ADDITION);
}
export function patch(root, { check = false } = {}) {
    // 같은 파일을 여러 spec으로 쓰면 앞 패치가 유실되므로 읽기·쓰기 전에 차단한다.
    const files = new Set(['src/session-runtime/turn/turn-run.mjs']);
    for (const { file } of AGENT_PATCHES) {
        if (files.has(file)) throw new Error(`Duplicate Mixdog patch target: ${file}`);
        files.add(file);
    }
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    if (manifest.version !== PIN) throw new Error(`Mixdog ${PIN} required; found ${manifest.version}`);
    // 모든 원본을 먼저 검사해 미검토 파일이 있으면 쓰기 전에 중단한다.
    const changes = [
        { file: 'src/session-runtime/turn/turn-run.mjs', transform: patchedSource },
        ...AGENT_PATCHES.map((spec) => ({ file: spec.file, transform: (text) => patchedAgentSource(text, spec) })),
    ].map(({ file, transform }) => {
        const path = resolve(root, file);
        const before = readFileSync(path, 'utf8');
        return { path, before, after: transform(before) };
    });
    if (check && changes.some(({ before, after }) => before !== after))
        throw new Error('Required host-policy patch is missing; run npm --prefix engine run patch');
    for (const { path, before, after } of changes) {
        if (!check && before !== after) {
            const temp = path + '.paseodog-tmp';
            writeFileSync(temp, after); renameSync(temp, path);
        }
    }
    return { version: manifest.version, patched: true, originalBlob: ORIGINAL_BLOB };
}
const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
    try {
        const root = resolve(dirname(self), '../engine/node_modules/mixdog');
        console.log(JSON.stringify(patch(root, { check: process.argv.includes('--check') })));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}

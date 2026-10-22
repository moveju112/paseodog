import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EFFORT_USAGE_PATCHES } from '../patches/effort-usage.mjs';
import { DEFAULT_OUTPUT_STYLE_PATCHES } from '../patches/default-output-style.mjs';
import { COMPACTION_SUMMARY_ROUTE_PATCH } from '../patches/compaction-summary-route.mjs';
export const PIN = '1.3.1';
export const ORIGINAL_BLOB = '6de5147ccdce6c9b3aa5f48dc740af439834b7b1';
export const ANCHOR = '      const turnContext = await dispatchPromptSubmit(turn, session0, prompt, options);';
export const ADDITION = '\n      // PaseoDog host-policy boundary v1 (local Apache-2.0 modification).\n      if (typeof options.beforeSessionAsk === \'function\') {\n        await options.beforeSessionAsk(session0);\n      }';
export const MARKER = 'PaseoDog host-policy boundary v1';
export const AGENT_PATCHES = [
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
        blob: '5120d6ab5f338d9f8f1fcc94f654fe0d6a6971fb',
        edits: [[
            '      persist.applySessionTuning();\n      return getRoute();',
            '      persist.applySessionTuning();\n      // 컨텍스트 선택도 기존 네이티브 경로 갱신·저장 함수를 사용한다.\n      if (session && (route.contextPercent !== session.contextPercent\n        || (route.contextTokens || null) !== (session.contextTokens || null)\n        || route.selectedContextWindow !== session.selectedContextWindow)) {\n        updateSessionInPlace(deps, session);\n      }\n      return getRoute();',
        ]],
    },
    {
        file: 'src/runtime/agent/orchestrator/session/manager/pending-messages.mjs',
        blob: '40722271524f52ee83df0013c40e81aaf2a73265',
        edits: [[
            '// Drain order: enqueue time, then source (hydrated < buffered < memory), then',
            "// 호스트가 검증한 즉시 지시와 알림만 중간 경계에서 소모한다.\nexport function pendingQueueHoldsOnlyHostSteering(sessionId) {\n  const queued = [\n    ...(_sessionPendingMessages.get(sessionId) || []),\n    ...(_hydratedPendingMessages.get(sessionId) || []),\n  ];\n  return queued.length > 0 && queued.every((entry) =>\n    entry.options?.paseodogSteering === true || pendingEntryMode(entry) === PENDING_MODE_TASK_NOTIFICATION\n  );\n}\n\n// Drain order: enqueue time, then source (hydrated < buffered < memory), then",
        ]],
    },
    {
        file: 'src/runtime/agent/orchestrator/session/manager/ask-turn-steering-drain.mjs',
        blob: 'bdc078312e2328d4095c392683fb9e504bb8d8f6',
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
        blob: 'dd692d1794eae53932b24b49be6a7caa8dce72b1',
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
        blob: '0ebac1c63784e2a81a358f24fc521b2ae7c2874f',
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
        blob: '032015d764d4e519adae99861805f3204adeda02',
        edits: [[
            "    if (!pack) return '';",
            "    if (!pack || pack.id === 'none' || !String(pack.body || '').trim()) return '';",
        ]],
    },
    {
        file: 'src/session-runtime/workflow-agents-api/workflow-packs.mjs',
        blob: '6989100f04ec9f52726b6f0d5e3e54cbf804e785',
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
        blob: '0e716329b756f5ab4d812a961ab3be0735e8368f',
        edits: [
            [
                '  function admitsRefresh(session) {',
                '  function admitsRefresh(session, workflowOnly = false) {',
            ],
            [
                '      !sessionHasConversationMessages(session) &&\n      !sessionHasConversationMessages({ messages: session.liveTurnMessages })',
                '      (workflowOnly || (!sessionHasConversationMessages(session) &&\n      !sessionHasConversationMessages({ messages: session.liveTurnMessages })))',
            ],
            [
                '  async function stagePolicy(session, identity, config, { conversation = false } = {}) {',
                '  async function stagePolicy(session, identity, config, { conversation = false, workflowOnly = false } = {}) {',
            ],
            [
                "    const coreMemoryContext = conversation ? '' : await leadCoreMemoryContext();",
                "    // 워크플로 갱신은 메모리 읽기 실패를 전파해 기존 기억을 지우지 않는다.\n    const coreMemoryContext = conversation ? '' : workflowOnly ? await loadCoreMemoryContext() : await leadCoreMemoryContext();",
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
        file: 'src/session-runtime/boot/providers.mjs',
        blob: 'e1aafa3afa5c110637a11acf561c2b9c07a23df6',
        edits: [[
            '    resolveRoute,\n    cfgMod,\n    sharedCfgMod,',
            '    resolveRoute,\n    // 최신 사용자 설정을 읽되 호스트가 지정한 MCP·업데이트 제한만 유지한다.\n    cfgMod: boot.params.initialConfig ? { ...cfgMod, loadConfig: (...args) => { const latest = cfgMod.loadConfig(...args); return { ...latest, mcpServers: boot.params.initialConfig.mcpServers, update: { ...latest.update, auto: false } }; } } : cfgMod,\n    sharedCfgMod,',
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
        blob: '40a774b8654fbb7ac7a658fc9020fc16cf9c75af',
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
        blob: '701f371268c9b6f3e3a44fcb8b2ef4634f552fd1',
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
        blob: 'cdfdfb44509491a693110c0bbcf8c1a9eac1f70e',
        previousEditCount: 1,
        edits: [[
            '      if (hasOwn(input, \'onModelChange\')) next.onModelChange = input.onModelChange !== false;',
            '      if (hasOwn(input, \'onModelChange\')) next.onModelChange = input.onModelChange !== false;\n      if (hasOwn(input, \'summaryModel\')) {\n        if (input.summaryModel) next.summaryModel = String(input.summaryModel).trim();\n        else delete next.summaryModel;\n      }\n      if (hasOwn(input, \'memoryTimeoutMs\')) {\n        const ms = Number(input.memoryTimeoutMs);\n        if (Number.isFinite(ms) && ms > 0) next.memoryTimeoutMs = Math.round(ms);\n        else delete next.memoryTimeoutMs;\n      }',
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
        blob: '7ac9cf88be850663b6a1cacf33e5aff7c635418e',
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
        blob: 'c022883e889a6b2e74c018590f259140e20ee417',
        edits: [[
            '        : loadInstructionFilesContext({ mode: rt.config?.instructionFiles, cwd: session.cwd }),',
            '        : loadInstructionFilesContext({ mode: rt.config?.instructionFiles, cwd: session.cwd, provider: rt.route?.provider || session?.provider, model: rt.route?.model || session?.model }),',
        ]],
    },
    {
        file: 'src/session-runtime/workflow-agents-api/shared.mjs',
        blob: '14680dcf98d506583f5e22f5096e35af4c2cf055',
        edits: [[
            'export function effectiveAgentRoute({ agentRouteFromConfig, resolveRoute }, config, agentId) {\n  return agentRouteFromConfig(config, agentId) || normalizeWorkflowRoute(resolveRoute(config, {}));\n}',
            'export function effectiveAgentRoute({ agentRouteFromConfig, resolveRoute }, config, agentId) {\n  void resolveRoute;\n  return agentRouteFromConfig(config, agentId) || { provider: \'\', model: \'\', effort: \'\', fast: false, autoEffort: true, inherited: true };\n}',
        ]],
    },
    {
        file: 'src/session-runtime/workflow-agents-api/agent-route.mjs',
        blob: '09e7ecb35fed095c1297a1e2acf45ba8b24b73b3',
        edits: [
            [
                '    const inherited = normalizeWorkflowRoute(resolveRoute(getConfig(), {}));\n    return { ...(inherited || {}), inherited: true };',
                '    void resolveRoute;\n    return { provider: \'\', model: \'\', effort: \'\', fast: false, autoEffort: true, inherited: true };',
            ],
            [
                '    if (!clean(requested.provider)) return clearOverride(id);',
                '    if (!clean(requested.provider)) {\n      if (next?.disabled === false) saveDisabled(id, false);\n      return clearOverride(id);\n    }',
            ],
        ],
    },
    {
        file: 'src/runtime/agent/orchestrator/config-storage.mjs',
        blob: 'd85432317ed116bfa019f488d7ebf3f6a30727c1',
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

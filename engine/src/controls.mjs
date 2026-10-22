import { isAbsolute, resolve } from 'node:path';
import { homedir } from 'node:os';
import { loadNativeModules } from './native-engine.mjs';
import { nativeDefaultWorkflowBody } from './native-templates.mjs';
import { createJsonLineDecoder, encodeFrame } from '../../plugin/server/json-lines.mjs';
import { errorText } from '../../plugin/server/util.mjs';
import { readClaudeUsage, readUsageMetrics } from './usage.mjs';
import { normalizeOrchestrationMode } from './orchestration-mode.mjs';
import { flushPendingSessionConfigWrites } from 'mixdog/src/session-runtime/config-lifecycle/config-writers.mjs';
import { resourceControls } from './resource-controls.mjs';
import { compactionBufferRatio } from './compaction-buffer.mjs';

// 인증정보·프롬프트·파일 경로 없이 모델 선택에 필요한 필드만 전달한다.
export function modelProjection(row) {
    return {
        id: row.id, provider: row.provider, label: row.label || row.name || row.id,
        effortOptions: (row.effortOptions || []).map((item) => typeof item === 'string'
            ? { id: item, label: item } : { id: item.id || item.value, label: item.label || item.id || item.value }),
        fastCapable: row.fastCapable === true,
    };
}

// 워크플로우 문서를 민감 경로 없이 UI 편집용 구조로 투영한다.
function workflowPackProjection(pack) {
    if (!pack || typeof pack !== 'object') return null;
    return {
        id: String(pack.id || ''),
        name: String(pack.name || pack.id || ''),
        description: typeof pack.description === 'string' ? pack.description : '',
        source: typeof pack.source === 'string' ? pack.source : 'builtin',
        body: typeof pack.body === 'string' ? pack.body : '',
        userOverride: pack.userOverride === true,
    };
}

// 설정 요청은 허용된 항목만 받으며 전용 프로필의 네이티브 API로 저장한다.
export async function controlRuntime(runtime, request = {}, options = {}) {
    const action = request.action || 'read';
    if (action === 'title') {
        const generate = options.generateTitle || (await import('./session-title.mjs')).generateConversationTitle;
        return generate(request);
    }
    if (action === 'resources') return resourceControls(runtime, request);
    if (action === 'usage') return await readClaudeUsage(runtime);
    if (action === 'metrics') return await readUsageMetrics(runtime, request);
    const cachedModels = Array.isArray(options.cachedModels) && options.cachedModels.length > 0 && request.refresh !== true
        ? options.cachedModels
        : null;
    let workflowPack = null;
    let agentDefinition = null;

    if (action === 'main' || action === 'agent') {
        const input = { ...(request.route || {}) };
        const allowedKeys = ['provider', 'model', 'effort', 'fast', 'autoEffort', 'disabled', 'contextPercent', 'contextTokens', 'fallbacks'];
        if (Object.keys(input).some((key) => !allowedKeys.includes(key)))
            throw new Error('Unsupported route field');
        for (const key of ['provider', 'model', 'effort']) {
            if (input[key] !== undefined && (typeof input[key] !== 'string' || input[key].length > 256))
                throw new Error(`Invalid route ${key}`);
        }
        for (const key of ['fast', 'autoEffort', 'disabled']) {
            if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new Error(`Invalid route ${key}`);
        }
        if (input.contextPercent !== undefined) {
            if (input.contextPercent === null || input.contextPercent === 0) {
                input.contextPercent = undefined;
            } else if (typeof input.contextPercent !== 'number' || !Number.isFinite(input.contextPercent)
                || input.contextPercent < 10 || input.contextPercent > 100) {
                throw new Error('Invalid route contextPercent');
            }
        }
        if (input.contextTokens !== undefined) {
            if (input.contextTokens === null || input.contextTokens === 0) {
                input.contextTokens = undefined;
            } else if (typeof input.contextTokens !== 'number' || !Number.isFinite(input.contextTokens)
                || input.contextTokens < 1000 || input.contextTokens > 2000000) {
                throw new Error('Invalid route contextTokens');
            } else {
                input.contextTokens = Math.round(input.contextTokens);
            }
        }
        if (input.fallbacks !== undefined) {
            if (!Array.isArray(input.fallbacks)) throw new Error('Invalid route fallbacks');
            input.fallbacks = input.fallbacks.map((fb) => {
                if (!fb || typeof fb !== 'object' || typeof fb.provider !== 'string' || typeof fb.model !== 'string')
                    throw new Error('Invalid fallback route item');
                return {
                    provider: fb.provider.slice(0, 256),
                    model: fb.model.slice(0, 256),
                    ...(typeof fb.effort === 'string' && fb.effort ? { effort: fb.effort.slice(0, 256) } : {}),
                    ...(typeof fb.fast === 'boolean' ? { fast: fb.fast } : {}),
                };
            });
        }
        if (input.provider && input.model) {
            const matchedCached = cachedModels?.some((row) => row.provider === input.provider && row.id === input.model);
            if (!matchedCached) {
                const models = await runtime.listProviderModels();
                if (!models.some((row) => row.provider === input.provider && row.id === input.model))
                    throw new Error('Select a model from the current Mixdog catalog');
            }
        }
        if (action === 'main') {
            if (input.disabled !== undefined) throw new Error('Main cannot be disabled');
            await runtime.setRoute(input, { keepMainModel: false });
        } else {
            const agents = await runtime.listAgents();
            if (!agents.some((row) => row.id === request.agent)) throw new Error('Unknown agent');
            await runtime.setAgentRoute(request.agent, input);
            if (input.provider === '' && input.disabled === false) {
                await runtime.setAgentRoute(request.agent, { disabled: false });
            }
        }
    } else if (action === 'agentDefinition') {
        if (!(await runtime.listAgents()).some((row) => row.id === request.agent)) throw new Error('Unknown agent');
        if (typeof runtime.getAgentDefinition !== 'function') throw new Error('Agent definition inspection not supported');
        const { id, name, description, body, custom, userOverride, revision } = await runtime.getAgentDefinition(request.agent);
        agentDefinition = { id, name, description, body, custom, userOverride, revision };
    } else if (action === 'agentSave' || action === 'agentCreate') {
        if (typeof runtime.saveAgentDefinition !== 'function') throw new Error('Agent save not supported');
        const currentAgent = request.agent ? (await runtime.listAgents()).find((row) => row.id === request.agent) : null;
        if (action === 'agentCreate' && currentAgent) throw new Error('Agent already exists; choose a different id');
        if (action === 'agentSave') {
            if (!currentAgent) throw new Error('Unknown agent');
            if (typeof request.expectedRevision !== 'string' || !/^[a-f0-9]{24}$/.test(request.expectedRevision))
                throw new Error('Reload the original agent definition before saving');
        }
        const selectedRoute = { ...currentAgent?.route, ...request.route };
        if (!selectedRoute?.provider || !selectedRoute?.model) throw new Error('Select an agent model before saving');
        const name = typeof request.name === 'string' ? request.name.trim().slice(0, 120) : '';
        const id = typeof request.agent === 'string' ? request.agent.trim().slice(0, 100) : '';
        if (!name && !id) throw new Error('Agent name or id is required');
        if (typeof request.body !== 'string' || !request.body.trim() || request.body.length > 200000)
            throw new Error('Agent body is required');
        const saved = await runtime.saveAgentDefinition({
            id: id || undefined,
            name: name || id,
            description: typeof request.description === 'string' ? request.description.trim().slice(0, 500) : undefined,
            body: request.body,
            ...(action === 'agentCreate' ? { createOnly: true } : { expectedRevision: request.expectedRevision }),
            ...(request.route ? { route: request.route } : {}),
        });
        if (request.route?.provider === '' && typeof request.route?.disabled === 'boolean') {
            await runtime.setAgentRoute?.(saved.id, { disabled: request.route.disabled });
        }
        agentDefinition = {
            id: saved.id,
            name: saved.name,
            description: saved.description,
            body: saved.body,
            custom: saved.custom,
            userOverride: saved.userOverride,
            revision: saved.revision,
        };
    } else if (action === 'agentDelete') {
        if (typeof request.agent !== 'string' || !request.agent || request.agent.length > 100)
            throw new Error('Unknown agent');
        if (typeof runtime.deleteAgentDefinition !== 'function') throw new Error('Agent delete not supported');
        await runtime.deleteAgentDefinition(request.agent);
    } else if (action === 'compaction') {
        const patch = {};
        if (request.enabled !== undefined) {
            if (typeof request.enabled !== 'boolean') throw new Error('enabled must be boolean');
            patch.enabled = request.enabled;
        }
        if (request.onModelChange !== undefined) {
            if (typeof request.onModelChange !== 'boolean') throw new Error('onModelChange must be boolean');
            patch.onModelChange = request.onModelChange;
        }
        if (request.mainBufferPercent !== undefined) {
            // 앱 계약은 비율(0.2 = 20%)이고 Mixdog mainBufferPercent는 0~100 단위라 비율 키로 저장한다.
            if (typeof request.mainBufferPercent !== 'number' || !Number.isFinite(request.mainBufferPercent)
                || request.mainBufferPercent < 0.05 || request.mainBufferPercent > 0.25)
                throw new Error('Invalid mainBufferPercent');
            patch.mainBufferRatio = request.mainBufferPercent;
        }
        if (request.mainBufferTokens !== undefined) {
            if (typeof request.mainBufferTokens !== 'number' || !Number.isFinite(request.mainBufferTokens)
                || (request.mainBufferTokens !== 0 && request.mainBufferTokens < 1000) || request.mainBufferTokens > 500000)
                throw new Error('Invalid mainBufferTokens');
            patch.mainBufferTokens = Math.round(request.mainBufferTokens);
        }
        if (request.summaryModel !== undefined) {
            if (typeof request.summaryModel !== 'string' || request.summaryModel.length > 256)
                throw new Error('Invalid summaryModel');
            patch.summaryModel = request.summaryModel.trim();
        }
        if (request.memoryTimeoutMs !== undefined) {
            throw new Error('메모리 추출 제한 시간은 현재 엔진에서 지원하지 않아요.');
        }
        if (!Object.keys(patch).length) throw new Error('enabled must be boolean');
        await runtime.setCompactionSettings(patch);
    } else if (action === 'autoClear') {
        const patch = {};
        if (request.enabled !== undefined) {
            if (typeof request.enabled !== 'boolean') throw new Error('enabled must be boolean');
            patch.enabled = request.enabled;
        }
        if (request.idleMs !== undefined) {
            if (request.idleMs === null || request.idleMs === 0) {
                patch.idleMs = null;
            } else {
                if (typeof request.idleMs !== 'number' || !Number.isFinite(request.idleMs)
                    || request.idleMs < 60000 || request.idleMs > 604800000)
                    throw new Error('Invalid idleMs');
                patch.idleMs = Math.round(request.idleMs);
            }
        }
        if (request.reset === true) patch.reset = true;
        if (typeof request.provider === 'string' && request.provider.trim()) patch.provider = request.provider.trim();
        if (request.resetProvider === true) patch.resetProvider = true;
        if (request.minContextPercent !== undefined) {
            if (typeof request.minContextPercent !== 'number' || !Number.isFinite(request.minContextPercent)
                || request.minContextPercent < 0 || request.minContextPercent > 100)
                throw new Error('Invalid minContextPercent');
            patch.minContextPercent = request.minContextPercent > 0 && request.minContextPercent < 1
                ? Math.round(request.minContextPercent * 100)
                : Math.round(request.minContextPercent);
        }
        if (!Object.keys(patch).length) throw new Error('autoClear setting required');
        if (typeof runtime.setAutoClear !== 'function') throw new Error('Auto-clear not supported');
        await runtime.setAutoClear(patch);
    } else if (action === 'instructionFiles') {
        if (typeof runtime.setInstructionFiles !== 'function') throw new Error('Instruction files not supported');
        if (typeof request.instructionMode === 'string') {
            if (!['all', 'agents', 'claude', 'off'].includes(request.instructionMode))
                throw new Error('Invalid instructionMode');
            await runtime.setInstructionFiles(request.instructionMode);
        } else if (typeof request.enabled === 'boolean') {
            await runtime.setInstructionFiles(request.enabled ? 'all' : 'off');
        } else {
            throw new Error('enabled must be boolean');
        }
    } else if (action === 'features') {
        if (request.recap !== undefined) {
            if (typeof request.recap !== 'boolean') throw new Error('recap must be boolean');
            await runtime.setRecapEnabled?.(request.recap);
        }
        if (request.memoryTools !== undefined) {
            if (typeof request.memoryTools !== 'boolean') throw new Error('memoryTools must be boolean');
            await runtime.setMemoryToolsEnabled?.(request.memoryTools);
        }
        if (request.webSearch !== undefined) {
            if (typeof request.webSearch !== 'boolean') throw new Error('webSearch must be boolean');
            await runtime.setWebSearchEnabled?.(request.webSearch);
        }
        if (request.builtinTool !== undefined) {
            if (typeof request.builtinTool !== 'string' || typeof request.enabled !== 'boolean')
                throw new Error('builtinTool and enabled required');
            await runtime.setBuiltinToolEnabled?.(request.builtinTool, request.enabled);
        }
        if (request.installFeature !== undefined) {
            if (typeof request.installFeature !== 'string') throw new Error('installFeature must be string');
            await runtime.installBuiltinFeature?.(request.installFeature);
        }
        if (request.webSearchRoute !== undefined) {
            if (!request.webSearchRoute || typeof request.webSearchRoute !== 'object')
                throw new Error('Invalid webSearchRoute');
            await runtime.setWebSearchRoute?.(request.webSearchRoute);
        }
    } else if (action === 'preferences') {
        if (request.worktree !== undefined)
            throw new Error('PaseoDog automatic worktree isolation is not supported');
        if (request.outputStyle !== undefined) {
            if (typeof request.outputStyle !== 'string') throw new Error('Invalid outputStyle');
            await runtime.setOutputStyle?.(request.outputStyle);
        }
        if (request.profile !== undefined) {
            if (!request.profile || typeof request.profile !== 'object') throw new Error('Invalid profile');
            await runtime.setProfile?.(request.profile);
        }
        if (request.aiSessionTitles !== undefined) {
            if (typeof request.aiSessionTitles !== 'boolean') throw new Error('aiSessionTitles must be boolean');
            await runtime.setAiSessionTitles?.(request.aiSessionTitles);
        }
        if (request.shellCommand !== undefined) {
            if (typeof request.shellCommand !== 'string') throw new Error('Invalid shellCommand');
            await runtime.setSystemShell?.({ command: request.shellCommand });
        }
        if (request.disabledSkills !== undefined) {
            if (!Array.isArray(request.disabledSkills)) throw new Error('Invalid disabledSkills');
            await runtime.setDisabledSkills?.(request.disabledSkills.map(String));
        }
        if (request.hookAction === 'add' && request.hookRule) {
            await runtime.addHookRule?.(request.hookRule);
            await runtime.flushHookRules?.();
        } else if (request.hookAction === 'toggle' && typeof request.hookIndex === 'number') {
            await runtime.setHookRuleEnabled?.(request.hookIndex, Boolean(request.enabled));
            await runtime.flushHookRules?.();
        } else if (request.hookAction === 'delete' && typeof request.hookIndex === 'number') {
            await runtime.deleteHookRule?.(request.hookIndex);
            await runtime.flushHookRules?.();
        }
    } else if (action === 'workflow') {
        if (!(await runtime.listWorkflows()).some((row) => row.id === request.workflow)) throw new Error('Unknown workflow');
        await runtime.setWorkflow(request.workflow);
    } else if (action === 'workflowPack') {
        if (typeof request.workflow !== 'string' || !request.workflow || request.workflow.length > 100)
            throw new Error('Unknown workflow');
        if (typeof runtime.getWorkflowPack !== 'function') throw new Error('Workflow pack inspection not supported');
        workflowPack = workflowPackProjection(await runtime.getWorkflowPack(request.workflow));
    } else if (action === 'workflowSave') {
        if (request.activate !== undefined && typeof request.activate !== 'boolean')
            throw new Error('Invalid workflow activation');
        if (typeof request.workflow !== 'string' || !request.workflow || request.workflow.length > 100)
            throw new Error('Unknown workflow');
        if (typeof request.body !== 'string' || request.body.length > 200000)
            throw new Error('Invalid workflow body');
        if (typeof runtime.saveWorkflowPack !== 'function') throw new Error('Workflow save not supported');
        const saved = await runtime.saveWorkflowPack({
            id: request.workflow,
            name: typeof request.name === 'string' && request.name.trim() ? request.name.trim().slice(0, 120) : undefined,
            description: typeof request.description === 'string' ? request.description.trim().slice(0, 500) : undefined,
            body: request.body,
        });
        if (request.activate === false) {
            if ((await runtime.listWorkflows()).some((row) => row.id === request.workflow && row.active))
                await runtime.setWorkflow('none');
        } else await runtime.setWorkflow(request.body.trim() ? saved.id || request.workflow : 'none');
        workflowPack = workflowPackProjection(saved);
    } else if (action === 'workflowCreate') {
        const name = typeof request.name === 'string' ? request.name.trim().slice(0, 120) : '';
        const id = typeof request.workflow === 'string' ? request.workflow.trim().slice(0, 100) : '';
        if (!name && !id) throw new Error('Workflow name is required');
        const description = typeof request.description === 'string' ? request.description.trim().slice(0, 500) : '';
        if (typeof runtime.createWorkflow !== 'function') throw new Error('Workflow create not supported');
        const body = typeof request.body === 'string' ? request.body : await nativeDefaultWorkflowBody();
        if (body.length > 200000) throw new Error('Workflow body is too large');
        const created = await runtime.createWorkflow({
            id: id || undefined,
            name: name || id,
            description,
            body,
        });
        if (request.activate !== false) await runtime.setWorkflow(created.id);
        workflowPack = workflowPackProjection(created);
    } else if (action === 'workflowDelete') {
        if (typeof request.workflow !== 'string' || !request.workflow || request.workflow === 'default' || request.workflow.length > 100)
            throw new Error('Cannot delete default or invalid workflow');
        if (typeof runtime.deleteWorkflow !== 'function') throw new Error('Workflow delete not supported');
        await runtime.deleteWorkflow(request.workflow);
    } else if (action === 'orchestration') {
        if (!['none', 'swarm'].includes(request.mode)) throw new Error('Unknown orchestration mode');
        await runtime.setOrchestrationMode(request.mode);
    } else if (action !== 'read') throw new Error('Unsupported control action');

    // 메모리 채택만으로 성공을 알리지 않고 실패 시 네이티브의 보류 변경을 유지한다.
    await flushPendingSessionConfigWrites();

    const rawCompaction = runtime.getCompactionSettings?.() || {};
    const bufferRatio = compactionBufferRatio(rawCompaction);
    const compaction = {
        auto: rawCompaction.auto,
        ...(typeof rawCompaction.onModelChange === 'boolean' ? { onModelChange: rawCompaction.onModelChange } : {}),
        ...(bufferRatio !== undefined ? { mainBufferPercent: bufferRatio } : {}),
        ...(typeof rawCompaction.mainBufferTokens === 'number' ? { mainBufferTokens: rawCompaction.mainBufferTokens } : {}),
        ...(typeof rawCompaction.summaryModel === 'string' ? { summaryModel: rawCompaction.summaryModel } : {}),
    };
    const rawAutoClear = typeof runtime.getAutoClear === 'function' ? runtime.getAutoClear() : null;
    const autoClear = rawAutoClear && typeof rawAutoClear === 'object' ? {
        enabled: rawAutoClear.enabled === true,
        idleMs: Number(rawAutoClear.idleMs) || 3600000,
        custom: rawAutoClear.custom === true,
        providerCustom: rawAutoClear.providerCustom === true,
        providerDefault: Number(rawAutoClear.providerDefault) || 3600000,
        provider: rawAutoClear.provider || null,
        providerDefaults: Array.isArray(rawAutoClear.providerDefaults) ? rawAutoClear.providerDefaults : [],
        minContextPercent: Number(rawAutoClear.minContextPercent) || 0,
    } : undefined;
    const models = cachedModels
        ? cachedModels.map(modelProjection)
        : (await runtime.listProviderModels({ force: request.refresh === true })).map(modelProjection);
    const tm = runtime.getToolModuleSettings?.() || {};
    const toolModules = {
        webSearch: Boolean(tm.webSearch?.enabled),
        memory: { enabled: Boolean(tm.memory?.enabled), installed: Boolean(tm.memory?.installed) },
        git: { enabled: Boolean(tm.git?.enabled), installed: Boolean(tm.git?.installed) },
        office: { enabled: Boolean(tm.office?.enabled), installed: Boolean(tm.office?.installed) },
        tidy: { enabled: Boolean(tm.tidy?.enabled), installed: Boolean(tm.tidy?.installed) },
        visualize: { enabled: Boolean(tm.visualize?.enabled), installed: true },
        media: { enabled: Boolean(tm.media?.enabled), installed: true },
        localProvider: { enabled: Boolean(tm.localProvider?.enabled), installed: Boolean(tm.localProvider?.installed) },
        autoEffort: {
            enabled: Boolean(tm.autoEffort?.enabled),
            installed: Boolean(tm.autoEffort?.installed),
            supported: tm.autoEffort?.supported !== false,
        },
    };
    const rawProfile = runtime.getProfile?.() || {};
    const rawSkills = typeof runtime.skillsStatus === 'function' ? await Promise.resolve(runtime.skillsStatus()).catch(() => null) : null;
    const rawHooks = typeof runtime.hooksStatus === 'function' ? await Promise.resolve(runtime.hooksStatus()).catch(() => null) : null;

    return {
        route: {
            provider: runtime.provider, model: runtime.model, effort: runtime.effort,
            fast: runtime.fast, autoEffort: runtime.autoEffort,
            ...(typeof runtime.contextPercent === 'number' ? { contextPercent: runtime.contextPercent } : {}),
            ...(typeof runtime.contextTokens === 'number' ? { contextTokens: runtime.contextTokens } : {}),
        },
        models,
        instructionFiles: tm.instructionFiles || 'all',
        compaction,
        ...(autoClear ? { autoClear } : {}),
        recap: runtime.getRecapSettings?.()?.enabled !== false,
        aiSessionTitles: runtime.getSessionTitleSettings?.()?.aiSessionTitles !== false,
        toolModules,
        webSearchRoute: runtime.getWebSearchRoute?.() || null,
        outputStyle: runtime.getOutputStyle?.()?.current?.id,
        outputStyles: (runtime.listOutputStyles?.()?.styles || []).map((s) => ({
            id: String(s.id || ''),
            label: String(s.label || s.name || s.id || ''),
            description: typeof s.description === 'string' ? s.description : '',
        })),
        profile: {
            title: typeof rawProfile.title === 'string' ? rawProfile.title : '',
            language: typeof rawProfile.language === 'string' ? rawProfile.language : 'system',
            experienceLevel: typeof rawProfile.experienceLevel === 'string' ? rawProfile.experienceLevel : '',
        },
        shell: runtime.getSystemShell?.() || { command: '', effective: '', source: 'auto' },
        worktree: runtime.getWorktreeSettings?.() || {
            newTaskDefault: 'branch', branchPrefix: 'mixdog/', sizeWarnBytes: 2147483648, autoCleanup: true,
        },
        skills: (() => {
            const rawDisabled = runtime.getDisabledSkills?.()?.disabled || [];
            const wildcardDisabled = rawDisabled.includes('*');
            const items = (rawSkills?.skills || []).map((s) => ({
                name: String(s.name || s.id || ''),
                description: typeof s.description === 'string' ? s.description : '',
                disabled: wildcardDisabled || s.disabled === true || s.enabled === false,
            }));
            return {
                disabled: wildcardDisabled ? items.map((s) => s.name) : rawDisabled,
                items,
            };
        })(),
        hooks: {
            rules: (rawHooks?.rules || []).map((r, index) => ({
                index,
                event: String(r.event || ''),
                matcher: String(r.matcher || ''),
                command: String(r.command || ''),
                enabled: r.enabled === true,
            })),
        },
        workflows: await Promise.all((await runtime.listWorkflows()).map(async ({ id, name, active, description, source, userOverride }) => {
            const pack = typeof runtime.getWorkflowPack === 'function'
                ? await Promise.resolve(runtime.getWorkflowPack(id)).catch(() => null)
                : null;
            const resolvedDesc = description ?? pack?.description;
            const resolvedOverride = userOverride ?? pack?.userOverride;
            const body = typeof pack?.body === 'string' ? pack.body : '';
            return {
                id, name, active,
                ...(typeof resolvedDesc === 'string' && resolvedDesc ? { description: resolvedDesc } : {}),
                ...(typeof source === 'string' && source ? { source } : {}),
                ...(typeof resolvedOverride === 'boolean' ? { userOverride: resolvedOverride } : {}),
                ...(body ? { body } : {}),
            };
        })),
        ...(workflowPack ? { workflowPack } : {}),
        ...(agentDefinition ? { agentDefinition } : {}),
        orchestration: normalizeOrchestrationMode(runtime.getOrchestrationMode()),
        orchestrationScope: 'host',
        orchestrationAppliesTo: 'next-turn',
        agents: (await runtime.listAgents()).map((row) => {
            const body = typeof row.body === 'string'
                ? row.body
                : (typeof row.definition?.body === 'string' ? row.definition.body : '');
            return {
                id: row.id, label: row.label || row.id,
                ...(typeof row.description === 'string' && row.description ? { description: row.description } : {}),
                ...(typeof row.custom === 'boolean' ? { custom: row.custom } : {}),
                ...(typeof row.userOverride === 'boolean' ? { userOverride: row.userOverride } : {}),
                ...(typeof row.locked === 'boolean' ? { locked: row.locked } : {}),
                ...(body ? { body } : {}),
                disabled: row.disabled === true, route: {
                    provider: row.route?.provider || '', model: row.route?.model || '',
                    effort: row.route?.effort || '', fast: row.route?.fast === true,
                    autoEffort: row.route?.autoEffort !== false, inherited: row.route?.inherited === true,
                    ...(typeof row.route?.contextPercent === 'number' ? { contextPercent: row.route.contextPercent } : {}),
                    ...(typeof row.route?.contextTokens === 'number' ? { contextTokens: row.route.contextTokens } : {}),
                    ...(Array.isArray(row.route?.fallbacks) ? { fallbacks: row.route.fallbacks } : {}),
                },
            };
        }),
        appliesTo: 'new-sessions',
    };
}

// 전용 프로필 경로를 검증하고 읽기 전용 제어 런타임을 생성한다.
async function openControlRuntime() {
    const home = process.env.MIXDOG_HOME;
    const data = process.env.MIXDOG_DATA_DIR;
    if (!home || !data || !isAbsolute(home) || !isAbsolute(data)
        || resolve(home) === resolve(homedir(), '.mixdog'))
        throw new Error('Dedicated absolute MIXDOG_HOME and MIXDOG_DATA_DIR required');
    const native = await loadNativeModules();
    const runtime = await native.createMixdogSessionRuntime({
        cwd: home,
        toolMode: 'readonly', disallowDelegation: true, autoWakeCompletions: false,
    });
    return { native, runtime };
}

// 전용 프로필을 열어 설정을 처리하고, 제목 요청만 명시된 네이티브 추론 경로에 전달한다.
export async function runControls(request) {
    const { runtime } = await openControlRuntime();
    try { return await controlRuntime(runtime, request); }
    finally { await runtime.close('paseodog-controls'); }
}

// 상주형 제어 파이프를 통해 매 설정 변경 시 콜드 부팅과 모델 재조회를 생략한다.
export function serveControlsStdio({ input, output, onExit = () => {}, openRuntime = openControlRuntime }) {
    let runtimePromise = null;
    let cachedModels = null;
    let queue = Promise.resolve();
    let closing = false;
    const write = (frame) => output.write(encodeFrame(frame));
    async function ensureRuntime() {
        if (!runtimePromise) runtimePromise = openRuntime();
        return runtimePromise;
    }
    async function stop() {
        if (closing) return;
        closing = true;
        try {
            // 입력 종료와 겹친 승인된 요청도 저장·응답까지 마친 뒤 런타임을 닫는다.
            await queue;
            const opened = await runtimePromise;
            await opened?.runtime?.close('paseodog-controls-stdio');
        } catch {}
        onExit();
    }
    const decoder = createJsonLineDecoder((frame) => {
        if (closing || !frame || typeof frame.id !== 'string') return;
        queue = queue.then(async () => {
            try {
                const { runtime } = await ensureRuntime();
                const req = frame.request || {};
                const value = await controlRuntime(runtime, req, { cachedModels: req.refresh ? null : cachedModels });
                if (Array.isArray(value.models) && value.models.length > 0) cachedModels = value.models;
                write({ v: 1, id: frame.id, ok: true, value });
            } catch (error) {
                write({ v: 1, id: frame.id, ok: false, error: errorText(error) || 'Engine settings failed' });
            }
        });
    }, () => void stop());
    input.on('data', (chunk) => decoder.write(chunk));
    input.on('end', () => void stop());
    input.on('error', () => void stop());
    return { stop };
}

import { isAbsolute, resolve } from 'node:path';
import { homedir } from 'node:os';
import { loadNativeModules } from './native-engine.mjs';
import { createJsonLineDecoder, encodeFrame } from '../../plugin/server/json-lines.mjs';
import { errorText } from '../../plugin/server/util.mjs';

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
    const cachedModels = Array.isArray(options.cachedModels) && options.cachedModels.length > 0 && request.refresh !== true
        ? options.cachedModels
        : null;
    let workflowPack = null;

    if (action === 'main' || action === 'agent') {
        const input = request.route || {};
        if (Object.keys(input).some((key) => !['provider', 'model', 'effort', 'fast', 'autoEffort', 'disabled'].includes(key)))
            throw new Error('Unsupported route field');
        for (const key of ['provider', 'model', 'effort']) {
            if (input[key] !== undefined && (typeof input[key] !== 'string' || input[key].length > 256))
                throw new Error(`Invalid route ${key}`);
        }
        for (const key of ['fast', 'autoEffort', 'disabled']) {
            if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new Error(`Invalid route ${key}`);
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
        }
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
            if (typeof request.mainBufferPercent !== 'number' || !Number.isFinite(request.mainBufferPercent)
                || request.mainBufferPercent < 0.05 || request.mainBufferPercent > 0.5)
                throw new Error('Invalid mainBufferPercent');
            patch.mainBufferPercent = request.mainBufferPercent;
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
            if (typeof request.idleMs !== 'number' || !Number.isFinite(request.idleMs)
                || request.idleMs < 60000 || request.idleMs > 604800000)
                throw new Error('Invalid idleMs');
            patch.idleMs = Math.round(request.idleMs);
        }
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
    } else if (action === 'workflow') {
        if (!(await runtime.listWorkflows()).some((row) => row.id === request.workflow)) throw new Error('Unknown workflow');
        await runtime.setWorkflow(request.workflow);
    } else if (action === 'workflowPack') {
        if (typeof request.workflow !== 'string' || !request.workflow || request.workflow.length > 100)
            throw new Error('Unknown workflow');
        if (typeof runtime.getWorkflowPack !== 'function') throw new Error('Workflow pack inspection not supported');
        workflowPack = workflowPackProjection(await runtime.getWorkflowPack(request.workflow));
    } else if (action === 'workflowSave') {
        if (typeof request.workflow !== 'string' || !request.workflow || request.workflow.length > 100)
            throw new Error('Unknown workflow');
        if (typeof request.body !== 'string' || !request.body.trim() || request.body.length > 200000)
            throw new Error('Workflow body is required');
        if (typeof runtime.saveWorkflowPack !== 'function') throw new Error('Workflow save not supported');
        const saved = await runtime.saveWorkflowPack({
            id: request.workflow,
            name: typeof request.name === 'string' && request.name.trim() ? request.name.trim().slice(0, 120) : undefined,
            description: typeof request.description === 'string' ? request.description.trim().slice(0, 500) : undefined,
            body: request.body,
        });
        if (request.activate !== false) await runtime.setWorkflow(saved.id || request.workflow);
        workflowPack = workflowPackProjection(saved);
    } else if (action === 'workflowCreate') {
        const name = typeof request.name === 'string' ? request.name.trim().slice(0, 120) : '';
        const id = typeof request.workflow === 'string' ? request.workflow.trim().slice(0, 100) : '';
        if (!name && !id) throw new Error('Workflow name is required');
        const description = typeof request.description === 'string' ? request.description.trim().slice(0, 500) : '';
        const defaultBody = `# ${name || id}\n\n${description ? `${description}\n\n` : ''}## Workflow\n1. 요구사항과 관련 코드를 먼저 파악한다.\n2. 필요한 최소 범위만 정확하게 수정한다.\n3. 변경 사항을 검증하고 결과를 요약한다.\n`;
        const body = typeof request.body === 'string' && request.body.trim() ? request.body : defaultBody;
        if (body.length > 200000) throw new Error('Workflow body is too large');
        if (typeof runtime.createWorkflow !== 'function') throw new Error('Workflow create not supported');
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
        if (!['none', 'focused', 'balanced', 'swarm'].includes(request.mode)) throw new Error('Unknown orchestration mode');
        await runtime.setOrchestrationMode(request.mode);
    } else if (action !== 'read') throw new Error('Unsupported control action');

    const rawCompaction = runtime.getCompactionSettings?.() || {};
    const compaction = {
        auto: rawCompaction.auto,
        ...(typeof rawCompaction.onModelChange === 'boolean' ? { onModelChange: rawCompaction.onModelChange } : {}),
        ...(typeof rawCompaction.mainBufferPercent === 'number' ? { mainBufferPercent: rawCompaction.mainBufferPercent } : {}),
        ...(typeof rawCompaction.mainBufferTokens === 'number' ? { mainBufferTokens: rawCompaction.mainBufferTokens } : {}),
    };
    const rawAutoClear = typeof runtime.getAutoClear === 'function' ? runtime.getAutoClear() : null;
    const autoClear = rawAutoClear && typeof rawAutoClear === 'object' ? {
        enabled: rawAutoClear.enabled === true,
        idleMs: Number(rawAutoClear.idleMs) || 3600000,
        minContextPercent: Number(rawAutoClear.minContextPercent) || 0,
    } : undefined;
    const models = cachedModels
        ? cachedModels.map(modelProjection)
        : (await runtime.listProviderModels({ force: request.refresh === true })).map(modelProjection);

    return {
        route: { provider: runtime.provider, model: runtime.model, effort: runtime.effort,
            fast: runtime.fast, autoEffort: runtime.autoEffort },
        models,
        compaction,
        ...(autoClear ? { autoClear } : {}),
        workflows: (await runtime.listWorkflows()).map(({ id, name, active, description, source, userOverride }) => ({
            id, name, active,
            ...(typeof description === 'string' && description ? { description } : {}),
            ...(typeof source === 'string' && source ? { source } : {}),
            ...(typeof userOverride === 'boolean' ? { userOverride } : {}),
        })),
        ...(workflowPack ? { workflowPack } : {}),
        orchestration: runtime.getOrchestrationMode(),
        agents: (await runtime.listAgents()).map((row) => ({
            id: row.id, label: row.label || row.id,
            ...(typeof row.description === 'string' && row.description ? { description: row.description } : {}),
            ...(typeof row.custom === 'boolean' ? { custom: row.custom } : {}),
            disabled: row.disabled === true, route: {
                provider: row.route?.provider || '', model: row.route?.model || '',
                effort: row.route?.effort || '', fast: row.route?.fast === true,
                autoEffort: row.route?.autoEffort !== false, inherited: row.route?.inherited === true,
            },
        })),
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
        cwd: home, initialConfig: await native.loadConfig(),
        toolMode: 'readonly', disallowDelegation: true, autoWakeCompletions: false,
    });
    return { native, runtime };
}

// 별도 프로세스에서 전용 프로필만 열며 모델 추론이나 도구 실행은 시작하지 않는다.
export async function runControls(request) {
    const { runtime } = await openControlRuntime();
    try { return await controlRuntime(runtime, request); }
    finally { await runtime.close('paseodog-controls'); }
}

// 상주형 제어 파이프를 통해 매 설정 변경 시 콜드 부팅과 모델 재조회를 생략한다.
export function serveControlsStdio({ input, output, onExit = () => {} }) {
    let runtimePromise = null;
    let cachedModels = null;
    let queue = Promise.resolve();
    let closing = false;
    const write = (frame) => output.write(encodeFrame(frame));
    async function ensureRuntime() {
        if (!runtimePromise) runtimePromise = openControlRuntime();
        return runtimePromise;
    }
    async function stop() {
        if (closing) return;
        closing = true;
        try {
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

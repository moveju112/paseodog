import { defineRpc } from '@getpaseo/plugin';
import { z } from 'zod';

// 열린 세션의 네이티브 기능은 제한된 입력과 명시적인 변경 확인으로만 호출한다.
export const engineSession = defineRpc({
    name: 'engine-session',
    input: z.object({
        sessionId: z.string().min(1).max(200),
        operation: z.enum(['configure', 'fork', 'history', 'changes', 'review', 'undo', 'redo',
            'context', 'quotaRetry', 'quotaSchedule', 'quotaCancel', 'mcpConnect']),
        name: z.string().min(1).max(256).optional(),
        confirmed: z.boolean().optional(),
        checkpointId: z.string().min(1).max(200).optional(),
        file: z.string().min(1).max(4096).optional(),
        revision: z.number().int().nonnegative().optional(),
        messageStart: z.number().int().min(0).optional(),
        changes: z.object({
            model: z.string().min(1).max(512).optional(),
            route: z.object({
                fast: z.boolean().optional(),
                contextPercent: z.number().min(10).max(100).optional(),
                contextTokens: z.number().min(1000).max(2000000).optional(),
            }).strict().optional(),
        }).strict().optional(),
    }).strict(),
    output: z.unknown(),
});

// 확장 관리 입력은 전용 프로필에만 전달하며 임의 메서드 호출은 허용하지 않는다.
export const engineResources = defineRpc({
    name: 'engine-resources',
    input: z.object({
        operation: z.enum(['read', 'mcpAdd', 'mcpSave', 'mcpRemove', 'mcpEnable', 'mcpReconnect',
            'mcpLogin', 'mcpLoginStatus', 'mcpLoginCancel', 'mcpLoginComplete',
            'skillRead', 'skillAdd', 'skillSave', 'skillsReload',
            'pluginAdd', 'pluginUpdate', 'pluginRemove', 'pluginEnable', 'pluginsReload']),
        name: z.string().min(1).max(256).optional(),
        enabled: z.boolean().optional(),
        confirmed: z.boolean().optional(),
        flowId: z.string().min(1).max(200).optional(),
        callbackUrl: z.string().max(8192).optional(),
        data: z.object({
            name: z.string().min(1).max(256).optional(),
            originalName: z.string().min(1).max(256).optional(),
            description: z.string().max(2000).optional(),
            body: z.string().min(1).max(200000).optional(),
            type: z.enum(['stdio', 'http', 'sse']).optional(),
            command: z.string().min(1).max(4096).optional(),
            args: z.array(z.string().max(4096)).max(100).optional(),
            url: z.string().url().max(8192).optional(),
            source: z.string().min(1).max(4096).optional(),
        }).strict().optional(),
    }).strict(),
    output: z.unknown(),
});

export const engineAuth = defineRpc({
    name: 'engine-auth',
    input: z.object({
        action: z.enum(['status', 'start', 'complete', 'cancel', 'selectAccount', 'refreshUsage', 'logout', 'saveApiKey']),
        provider: z.enum([
            'anthropic-oauth', 'openai-oauth',
            'anthropic', 'openai', 'gemini', 'openrouter', 'deepseek', 'xai', 'groq', 'mistral',
        ]),
        id: z.string().uuid().optional(),
        code: z.string().min(1).max(8192).optional(),
        accountId: z.string().min(1).max(256).optional(),
        apiKey: z.string().max(8192).optional(),
    }).strict(),
    output: z.unknown(),
});

export const engineStatus = defineRpc({
    name: 'engine-status',
    input: z.object({}).strict(),
    output: z.unknown(),
});

export const engineMetrics = defineRpc({
    name: 'engine-metrics',
    input: z.object({
        view: z.enum(['1h', '8h', 'hour', '7d', 'day', 'week', 'month', 'all', 'custom']).default('hour'),
        startDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        endDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        // auto: 화면 표시 중 주기 조회, force: 사용자가 누른 새로고침
        refresh: z.enum(['auto', 'force']).optional(),
    }).strict(),
    output: z.unknown(),
});

// 원본 Claude/Codex 스킬·훅 읽기 전용 조회 (편집·실행·동기화 입력 없음)
export const nativeConfigView = defineRpc({
    name: 'native-config-view',
    input: z.object({ source: z.enum(['claude', 'codex']) }).strict(),
    output: z.unknown(),
});

export const engineControls = defineRpc({
    name: 'engine-controls',
    input: z.object({
        action: z.enum([
            'read', 'main', 'agent', 'agentDefinition', 'agentSave', 'agentCreate', 'agentDelete',
            'compaction', 'autoClear', 'workflow', 'workflowPack', 'workflowSave', 'workflowCreate', 'workflowDelete',
            'orchestration', 'instructionFiles', 'features', 'preferences',
        ]).default('read'),
        refresh: z.boolean().optional(),
        agent: z.string().max(100).optional(),
        route: z.object({
            provider: z.string().max(256).optional(), model: z.string().max(256).optional(),
            effort: z.string().max(256).optional(), fast: z.boolean().optional(),
            autoEffort: z.boolean().optional(), disabled: z.boolean().optional(),
            contextPercent: z.number().min(0).max(100).nullable().optional(),
            contextTokens: z.number().min(0).max(2000000).nullable().optional(),
            fallbacks: z.array(z.object({
                provider: z.string().max(256),
                model: z.string().max(256),
                effort: z.string().max(256).optional(),
                fast: z.boolean().optional(),
            })).max(10).optional(),
        }).strict().optional(),
        enabled: z.boolean().optional(),
        onModelChange: z.boolean().optional(),
        mainBufferPercent: z.number().min(0.05).max(0.5).optional(),
        mainBufferTokens: z.number().min(1000).max(500000).optional(),
        summaryModel: z.string().max(256).optional(),
        memoryTimeoutMs: z.number().min(0).max(600000).optional(),
        idleMs: z.number().min(0).max(604800000).nullable().optional(),
        reset: z.boolean().optional(),
        provider: z.string().max(256).optional(),
        resetProvider: z.boolean().optional(),
        minContextPercent: z.number().min(0).max(100).optional(),
        instructionMode: z.enum(['all', 'agents', 'claude', 'off']).optional(),
        recap: z.boolean().optional(),
        memoryTools: z.boolean().optional(),
        webSearch: z.boolean().optional(),
        builtinTool: z.string().max(64).optional(),
        installFeature: z.string().max(64).optional(),
        webSearchRoute: z.object({
            inherited: z.boolean().optional(),
            provider: z.string().max(256).optional(),
            model: z.string().max(256).optional(),
            effort: z.string().max(256).optional(),
        }).optional(),
        outputStyle: z.string().max(100).optional(),
        profile: z.object({
            title: z.string().max(120).optional(),
            language: z.string().max(64).optional(),
            experienceLevel: z.string().max(64).optional(),
        }).optional(),
        aiSessionTitles: z.boolean().optional(),
        shellCommand: z.string().max(512).optional(),
        worktree: z.object({
            newTaskDefault: z.enum(['branch', 'direct', 'ask', 'worktree']).optional(),
            branchPrefix: z.string().max(64).optional(),
            sizeWarnBytes: z.number().min(0).optional(),
            autoCleanup: z.boolean().optional(),
        }).optional(),
        disabledSkills: z.array(z.string().max(120)).max(200).optional(),
        hookAction: z.enum(['add', 'toggle', 'delete']).optional(),
        hookIndex: z.number().int().min(0).optional(),
        hookRule: z.object({
            event: z.string().max(64),
            matcher: z.string().max(256).optional(),
            command: z.string().max(2048),
        }).optional(),
        workflow: z.string().max(100).optional(),
        name: z.string().max(120).optional(),
        description: z.string().max(500).optional(),
        body: z.string().max(200000).optional(),
        activate: z.boolean().optional(),
        mode: z.enum(['none', 'swarm']).optional(),
    }).strict(),
    output: z.unknown(),
});

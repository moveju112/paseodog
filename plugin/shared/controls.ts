import { defineRpc } from '@getpaseo/plugin';
import { z } from 'zod';

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
            newTaskDefault: z.enum(['branch', 'direct', 'ask']).optional(),
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
        mode: z.enum(['none', 'focused', 'balanced', 'swarm']).optional(),
    }).strict(),
    output: z.unknown(),
});

import { defineRpc } from '@getpaseo/plugin';
import { z } from 'zod';

export const engineAuth = defineRpc({
    name: 'engine-auth',
    input: z.object({
        action: z.enum(['status', 'start', 'complete', 'cancel']),
        provider: z.enum(['anthropic-oauth', 'openai-oauth']),
        id: z.string().uuid().optional(),
        code: z.string().min(1).max(8192).optional(),
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
            'read', 'main', 'agent', 'agentDefinition', 'compaction', 'autoClear',
            'workflow', 'workflowPack', 'workflowSave', 'workflowCreate', 'workflowDelete',
            'orchestration', 'instructionFiles',
        ]).default('read'),
        refresh: z.boolean().optional(),
        agent: z.string().max(100).optional(),
        route: z.object({
            provider: z.string().max(256).optional(), model: z.string().max(256).optional(),
            effort: z.string().max(256).optional(), fast: z.boolean().optional(),
            autoEffort: z.boolean().optional(), disabled: z.boolean().optional(),
        }).strict().optional(),
        enabled: z.boolean().optional(),
        onModelChange: z.boolean().optional(),
        mainBufferPercent: z.number().min(0.05).max(0.5).optional(),
        idleMs: z.number().min(60000).max(604800000).optional(),
        minContextPercent: z.number().min(0).max(1).optional(),
        workflow: z.string().max(100).optional(),
        name: z.string().max(120).optional(),
        description: z.string().max(500).optional(),
        body: z.string().max(200000).optional(),
        activate: z.boolean().optional(),
        mode: z.enum(['none', 'focused', 'balanced', 'swarm']).optional(),
    }).strict(),
    output: z.unknown(),
});

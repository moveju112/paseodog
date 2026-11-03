import { defineRpc } from '@getpaseo/plugin';
import { z } from 'zod';

const identity = { agentId: z.string().uuid(), jobId: z.string().regex(/^[a-zA-Z0-9._:-]{1,200}$/) };
export const backgroundResults = defineRpc({
    name: 'background-results',
    input: z.discriminatedUnion('action', [
        z.object({ action: z.literal('status'), agentId: identity.agentId }).strict(),
        z.object({ action: z.literal('register'), ...identity, url: z.string().url().max(4096),
            confirmed: z.literal(true) }).strict(),
        z.object({ action: z.literal('cancel'), ...identity }).strict(),
        z.object({ action: z.literal('delivery'), ...identity, eventId: z.string().regex(/^delivery-result:[a-f0-9]{64}$/),
            status: z.enum(['completed', 'failed', 'running']),
            stage: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).optional(),
            attempt: z.number().int().positive().optional(),
            reason: z.enum(['dependency-missing', 'android-sdk-missing', 'preflight-failed', 'stage-failed']).optional(),
            recovered: z.boolean().optional() }).strict(),
    ]),
    output: z.unknown(),
});

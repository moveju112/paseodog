import { defineRpc } from '@getpaseo/plugin';
import { z } from 'zod';

export const agentMessagePolicy = defineRpc({
    name: 'agent-message-policy',
    input: z.discriminatedUnion('action', [
        z.object({ action: z.literal('read') }).strict(),
        z.object({
            action: z.literal('write'),
            allowUnrelatedSessions: z.boolean(),
        }).strict(),
    ]),
    output: z.object({ allowUnrelatedSessions: z.boolean() }).strict(),
});

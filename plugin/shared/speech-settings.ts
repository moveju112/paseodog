import { defineRpc } from '@getpaseo/plugin';
import { z } from 'zod';

export const speechSettings = defineRpc({
    name: 'speech-settings',
    input: z.discriminatedUnion('action', [
        z.object({ action: z.literal('read') }).strict(),
        z.object({
            action: z.literal('write'),
            model: z.string(),
            revision: z.string().regex(/^[a-f0-9]{64}$/),
        }).strict(),
    ]),
    output: z.object({
        model: z.string().nullable(),
        revision: z.string(),
        blocked: z.boolean(),
        models: z.array(z.object({
            id: z.string(), label: z.string(), description: z.string(), warning: z.string(),
        }).strict()),
    }).strict(),
});

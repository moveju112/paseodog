import { defineRpc } from '@getpaseo/plugin';
import { z } from 'zod';

// 앱 오류의 허용 필드·길이를 고정하고 보고와 삭제 입력을 분리한다.
export const clientErrors = defineRpc({
    name: 'client-errors',
    input: z.discriminatedUnion('action', [
        z.object({
            action: z.literal('report'),
            events: z.array(z.object({
                id: z.string().uuid(),
                timestamp: z.number().finite(),
                source: z.string().min(1).max(64),
                stage: z.string().min(1).max(64).optional(),
                code: z.string().min(1).max(64),
                message: z.string().max(2048),
                stack: z.string().max(8192).optional(),
                appVersion: z.string().min(1).max(64),
                platform: z.enum(['android', 'ios', 'web', 'desktop']),
                osVersion: z.string().max(64).optional(),
            }).strict()).max(20),
        }).strict(),
        z.object({ action: z.literal('clear') }).strict(),
    ]),
    output: z.object({ accepted: z.number().int().nonnegative() }).strict(),
});

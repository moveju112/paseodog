import type { UsageSourceRegistration, UsageReport } from '@getpaseo/plugin/server/usage';
import { z } from 'zod';

// 인증 파일을 직접 읽지 않고 전용 Mixdog 런타임에 사용량 갱신을 맡긴다.
export function createClaudeUsageSource(controls: { usage(): Promise<UsageReport> }): UsageSourceRegistration {
    return {
        id: 'claude',
        label: 'Claude',
        input: z.object({}).strict(),
        async discover(scope) {
            if (scope.kind === 'session' && scope.provider !== 'paseodog') return [];
            return [{ key: 'mixdog-anthropic-oauth', harness: 'Mixdog', input: {} }];
        },
        fetch: () => controls.usage(),
    };
}

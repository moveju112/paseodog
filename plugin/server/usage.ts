import type { UsageSourceRegistration, UsageReport } from '@getpaseo/plugin/server/usage';
import { z } from 'zod';

type UsageProvider = 'anthropic-oauth' | 'openai-oauth';
type UsageControls = { usage(provider: UsageProvider): Promise<UsageReport> };

// 독립 CLI의 인증 파일은 건드리지 않고 전용 런타임의 선택된 계정을 조회한다.
function createOAuthUsageSource(controls: UsageControls, provider: UsageProvider): UsageSourceRegistration {
    const codex = provider === 'openai-oauth';
    return {
        id: codex ? 'paseodog-codex' : 'claude',
        label: codex ? 'Codex (PaseoDog)' : 'Claude',
        // 데몬은 icon을 플러그인 폴더 기준 SVG 파일 경로로 읽는다.
        icon: codex ? 'shared/codex-usage-icon.svg' : 'shared/claude-usage-icon.svg',
        input: z.object({}).strict(),
        async discover(scope) {
            if (scope.kind === 'session' && scope.provider !== 'paseodog') return [];
            return [{ key: `mixdog-${provider}`, harness: 'Mixdog', input: {} }];
        },
        fetch: () => controls.usage(provider),
    };
}

export function createClaudeUsageSource(controls: UsageControls): UsageSourceRegistration {
    return createOAuthUsageSource(controls, 'anthropic-oauth');
}

export function createCodexUsageSource(controls: UsageControls): UsageSourceRegistration {
    return createOAuthUsageSource(controls, 'openai-oauth');
}

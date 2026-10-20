import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import { mergeProviderPreferences, type FormPreferences } from "./preferences";
import type { FormPreferenceUpdate } from "./service";

// 세션 변경 확인 -> 다음 세션 선호 저장. 거절된 선택은 기억하지 않는다.
export async function setAgentThinkingOptionAndRemember(input: {
    client: Pick<DaemonClient, "setAgentThinkingOption">;
    agentId: string;
    provider: AgentProvider;
    modelId: string | null;
    thinkingOptionId: string;
    updatePreferences: (update: FormPreferenceUpdate) => Promise<FormPreferences>;
}) {
    const notice = await input.client.setAgentThinkingOption(input.agentId, input.thinkingOptionId);
    const modelId = input.modelId;
    if (modelId) {
        await input.updatePreferences((preferences) =>
            mergeProviderPreferences({
                preferences,
                provider: input.provider,
                updates: {
                    model: modelId,
                    thinkingByModel: { [modelId]: input.thinkingOptionId },
                },
            }),
        );
    }
    return notice;
}

// 세션 기능 저장 확인 -> 다음 세션 기능 선호 저장. 실패한 요청은 재전송하지 않는다.
export async function setAgentFeatureAndRemember(input: {
    client: Pick<DaemonClient, "setAgentFeature">;
    agentId: string;
    provider: AgentProvider;
    featureId: string;
    value: unknown;
    updatePreferences: (update: FormPreferenceUpdate) => Promise<FormPreferences>;
}) {
    await input.client.setAgentFeature(input.agentId, input.featureId, input.value);
    await input.updatePreferences((preferences) =>
        mergeProviderPreferences({
            preferences,
            provider: input.provider,
            updates: { featureValues: { [input.featureId]: input.value } },
        }),
    );
}

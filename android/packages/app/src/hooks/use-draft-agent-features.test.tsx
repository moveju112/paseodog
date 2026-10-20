// @vitest-environment jsdom
import React, { type PropsWithChildren } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
    client: { invokePluginRpc: vi.fn(), listProviderFeatures: vi.fn() },
    updatePreferences: vi.fn(),
}));
vi.mock("@/runtime/host-runtime", () => ({
    useHostRuntimeClient: () => host.client,
    useHostRuntimeIsConnected: () => true,
}));
vi.mock("@/hooks/use-app-visible", () => ({ useAppActivelyVisible: () => true }));
vi.mock("react-i18next", async (original) => ({
    ...await original<typeof import("react-i18next")>(),
    useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("./use-form-preferences", async (original) => ({
    ...await original<typeof import("./use-form-preferences")>(),
    useFormPreferences: () => ({
        preferences: { providerPreferences: { paseodog: { featureValues: { autoEffort: false } } } },
        updatePreferences: host.updatePreferences,
    }),
}));
import { useDraftAgentFeatures } from "./use-draft-agent-features";
import { usePaseodogAutoEffort } from "@/components/paseodog-auto-effort";
import { AUTO_EFFORT_ID } from "@/components/paseodog-auto-effort";
import { buildWorkspaceDraftAgentConfig } from "@/screens/workspace/workspace-draft-agent-config";
import { buildDraftCommandTarget } from "@/provider-selection/provider-selection";

// 실제 Query 캐시를 쓰되 테스트 사이 호스트와 조회 결과는 분리한다.
function wrapper({ children }: PropsWithChildren) {
    const [client] = React.useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
    host.client = { invokePluginRpc: vi.fn(), listProviderFeatures: vi.fn().mockResolvedValue({
        features: [{ id: "autoEffort", type: "toggle", label: "Auto", value: false }],
    }) };
    host.updatePreferences.mockReset().mockResolvedValue({});
});
afterEach(cleanup);

describe("draft Auto creation configuration", () => {
    it.each([true, false])("submits confirmed Main Auto=%s separately from remembered Low", async (autoEffort) => {
        host.client.invokePluginRpc.mockResolvedValue({
            route: { autoEffort }, toolModules: { autoEffort: { enabled: true, supported: true } },
        });
        const { result } = renderHook(() => useDraftAgentFeatures({
            serverId: "host", provider: "paseodog", cwd: "/work", modeId: "ask",
            modelId: "test/model", thinkingOptionId: "low",
        }), { wrapper });
        await waitFor(() => expect(result.current.featureValues?.autoEffort).toBe(autoEffort));
        const config = buildWorkspaceDraftAgentConfig({
            provider: "paseodog", cwd: "/work", model: "test/model", thinkingOptionId: "low",
            featureValues: result.current.featureValues,
        });
        expect(config).toMatchObject({ thinkingOptionId: "low", featureValues: { autoEffort } });
        const command = buildDraftCommandTarget({
            selection: {
                provider: "paseodog", modelId: "test/model", thinkingOptionId: "low",
                modeId: "ask", modeOptions: [], availableModels: [],
            },
            cwd: "/work", effectiveModelId: "test/model", effectiveThinkingOptionId: "low",
            featureValues: result.current.featureValues,
        });
        expect(command).toMatchObject({ status: "ready", config: { featureValues: { autoEffort } } });
        expect(host.updatePreferences).not.toHaveBeenCalled();
    });

    it("keeps the confirmed Auto baseline while manual disable is pending, then submits manual", async () => {
        let resolve!: (value: unknown) => void;
        host.client.invokePluginRpc.mockImplementation(async (_plugin, _method, command) => {
            if (command.action === "main") return new Promise((accept) => { resolve = accept; });
            return { route: { autoEffort: true }, toolModules: { autoEffort: { enabled: true } } };
        });
        const select = vi.fn();
        const { result } = renderHook(() => ({
            draft: useDraftAgentFeatures({
                serverId: "host", provider: "paseodog", cwd: "/work", modeId: "ask",
                modelId: "test/model", thinkingOptionId: "low",
            }),
            controls: usePaseodogAutoEffort({
                serverId: "host", provider: "paseodog", scope: "draft",
                thinkingOptions: [{ id: "low", label: "Low" }],
                selectedThinkingOptionId: "low", onSelectThinkingOption: select,
            }),
        }), { wrapper });
        await waitFor(() => expect(result.current.controls.selectedThinkingOptionId).toBe(AUTO_EFFORT_ID));
        act(() => result.current.controls.onSelectThinkingOption("low"));
        expect(select).not.toHaveBeenCalled();
        expect(result.current.draft.featureValues?.autoEffort).toBe(true);
        await act(async () => resolve({
            route: { autoEffort: false }, toolModules: { autoEffort: { enabled: true } },
        }));
        expect(select).toHaveBeenCalledExactlyOnceWith("low");
        expect(result.current.draft.featureValues?.autoEffort).toBe(false);
        expect(host.client.invokePluginRpc.mock.calls.filter((call) => call[2].action === "main")).toHaveLength(1);
    });
});

/**
 * @vitest-environment jsdom
 */
import { render, act } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientErrorReportingRuntime, captureClientError, clearClientErrorReports, clearLocalClientErrorReports } from "./client-error-runtime";

const runtime = vi.hoisted(() => ({
    pathname: "/h/active/workspace",
    connected: false,
    enabled: true,
    loading: false,
    invokePluginRpc: vi.fn(),
    onDesktopError: vi.fn(),
    unsubscribeDesktop: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "android", Version: 35 } }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "00000000-0000-4000-8000-000000000001" }));
vi.mock("expo-router", () => ({ usePathname: () => runtime.pathname }));
vi.mock("@/desktop/host", () => ({
    isElectronRuntime: () => false,
    getDesktopHost: () => ({ errors: { onError: runtime.onDesktopError } }),
}));
vi.mock("@/utils/app-version", () => ({ resolveAppVersion: () => "0.11.4" }));
vi.mock("@/hooks/use-settings", () => ({
    useAppSettings: () => ({ settings: {
        clientErrorReportingEnabled: runtime.enabled, clientErrorRetentionDays: 7,
    }, isLoading: runtime.loading }),
}));
const client = { invokePluginRpc: runtime.invokePluginRpc };
vi.mock("@/runtime/host-runtime", () => ({
    useHostRuntimeClient: () => client,
    useHostRuntimeIsConnected: () => runtime.connected,
}));

afterEach(() => {
    runtime.pathname = "/h/active/workspace";
    runtime.connected = false;
    runtime.enabled = true;
    runtime.loading = false;
    vi.clearAllMocks();
});

describe("client error runtime integration", () => {
    it("flushes offline errors on reconnect, keeps active host in global settings and exposes clear", async () => {
        runtime.invokePluginRpc.mockImplementation(async (_plugin, _method, input) => ({
            accepted: input.action === "clear" ? 0 : input.events.length,
        }));
        runtime.onDesktopError.mockReturnValue(runtime.unsubscribeDesktop);
        const view = render(<ClientErrorReportingRuntime />);
        const originalConsole = console.error;
        act(() => captureClientError(new Error("private"), "image-picker", "launch"));
        expect(runtime.invokePluginRpc).not.toHaveBeenCalled();
        runtime.connected = true;
        await act(async () => { view.rerender(<ClientErrorReportingRuntime />); });
        expect(runtime.invokePluginRpc).toHaveBeenCalledTimes(1);
        runtime.pathname = "/settings/privacy";
        await act(async () => { view.rerender(<ClientErrorReportingRuntime />); });
        await expect(clearClientErrorReports("active", client)).resolves.toBe(true);
        expect(runtime.invokePluginRpc).toHaveBeenLastCalledWith("paseodog-provider", "client-errors", { action: "clear" });
        view.unmount();
        expect(console.error).not.toBe(originalConsole);
        expect(runtime.unsubscribeDesktop).toHaveBeenCalledOnce();
    });

    it("drops reports before settings load and on disabling", async () => {
        runtime.loading = true;
        const view = render(<ClientErrorReportingRuntime />);
        captureClientError(new Error("private"), "image-picker", "launch");
        runtime.loading = false;
        view.rerender(<ClientErrorReportingRuntime />);
        captureClientError(new Error("private"), "image-picker", "launch");
        runtime.enabled = false;
        view.rerender(<ClientErrorReportingRuntime />);
        runtime.connected = true;
        view.rerender(<ClientErrorReportingRuntime />);
        await act(async () => {});
        expect(runtime.invokePluginRpc).not.toHaveBeenCalled();
        view.unmount();
    });

    it("permits clear on the explicitly selected host settings route but never on other hosts", async () => {
        runtime.pathname = "/settings/hosts/chosen/privacy";
        runtime.connected = true;
        runtime.invokePluginRpc.mockResolvedValue({ accepted: 0 });
        const view = render(<ClientErrorReportingRuntime />);
        await expect(clearClientErrorReports("other", client)).resolves.toBe(false);
        expect(runtime.invokePluginRpc).not.toHaveBeenCalled();
        await expect(clearClientErrorReports("chosen", client)).resolves.toBe(true);
        view.unmount();
    });

    it("routes safe desktop main events through the same active-host queue", async () => {
        const view = render(<ClientErrorReportingRuntime />);
        const callback = runtime.onDesktopError.mock.calls.at(-1)![0];
        callback({
            source: "desktop-main", kind: "console-error", code: "MAIN_CONSOLE_ERROR",
            name: "TypeError", frames: [], diagnosticLoss: "message-stack-properties-arguments-omitted",
            message: "private prompt",
        });
        runtime.connected = true;
        await act(async () => { view.rerender(<ClientErrorReportingRuntime />); });
        const event = runtime.invokePluginRpc.mock.calls[0][2].events[0];
        expect(event).toMatchObject({ source: "desktop-main", code: "MAIN_CONSOLE_ERROR", message: "TypeError captured" });
        expect(event).not.toHaveProperty("stack");
        expect(JSON.stringify(event)).not.toContain("private");
        view.unmount();
    });

    it("exports local-only clear for a UI-owned server RPC without double deletion", async () => {
        const view = render(<ClientErrorReportingRuntime />);
        captureClientError(new Error("private"), "image-picker", "launch");
        await expect(clearLocalClientErrorReports("active")).resolves.toBe(true);
        runtime.connected = true;
        await act(async () => { view.rerender(<ClientErrorReportingRuntime />); });
        expect(runtime.invokePluginRpc).not.toHaveBeenCalled();
        view.unmount();
    });
});

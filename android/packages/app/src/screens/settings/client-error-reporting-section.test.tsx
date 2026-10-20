// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const state = vi.hoisted(() => ({
  connected: true,
  client: { invokePluginRpc: vi.fn() } as { invokePluginRpc: ReturnType<typeof vi.fn> } | null,
  settings: { clientErrorReportingEnabled: true, clientErrorRetentionDays: 7 },
  updateSettings: vi.fn(),
  clearLocalClientErrorReports: vi.fn(),
}));

vi.mock("@/diagnostics/client-error-runtime", () => ({
  clearLocalClientErrorReports: state.clearLocalClientErrorReports,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => state.client,
  useHostRuntimeIsConnected: () => state.connected,
}));
vi.mock("@/hooks/use-settings", () => ({
  CLIENT_ERROR_RETENTION_DAYS: [1, 7, 30],
  useAppSettings: () => ({ settings: state.settings, updateSettings: state.updateSettings }),
}));

interface MockRowProps {
  label: string;
  hint?: React.ReactNode;
  error?: string;
  children?: React.ReactNode;
}
vi.mock("@/components/settings", () => {
  // 설정 행 스텁 (라벨·힌트·오류 -> DOM)
  function SettingsRow({ label, hint, error, children }: MockRowProps) {
    return (
      <div>
        <span>{label}</span>
        <span>{hint}</span>
        {error ? <span role="alert">{error}</span> : null}
        {children}
      </div>
    );
  }
  return {
    SettingsSection: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
    SettingsCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SettingsRow,
    SettingsSwitch: ({
      label,
      value,
      onValueChange,
    }: MockRowProps & { value: boolean; onValueChange: (value: boolean) => void }) => (
      <input
        type="checkbox"
        aria-label={label}
        checked={value}
        onChange={(event) => onValueChange(event.target.checked)}
      />
    ),
    SettingsSelect: ({
      label,
      value,
      options,
      onValueChange,
    }: MockRowProps & {
      value: string;
      options: { value: string; label: string }[];
      onValueChange: (value: string) => void;
    }) => (
      <select aria-label={label} value={value} onChange={(event) => onValueChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    ),
  };
});
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    disabled,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));

import { ClientErrorReportingSection } from "./client-error-reporting-section";

const KEY = "settings.diagnostics.errorReporting";

beforeEach(() => {
  state.connected = true;
  state.client = { invokePluginRpc: vi.fn().mockResolvedValue({ accepted: 0 }) };
  state.settings = { clientErrorReportingEnabled: true, clientErrorRetentionDays: 7 };
  state.updateSettings = vi.fn();
  state.clearLocalClientErrorReports.mockReset();
  state.clearLocalClientErrorReports.mockResolvedValue(true);
});
afterEach(cleanup);

describe("ClientErrorReportingSection", () => {
  it("saves the opt-out and a valid retention choice", () => {
    render(<ClientErrorReportingSection serverId="host-1" />);

    fireEvent.click(screen.getByLabelText(`${KEY}.enabled.label`));
    fireEvent.change(screen.getByLabelText(`${KEY}.retention.label`), {
      target: { value: "30" },
    });

    expect(state.updateSettings).toHaveBeenCalledWith({ clientErrorReportingEnabled: false });
    expect(state.updateSettings).toHaveBeenCalledWith({ clientErrorRetentionDays: 30 });
  });

  it("clears the local queue first, then sends one daemon clear RPC", async () => {
    const order: string[] = [];
    state.clearLocalClientErrorReports.mockImplementation(async () => {
      order.push("local");
      return true;
    });
    state.client?.invokePluginRpc.mockImplementation(async () => {
      order.push("rpc");
      return { accepted: 0 };
    });
    render(<ClientErrorReportingSection serverId="host-1" />);

    fireEvent.click(screen.getByText(`${KEY}.delete.action`));

    await waitFor(() => expect(screen.getByText(`${KEY}.delete.success`)).toBeTruthy());
    expect(order).toEqual(["local", "rpc"]);
    expect(state.clearLocalClientErrorReports).toHaveBeenCalledTimes(1);
    expect(state.client?.invokePluginRpc).toHaveBeenCalledTimes(1);
    expect(state.client?.invokePluginRpc).toHaveBeenCalledWith(
      "paseodog-provider",
      "client-errors",
      { action: "clear" },
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reports a disconnected daemon without sending RPC or claiming deletion", async () => {
    state.connected = false;
    render(<ClientErrorReportingSection serverId="host-1" />);

    fireEvent.click(screen.getByText(`${KEY}.delete.action`));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(`${KEY}.delete.local.cleared`);
    expect(alert.textContent).toContain(`${KEY}.delete.host.unavailable`);
    expect(state.client?.invokePluginRpc).not.toHaveBeenCalled();
    expect(screen.queryByText(`${KEY}.delete.success`)).toBeNull();
  });

  it("treats a refused local clear and a rejected daemon clear as failures", async () => {
    state.clearLocalClientErrorReports.mockResolvedValue(false);
    state.client?.invokePluginRpc.mockRejectedValue(new Error("Client error clear failed"));
    render(<ClientErrorReportingSection serverId="host-1" />);

    fireEvent.click(screen.getByText(`${KEY}.delete.action`));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(`${KEY}.delete.local.failed`);
    expect(alert.textContent).toContain(`${KEY}.delete.host.failed`);
  });

  it("does not count a malformed daemon response as deletion", async () => {
    state.client?.invokePluginRpc.mockResolvedValue({ ok: true });
    render(<ClientErrorReportingSection serverId="host-1" />);

    fireEvent.click(screen.getByText(`${KEY}.delete.action`));

    expect((await screen.findByRole("alert")).textContent).toContain(
      `${KEY}.delete.host.failed`,
    );
  });
});

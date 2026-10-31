/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@/stores/session-store";
import { useRecentSessionsStore } from "@/stores/recent-sessions-store";
import { SidebarRecentSessions } from "./sidebar-recent-sessions";

const state = vi.hoisted(() => ({
  agent: {} as Agent,
  clearAgentAttention: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn(),
}));
vi.stubGlobal("React", React);
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/use-time-ago", () => ({ useCompactTimeAgo: () => "now" }));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (value: unknown) => unknown) =>
    selector({ sessions: { host: { agents: new Map([[state.agent.id, state.agent]]) } } }),
}));
vi.mock("@/stores/workspace-layout-store", () => ({
  useWorkspaceLayoutStore: (selector: (value: unknown) => unknown) =>
    selector({ layoutByWorkspace: {} }),
}));
vi.mock("@/stores/session-reveal-store", () => ({ requestSessionReveal: vi.fn() }));
vi.mock("@/utils/navigate-to-agent", () => ({ navigateToAgent: state.navigate }));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({
    getClient: () => ({ clearAgentAttention: state.clearAgentAttention }),
  }),
}));
vi.mock("@/components/sidebar/sidebar-workspace-row-content", () => ({
  WorkspaceStatusIndicator: ({ bucket }: { bucket: string }) => <span>{bucket}</span>,
}));

beforeEach(() => {
  vi.clearAllMocks();
  useRecentSessionsStore.setState(useRecentSessionsStore.getInitialState());
  state.agent = {
    id: "session",
    serverId: "host",
    workspaceId: "workspace",
    title: "Recent session",
    status: "idle",
    requiresAttention: true,
    attentionReason: "finished",
    pendingPermissions: [],
    lastUserMessageAt: new Date(),
  } as unknown as Agent;
});
afterEach(cleanup);

describe("recent session attention", () => {
  it("keeps the original compact height and leaves only a narrow gap before hide", () => {
    render(<SidebarRecentSessions />);
    const row = screen.getByTestId("sidebar-recent-session-host-session");
    const hide = screen.getByRole("button", { name: "sidebar.recentSessions.hide" });
    expect(row.style.minHeight).toBe("30px");
    expect(hide.style.minHeight).toBe("30px");
    expect(hide.style.minWidth).toBe("24px");
    expect(row.style.paddingRight).toBe("0px");
    expect(screen.getByTestId("sidebar-recent-sessions-rows").style.maxHeight).toBe("186px");
  });

  it("hides only the recent entry without navigating or changing the session", () => {
    const beforeNavigate = vi.fn();
    const original = { ...state.agent };
    render(<SidebarRecentSessions onBeforeNavigate={beforeNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "sidebar.recentSessions.hide" }));
    expect(screen.queryByText("Recent session")).toBeNull();
    expect(state.agent).toEqual(original);
    expect(state.navigate).not.toHaveBeenCalled();
    expect(state.clearAgentAttention).not.toHaveBeenCalled();
    expect(beforeNavigate).not.toHaveBeenCalled();
  });

  it("acknowledges completion on every explicit selection, even without a focus change", () => {
    render(<SidebarRecentSessions />);
    fireEvent.click(screen.getByText("Recent session"));
    expect(state.clearAgentAttention).toHaveBeenCalledWith("session");
    fireEvent.click(screen.getByText("Recent session"));
    expect(state.clearAgentAttention).toHaveBeenCalledTimes(2);
    expect(state.navigate).toHaveBeenCalledTimes(2);
  });

  it.each(["permission", "error"] as const)("does not clear %s when navigating", (reason) => {
    state.agent.attentionReason = reason;
    render(<SidebarRecentSessions />);
    fireEvent.click(screen.getByText("Recent session"));
    expect(state.clearAgentAttention).not.toHaveBeenCalled();
    expect(state.navigate).toHaveBeenCalledOnce();
  });

  it("keeps navigation available when acknowledgement fails", async () => {
    state.clearAgentAttention.mockRejectedValueOnce(new Error("Disconnected"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(<SidebarRecentSessions />);
      fireEvent.click(screen.getByText("Recent session"));
      await vi.waitFor(() => expect(error).toHaveBeenCalled());
      expect(state.navigate).toHaveBeenCalledOnce();
    } finally {
      error.mockRestore();
    }
  });
});

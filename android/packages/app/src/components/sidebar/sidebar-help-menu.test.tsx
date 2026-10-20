/**
 * @vitest-environment jsdom
 */
import React, { type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarHelpMenu } from "./sidebar-help-menu";

// 모듈 수준 JSX가 평가되기 전에 React 전역과 테스트 상태를 준비한다.
const state = await vi.hoisted(async () => {
  const react = await import("react");
  vi.stubGlobal("React", react);
  return {
    shortcutsAvailable: true,
    openDiagnostics: vi.fn(),
    openChangelog: vi.fn(),
    setShortcutsDialogOpen: vi.fn(),
  };
});

// 네이티브 메뉴 표시 계층만 격리하고 실제 도움말 항목과 콜백을 렌더링한다.
function Passthrough({ children }: { children?: ReactNode }) {
  return children;
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => true }));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: Passthrough,
  TooltipTrigger: Passthrough,
  TooltipContent: () => null,
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: Passthrough,
  DropdownMenuContent: Passthrough,
  DropdownMenuLabel: Passthrough,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: () => null,
  // 항목 선택을 실제 onSelect 경로에 연결한다.
  DropdownMenuItem({
    children,
    testID,
    onSelect,
  }: {
    children: ReactNode;
    testID: string;
    onSelect: () => void;
  }) {
    return (
      <button type="button" data-testid={testID} onClick={onSelect}>
        {children}
      </button>
    );
  },
  // 앱·호스트 버전의 라벨과 후행 값을 그대로 노출한다.
  DropdownMenuHint({
    children,
    trailing,
    testID,
  }: {
    children: ReactNode;
    trailing: ReactNode;
    testID: string;
  }) {
    return (
      <div data-testid={testID}>
        {children}
        {trailing}
      </div>
    );
  },
}));
vi.mock("@/diagnostics/store", () => ({
  useAppDiagnosticStore: (selector: (value: { open: () => void }) => unknown) =>
    selector({ open: state.openDiagnostics }),
}));
vi.mock("@/keyboard/availability", () => ({
  useKeyboardShortcutsAvailable: () => state.shortcutsAvailable,
}));
vi.mock("@/stores/keyboard-shortcuts-store", () => ({
  useKeyboardShortcutsStore: (
    selector: (value: { setShortcutsDialogOpen: (open: boolean) => void }) => unknown,
  ) => selector({ setShortcutsDialogOpen: state.setShortcutsDialogOpen }),
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => [{ serverId: "workstation", label: "Workstation" }],
  useHostRuntimeIsConnected: () => true,
}));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: (
    selector: (value: {
      sessions: { workstation: { serverInfo: { version: string } } };
    }) => unknown,
  ) => selector({ sessions: { workstation: { serverInfo: { version: "0.11.4" } } } }),
}));
vi.mock("@/desktop/updates/desktop-updates", () => ({
  formatVersionWithPrefix: (version: string) => `v${version}`,
}));
vi.mock("@/utils/app-version", () => ({ resolveAppVersion: () => "1.2.3" }));
vi.mock("@/changelog", () => ({ openChangelog: state.openChangelog }));

beforeEach(() => {
  vi.clearAllMocks();
  state.shortcutsAvailable = true;
});
afterEach(cleanup);

describe("SidebarHelpMenu", () => {
  it("removes the report group while retaining help actions and app/host versions", () => {
    const { container } = render(<SidebarHelpMenu />);
    expect(screen.queryByTestId("sidebar-help-discord")).toBeNull();
    expect(screen.queryByTestId("sidebar-help-github")).toBeNull();
    expect(screen.queryByText("sidebar.help.reportIssue")).toBeNull();
    expect(container.querySelectorAll("hr")).toHaveLength(1);
    expect(screen.getByTestId("sidebar-help-version").textContent).toBe(
      "sidebar.help.appNamev1.2.3",
    );
    expect(screen.getByTestId("sidebar-help-host-version-workstation").textContent).toBe(
      "Workstationv0.11.4",
    );
    fireEvent.click(screen.getByTestId("sidebar-help-shortcuts"));
    fireEvent.click(screen.getByTestId("sidebar-help-changelog"));
    fireEvent.click(screen.getByTestId("sidebar-help-diagnostics"));
    expect(state.setShortcutsDialogOpen).toHaveBeenCalledWith(true);
    expect(state.openChangelog).toHaveBeenCalledTimes(1);
    expect(state.openDiagnostics).toHaveBeenCalledTimes(1);
  });

  it("preserves shortcut availability gating without removing remaining help", () => {
    state.shortcutsAvailable = false;
    render(<SidebarHelpMenu />);
    expect(screen.queryByTestId("sidebar-help-shortcuts")).toBeNull();
    expect(screen.getAllByTestId("sidebar-help-changelog")).toHaveLength(1);
    expect(screen.getAllByTestId("sidebar-help-diagnostics")).toHaveLength(1);
    expect(screen.getAllByTestId("sidebar-help-version")).toHaveLength(1);
  });
});

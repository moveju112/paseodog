/**
 * @vitest-environment jsdom
 */
import React, { useCallback, type ComponentProps, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginSidebarItem as SidebarItem } from "@/plugins/sidebar-items";
import type { PluginSidebarNavItem, SidebarNavItem } from "@/sidebar-nav/model";
import { LeftSidebar } from "./left-sidebar";

// 모듈 수준 JSX가 평가되기 전에 React 전역과 테스트 상태를 준비한다.
const state = await vi.hoisted(async () => {
  const react = await import("react");
  vi.stubGlobal("React", react);
  return {
    items: new Array<SidebarNavItem<"footer">>(),
    hasUsageSummary: true,
    closeSidebar: vi.fn(),
    inspectAnchor: vi.fn(),
  };
});

// 작업 목록·오버레이 대신 자식만 렌더링해 실제 하단 도구줄을 격리한다.
function Passthrough({ children }: { children?: ReactNode }) {
  return children;
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
// 공용 아이콘 스텁에 없는 사용량 아이콘만 기존 원형 스텁으로 보완한다.
vi.mock("lucide-react-native", async (importOriginal) => {
  const icons = await importOriginal<typeof import("lucide-react-native")>();
  return { ...icons, CircleGauge: icons.CircleDot };
});
vi.mock("@/constants/layout", () => ({
  HEADER_INNER_HEIGHT: 40,
  useIsCompactFormFactor: () => true,
}));
vi.mock("react-native-gesture-handler", () => ({ Gesture: {} }));
vi.mock("react-native-reanimated", () => ({
  default: { View: Passthrough },
  runOnJS: vi.fn(),
  useAnimatedStyle: vi.fn(),
  useSharedValue: vi.fn(),
}));
vi.mock("react-native-worklets", () => ({ scheduleOnRN: vi.fn() }));
vi.mock("@/hooks/use-open-add-project", () => ({ useOpenAddProject: () => vi.fn() }));
vi.mock("@/hooks/use-import-session", () => ({
  useImportSession: () => ({ open: vi.fn(), sheet: null }),
}));
vi.mock("@/hooks/use-shortcut-keys", () => ({ useShortcutKeys: () => undefined }));
vi.mock("@/components/sidebar/sidebar-model", () => ({
  useSidebarModel: () => ({
    projects: [],
    hasProjectsBeforeFilter: false,
    resolvedProjectFilters: [],
    workspaceEntriesByKey: new Map(),
    isInitialLoad: false,
    isRevalidating: false,
    refreshAll: vi.fn(),
    workspaceGroups: [],
    projectIconTargets: [],
    pinnedGroups: [],
    collapsedProjectKeys: new Set(),
    toggleProjectCollapsed: vi.fn(),
    groupMode: "project",
    shortcutModel: { shortcutIndexByWorkspaceKey: new Map() },
  }),
}));
vi.mock("@/stores/panel-store", () => ({
  usePanelStore: (selector: (value: { showMobileAgent: () => void }) => unknown) =>
    selector({ showMobileAgent: state.closeSidebar }),
}));
vi.mock("@/stores/sidebar-view-store", () => ({
  useSidebarViewStore: (selector: (value: { hostFilters: string[] }) => unknown) =>
    selector({ hostFilters: [] }),
}));
vi.mock("@/runtime/host-runtime", () => ({ useHosts: () => [] }));
vi.mock("@/sidebar-nav/use-sidebar-nav-items", () => ({
  useSidebarNavItems: () => ({ items: state.items }),
}));
vi.mock("@/plugins/sidebar-items", () => ({
  // 기존 렌더러에 전달된 팝오버 기준점과 탐색 콜백을 사용자 클릭으로 확인한다.
  PluginSidebarItem({
    group,
    section,
    fallbackAnchorRef,
    onBeforeNavigate,
  }: ComponentProps<typeof SidebarItem>) {
    // 클릭 시 현재 기준점을 기록하고 기존 탐색 콜백을 호출한다.
    const handleClick = useCallback(() => {
      state.inspectAnchor(fallbackAnchorRef.current);
      onBeforeNavigate?.();
    }, [fallbackAnchorRef, onBeforeNavigate]);
    return (
      <button type="button" data-section={section} onClick={handleClick}>
        {group.contributionId}
      </button>
    );
  },
}));
vi.mock("@/usage", () => ({
  UsageSidebarRoot: Passthrough,
  UsageSidebarItem: () => <span data-testid="usage-row">Usage</span>,
  useHasUsageSummary: () => state.hasUsageSummary,
  useOpenSidebarUsage: () => vi.fn(),
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: Passthrough,
  TooltipTrigger: Passthrough,
  TooltipContent: () => null,
}));
vi.mock("@/components/ui/shortcut", () => ({ Shortcut: () => null }));
vi.mock("@/components/hosts/host-picker", () => ({ HostPicker: Passthrough }));
vi.mock("@/components/retained-panel", () => ({ RetainedPanelActivity: Passthrough }));
vi.mock("@/components/desktop/titlebar-drag-region", () => ({
  TitlebarDragRegion: () => null,
}));
vi.mock("@/components/sidebar/display-preferences/menu", () => ({
  SidebarDisplayPreferencesMenu: () => null,
}));
vi.mock("@/components/sidebar/sidebar-nav-rows", () => ({ SidebarNavRows: () => null }));
vi.mock("@/components/sidebar/sidebar-help-menu", () => ({ SidebarHelpMenu: () => null }));
vi.mock("@/components/sidebar-resize-handle", () => ({ SidebarResizeHandle: () => null }));
vi.mock("@/components/sidebar-workspace-list", () => ({ SidebarWorkspaceList: () => null }));
vi.mock("@/components/sidebar/sidebar-recent-sessions", () => ({
  SidebarRecentSessions: () => null,
}));
vi.mock("@/components/sidebar-agent-list-skeleton", () => ({
  SidebarAgentListSkeleton: () => null,
}));
vi.mock("@/components/sidebar-callout-slot", () => ({ SidebarCalloutSlot: () => null }));
vi.mock("@/utils/desktop-window", () => ({
  useOwnsWindowChromeCorner: () => false,
  WindowChromeSafeArea: Passthrough,
}));
vi.mock("@/mobile-panels/gestures", () => ({
  useCloseAgentListGesture: () => ({ gesture: null, gestureRef: null }),
}));
vi.mock("@/mobile-panels/presentation", () => ({ MobilePanelOverlay: Passthrough }));
vi.mock("@/navigation/settings-navigation", () => ({ openHostOverview: vi.fn() }));

// 플러그인 식별자·기여 항목·표시 여부만 다른 하단 항목을 만든다.
function pluginItem(
  pluginId: string,
  contributionId: string,
  visible = true,
): PluginSidebarNavItem {
  return {
    kind: "plugin",
    key: `${pluginId}:${contributionId}`,
    visible,
    group: {
      kind: "item",
      key: `${pluginId}:${contributionId}`,
      pluginId,
      contributionId,
      title: contributionId,
      targets: [],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.hasUsageSummary = true;
  state.items = [
    { kind: "builtin", key: "usage", id: "usage", visible: true },
    pluginItem("paseodog-provider", "quota"),
    pluginItem("other-plugin", "other"),
    pluginItem("paseodog-provider", "hidden", false),
    pluginItem("paseodog-provider", "status"),
  ];
});
afterEach(cleanup);

describe("PaseoDog sidebar footer", () => {
  it("moves only visible PaseoDog groups after Hosts, retaining order and native navigation", () => {
    render(<LeftSidebar active />);
    const toolbar = screen.getByTestId("sidebar-footer-bottom-line");
    const quota = within(toolbar).getByRole("button", { name: "quota" });
    const status = within(toolbar).getByRole("button", { name: "status" });
    const hosts = within(toolbar).getByTestId("sidebar-hosts-trigger");
    expect(quota.parentElement?.previousElementSibling).toBe(hosts);
    expect(quota.nextElementSibling).toBe(status);
    expect(quota.getAttribute("data-section")).toBe("footer");
    expect(screen.getAllByRole("button", { name: "quota" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "hidden" })).toBeNull();
    expect(within(toolbar).queryByRole("button", { name: "other" })).toBeNull();
    const other = screen.getByRole("button", { name: "other" });
    expect(other.parentElement?.contains(screen.getByTestId("usage-row"))).toBe(true);

    fireEvent.click(quota);
    expect(state.inspectAnchor).toHaveBeenCalledWith(quota.parentElement);
    expect(state.closeSidebar).toHaveBeenCalledTimes(1);
    fireEvent.click(other);
    expect(state.inspectAnchor).toHaveBeenLastCalledWith(other.parentElement);
    expect(state.closeSidebar).toHaveBeenCalledTimes(2);
  });

  it("leaves no old rows or separator when only toolbar groups remain", () => {
    state.hasUsageSummary = false;
    state.items = [
      { kind: "builtin", key: "usage", id: "usage", visible: true },
      pluginItem("paseodog-provider", "quota"),
    ];
    render(<LeftSidebar active />);
    expect(screen.queryByTestId("sidebar-footer-separator")).toBeNull();
    expect(screen.queryByTestId("usage-row")).toBeNull();
    expect(
      within(screen.getByTestId("sidebar-footer-bottom-line")).getAllByRole("button", {
        name: "quota",
      }),
    ).toHaveLength(1);
  });

  it("keeps another plugin's row without a usage summary and hides disabled PaseoDog groups", () => {
    state.hasUsageSummary = false;
    state.items = [
      pluginItem("paseodog-provider", "quota", false),
      pluginItem("other-plugin", "other"),
    ];
    render(<LeftSidebar active />);
    expect(screen.queryByRole("button", { name: "quota" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "other" })).toHaveLength(1);
    expect(screen.getAllByTestId("sidebar-footer-separator")).toHaveLength(1);
  });
});

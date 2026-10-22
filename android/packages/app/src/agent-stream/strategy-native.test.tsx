// @vitest-environment jsdom

import React, { type ReactNode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RetainedPanelActivity } from "@/components/retained-panel";
import type { StreamItem } from "@/types/stream";
import type { StreamRenderInput } from "./strategy";
import { createNativeStreamStrategy } from "./strategy-native";

interface TestScrollEvent {
  nativeEvent: {
    contentOffset: { y: number };
    contentSize: { height: number };
    layoutMeasurement: { width: number; height: number };
  };
}

interface TestListProps {
  data: StreamItem[];
  onLayout(event: { nativeEvent: { layout: { width: number; height: number } } }): void;
  onScroll(event: TestScrollEvent): void;
  onContentSizeChange(width: number, height: number): void;
  maintainVisibleContentPosition: unknown;
  ListHeaderComponent: ReactNode;
}

const { lists, scrollToOffset } = vi.hoisted(() => ({
  lists: new Map<string, TestListProps>(),
  scrollToOffset: vi.fn(),
}));

vi.mock("react-native", async () => {
  const reactModule = await import("react");
  return {
    Platform: { OS: "android" },
    StyleSheet: { create: (styles: unknown) => styles },
    View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    // 세션별 목록의 명령·콜백을 노출하고 네이티브 레이아웃 자체는 흉내 내지 않는다.
    FlatList: reactModule.forwardRef(function TestFlatList(props: TestListProps, ref) {
      const id = props.data[props.data.length - 1]!.id;
      reactModule.useImperativeHandle(ref, () => ({
        scrollToOffset: (params: unknown) => scrollToOffset(id, params),
      }));
      lists.set(id, props);
      return (
        <div data-testid={id}>
          {props.data.map((item) => (
            <div key={item.id}>{item.id}</div>
          ))}
          {props.ListHeaderComponent}
        </div>
      );
    }),
  };
});
vi.mock("react-native-unistyles", () => ({
  withUnistyles: (component: unknown) => component,
}));
vi.mock("@/components/ui/loading-spinner", () => ({ LoadingSpinner: () => null }));
vi.mock("@/keyboard/shift", () => ({
  useKeyboardStreamInset: () => ({ contentContainerPaddingBottom: 0 }),
}));
vi.mock("./scroll-keyboard-dismiss/use-scroll-keyboard-dismiss", () => ({
  useScrollKeyboardDismiss: () => ({
    onScroll: vi.fn(),
    onScrollBeginDrag: vi.fn(),
    onScrollEndDrag: vi.fn(),
  }),
}));

// 두 세션의 보존된 목록에 같은 렌더 입력을 제공한다.
function input(agentId: string, items: StreamItem[]): StreamRenderInput {
  return {
    agentId,
    segments: { historyVirtualized: [], historyMounted: items, liveHead: [] },
    boundary: { hasVirtualizedHistory: false, hasMountedHistory: true, hasLiveHead: false },
    renderers: {
      renderHistoryVirtualizedRow: () => null,
      renderHistoryMountedRow: () => null,
      renderLiveHeadRow: () => null,
      renderLiveAuxiliary: () => <span>{agentId} running</span>,
    },
    listEmptyComponent: null,
    viewportRef: React.createRef(),
    routeBottomAnchorRequest: null,
    isAuthoritativeHistoryReady: true,
    onNearBottomChange: vi.fn(),
    onNearHistoryStart: vi.fn(),
    isLoadingOlderHistory: false,
    hasOlderHistory: false,
    olderHistoryProgressKey: null,
    scrollEnabled: true,
    listStyle: {},
    baseListContentContainerStyle: {},
    forwardListContentContainerStyle: {},
    contentMaxWidth: 400,
  };
}

// 본문 없이 항목의 식별자와 종류만으로 세션별 이력을 만든다.
function message(id: string): StreamItem {
  return { id, kind: "user_message", text: id, timestamp: new Date(0) };
}

// 네이티브 목록에서 전달되는 측정·스크롤 이벤트를 재현한다.
function measure(id: string, height: number, offset: number): void {
  const list = lists.get(id)!;
  list.onLayout({ nativeEvent: { layout: { width: 400, height } } });
  list.onContentSizeChange(400, 3000);
  list.onScroll({
    nativeEvent: {
      contentOffset: { y: offset },
      contentSize: { height: 3000 },
      layoutMeasurement: { width: 400, height },
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("React", React);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
});

afterEach(() => {
  cleanup();
  lists.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("retained native chat viewport", () => {
  it("loads older records without a drag after a short page is fully measured", async () => {
    const strategy = createNativeStreamStrategy();
    const props = input("short", [message("short-history")]);
    props.hasOlderHistory = true;
    props.olderHistoryProgressKey = "epoch:20";
    props.onNearHistoryStart = vi.fn().mockResolvedValue(true);
    render(strategy.render(props));

    act(() => {
      lists.get("short-history")!.onLayout({
        nativeEvent: { layout: { width: 400, height: 1200 } },
      });
      vi.advanceTimersByTime(200);
    });
    expect(props.onNearHistoryStart).not.toHaveBeenCalled();

    await act(async () => {
      lists.get("short-history")!.onContentSizeChange(400, 400);
    });
    expect(props.onNearHistoryStart).toHaveBeenCalledTimes(1);
    await act(async () => {
      lists.get("short-history")!.onContentSizeChange(400, 400);
      vi.advanceTimersByTime(200);
    });
    expect(props.onNearHistoryStart).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      mode: "sticky",
      offset: 0,
      maintainPosition: undefined,
      resumedScrolls: [["first-history", { offset: 0, animated: false }]],
    },
    {
      mode: "reading older history",
      offset: 500,
      maintainPosition: { minIndexForVisible: 0, autoscrollToTopThreshold: 0 },
      resumedScrolls: [],
    },
  ])(
    "preserves $mode through hidden layout events and background streaming",
    ({ offset, maintainPosition, resumedScrolls }) => {
      const strategy = createNativeStreamStrategy();
      const first = input("first", [message("first-history")]);
      const second = input("second", [message("second-history")]);
      // 탭의 활성 신호만 전환하고 두 목록의 인스턴스는 보존한다.
      function tabs(active: string) {
        return (
          <>
            <RetainedPanelActivity active={active === "first"}>
              {strategy.render(first)}
            </RetainedPanelActivity>
            <RetainedPanelActivity active={active === "second"}>
              {strategy.render(second)}
            </RetainedPanelActivity>
          </>
        );
      }
      const view = render(tabs("first"));
      act(() => {
        measure("first-history", 800, 0);
        vi.advanceTimersByTime(200);
      });
      act(() => measure("first-history", 800, offset));
      expect(lists.get("first-history")!.maintainVisibleContentPosition).toEqual(maintainPosition);
      vi.mocked(first.onNearBottomChange).mockClear();

      view.rerender(tabs("second"));
      act(() => {
        measure("first-history", 0, 500);
        measure("second-history", 800, 0);
        vi.advanceTimersByTime(200);
      });
      expect(first.onNearBottomChange).not.toHaveBeenCalled();
      expect(lists.get("first-history")!.maintainVisibleContentPosition).toEqual(maintainPosition);

      scrollToOffset.mockClear();
      first.segments = {
        ...first.segments,
        historyMounted: [message("background-update"), ...first.segments.historyMounted],
      };
      view.rerender(tabs("second"));
      act(() => vi.advanceTimersByTime(200));
      expect(scrollToOffset.mock.calls.filter(([id]) => id === "first-history")).toEqual([]);
      expect(view.getByTestId("first-history").textContent).toContain("background-update");

      view.rerender(tabs("first"));
      act(() => {
        measure("first-history", 800, offset);
        vi.advanceTimersByTime(200);
      });
      expect(lists.get("first-history")!.maintainVisibleContentPosition).toEqual(maintainPosition);
      expect(scrollToOffset.mock.calls.filter(([id]) => id === "first-history")).toEqual(
        resumedScrolls,
      );
      expect(view.getByTestId("first-history").textContent).toContain("first running");
    },
  );
});

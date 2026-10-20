// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import {
  registerMobileTabSwitcherOpener,
  requestOpenMobileTabSwitcher,
  useFocusedMobileTabSwitcherOpenState,
  useMobileTabSwitcherRequestStore,
} from "@/screens/workspace/mobile-tab-switcher-request";
import { usePanelStore } from "@/stores/panel-store";

// 스와이프 시작 시점 캡처 (현재 패널 revision + 현재 등록 소유자)
function captureSwipeStart() {
  return {
    startedRevision: usePanelStore.getState().mobilePanel.revision,
    ownerId: useMobileTabSwitcherRequestStore.getState().ownerId,
  };
}

describe("mobile tab switcher swipe request", () => {
  beforeEach(() => {
    usePanelStore.setState({ mobilePanel: { target: "agent", revision: 0 } });
  });

  afterEach(() => {
    useMobileTabSwitcherRequestStore.setState({ openSwitcher: null, ownerId: 0 });
  });

  it("opens the focused workspace's tab switcher sheet on a swipe request", () => {
    const openSwitcher = vi.fn();
    registerMobileTabSwitcherOpener(openSwitcher);

    expect(requestOpenMobileTabSwitcher(captureSwipeStart())).toBe(true);
    expect(openSwitcher).toHaveBeenCalledTimes(1);
  });

  it("does nothing when no workspace tab switcher is registered", () => {
    expect(useMobileTabSwitcherRequestStore.getState().openSwitcher).toBeNull();
    expect(requestOpenMobileTabSwitcher(captureSwipeStart())).toBe(false);
  });

  it("stops opening after the workspace loses focus", () => {
    const openSwitcher = vi.fn();
    const unregister = registerMobileTabSwitcherOpener(openSwitcher);
    const swipeStart = captureSwipeStart();
    unregister();

    expect(requestOpenMobileTabSwitcher(swipeStart)).toBe(false);
    expect(openSwitcher).not.toHaveBeenCalled();
  });

  it("keeps the newer focused workspace when a previous one unregisters late", () => {
    const previous = vi.fn();
    const next = vi.fn();
    const unregisterPrevious = registerMobileTabSwitcherOpener(previous);
    registerMobileTabSwitcherOpener(next);
    unregisterPrevious();

    expect(requestOpenMobileTabSwitcher(captureSwipeStart())).toBe(true);
    expect(next).toHaveBeenCalledTimes(1);
    expect(previous).not.toHaveBeenCalled();
  });

  it("drops a deferred swipe commit after the panel revision moved on", () => {
    const openSwitcher = vi.fn();
    registerMobileTabSwitcherOpener(openSwitcher);
    const swipeStart = captureSwipeStart();
    usePanelStore.setState({ mobilePanel: { target: "agent-list", revision: 1 } });
    usePanelStore.setState({ mobilePanel: { target: "agent", revision: 2 } });

    expect(requestOpenMobileTabSwitcher(swipeStart)).toBe(false);
    expect(openSwitcher).not.toHaveBeenCalled();
  });

  it("does not open a newly focused workspace from a swipe started on the previous owner", () => {
    const previous = vi.fn();
    const next = vi.fn();
    const unregisterPrevious = registerMobileTabSwitcherOpener(previous);
    const swipeStart = captureSwipeStart();
    unregisterPrevious();
    registerMobileTabSwitcherOpener(next);

    expect(requestOpenMobileTabSwitcher(swipeStart)).toBe(false);
    expect(previous).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("closes the sheet on focus loss so returning to the workspace does not reopen it", () => {
    const beforeOpen = vi.fn();
    const { result, rerender } = renderHook(
      ({ isRouteFocused }) => useFocusedMobileTabSwitcherOpenState(isRouteFocused, beforeOpen),
      { initialProps: { isRouteFocused: true } },
    );

    act(() => {
      expect(requestOpenMobileTabSwitcher(captureSwipeStart())).toBe(true);
    });
    expect(result.current.isOpen).toBe(true);
    expect(beforeOpen).toHaveBeenCalledTimes(1);

    rerender({ isRouteFocused: false });
    expect(result.current.isOpen).toBe(false);
    expect(useMobileTabSwitcherRequestStore.getState().ownerId).toBe(0);

    rerender({ isRouteFocused: true });
    expect(result.current.isOpen).toBe(false);
    expect(useMobileTabSwitcherRequestStore.getState().ownerId).not.toBe(0);
  });
});

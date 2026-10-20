import { describe, expect, it } from "vitest";

import {
  isTabSwitcherSwipeOwnerCurrent,
  resolveMobilePanelGestureIntent,
  shouldOpenTabSwitcherFromSwipe,
} from "./gesture-intent";

describe("mobile panel gesture intent", () => {
  it("blocks both panel-opening directions while the active surface owns horizontal dragging", () => {
    expect([
      resolveMobilePanelGestureIntent({
        deltaX: 40,
        deltaY: 2,
        direction: 1,
        openGesturesBlocked: true,
      }),
      resolveMobilePanelGestureIntent({
        deltaX: -40,
        deltaY: 2,
        direction: -1,
        openGesturesBlocked: true,
      }),
    ]).toEqual(["fail", "fail"]);
  });

  it("keeps ordinary horizontal panel gestures available when unblocked", () => {
    expect([
      resolveMobilePanelGestureIntent({
        deltaX: 40,
        deltaY: 2,
        direction: 1,
        openGesturesBlocked: false,
      }),
      resolveMobilePanelGestureIntent({
        deltaX: -40,
        deltaY: 2,
        direction: -1,
        openGesturesBlocked: false,
      }),
    ]).toEqual(["activate", "activate"]);
  });

  it("opens the tab switcher only for a committed right-to-left swipe", () => {
    const windowWidth = 390;
    expect([
      // 화면 1/3 이상 왼쪽으로 이동
      shouldOpenTabSwitcherFromSwipe({ translationX: -140, velocityX: 0, windowWidth }),
      // 짧지만 빠른 왼쪽 플링
      shouldOpenTabSwitcherFromSwipe({ translationX: -40, velocityX: -800, windowWidth }),
      // 짧고 느린 이동은 취소
      shouldOpenTabSwitcherFromSwipe({ translationX: -60, velocityX: -100, windowWidth }),
      // 왼쪽→오른쪽 스와이프는 탭 전환 시트를 열지 않음
      shouldOpenTabSwitcherFromSwipe({ translationX: 200, velocityX: 900, windowWidth }),
    ]).toEqual([true, true, false, false]);
  });

  it("opens the tab switcher only while the swipe's start revision and owner are current", () => {
    const started = { startedRevision: 3, startedOwnerId: 7 };
    expect([
      // 시작 시점 그대로
      isTabSwitcherSwipeOwnerCurrent({ ...started, currentRevision: 3, currentOwnerId: 7 }),
      // 패널 revision이 바뀐 오래된 스와이프
      isTabSwitcherSwipeOwnerCurrent({ ...started, currentRevision: 4, currentOwnerId: 7 }),
      // 등록 소유자가 다른 워크스페이스로 바뀜
      isTabSwitcherSwipeOwnerCurrent({ ...started, currentRevision: 3, currentOwnerId: 8 }),
      // 시작 시점에 등록 소유자 없음
      isTabSwitcherSwipeOwnerCurrent({
        startedRevision: 3,
        startedOwnerId: 0,
        currentRevision: 3,
        currentOwnerId: 0,
      }),
    ]).toEqual([true, false, false, false]);
  });
});

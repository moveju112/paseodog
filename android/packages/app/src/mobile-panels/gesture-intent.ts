export type MobilePanelGestureDirection = -1 | 1;
export type MobilePanelGestureIntent = "activate" | "fail" | "wait";

export function resolveMobilePanelGestureIntent(input: {
  deltaX: number;
  deltaY: number;
  direction: MobilePanelGestureDirection;
  openGesturesBlocked: boolean;
}): MobilePanelGestureIntent {
  "worklet";
  if (input.openGesturesBlocked) {
    return "fail";
  }
  const directedDelta = input.deltaX * input.direction;
  const absDeltaX = Math.abs(input.deltaX);
  const absDeltaY = Math.abs(input.deltaY);
  if (directedDelta <= -10 || (absDeltaY > 10 && absDeltaY > absDeltaX)) {
    return "fail";
  }
  if (directedDelta >= 15 && absDeltaX > absDeltaY) {
    return "activate";
  }
  return "wait";
}

// 오른쪽→왼쪽 스와이프 종료 판정 (화면 1/3 이상 이동 또는 빠른 플링 → 탭 전환 시트 열기)
export function shouldOpenTabSwitcherFromSwipe(input: {
  translationX: number;
  velocityX: number;
  windowWidth: number;
}): boolean {
  "worklet";
  return input.translationX < -input.windowWidth / 3 || input.velocityX < -500;
}

// 탭 전환 스와이프 소유권 확인 (시작 시점 패널 revision·등록 소유자가 현재와 같을 때만 열기)
export function isTabSwitcherSwipeOwnerCurrent(input: {
  startedRevision: number;
  currentRevision: number;
  startedOwnerId: number;
  currentOwnerId: number;
}): boolean {
  "worklet";
  return (
    input.startedOwnerId > 0 &&
    input.startedOwnerId === input.currentOwnerId &&
    input.startedRevision >= 0 &&
    input.startedRevision === input.currentRevision
  );
}

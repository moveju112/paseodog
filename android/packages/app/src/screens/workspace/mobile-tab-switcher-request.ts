import { useCallback, useEffect, useState } from "react";
import { create } from "zustand";
import { isTabSwitcherSwipeOwnerCurrent } from "@/mobile-panels/gesture-intent";
import { usePanelStore } from "@/stores/panel-store";

// 포커스된 모바일 워크스페이스의 탭 전환 시트를 앱 레이아웃 스와이프에서 열기 위한 연결점
// ownerId: 등록마다 새로 발급 (0 = 등록 없음), 스와이프가 시작 시점 소유자를 확인하는 데 사용
interface MobileTabSwitcherRequestState {
  openSwitcher: (() => void) | null;
  ownerId: number;
}

export const useMobileTabSwitcherRequestStore = create<MobileTabSwitcherRequestState>(() => ({
  openSwitcher: null,
  ownerId: 0,
}));

let lastOwnerId = 0;

// 탭 전환 시트 열기 등록 (새 ownerId 발급 → 해제 함수 반환, 더 새 등록은 지우지 않음)
export function registerMobileTabSwitcherOpener(openSwitcher: () => void): () => void {
  lastOwnerId += 1;
  const ownerId = lastOwnerId;
  useMobileTabSwitcherRequestStore.setState({ openSwitcher, ownerId });
  return () => {
    if (useMobileTabSwitcherRequestStore.getState().ownerId === ownerId) {
      useMobileTabSwitcherRequestStore.setState({ openSwitcher: null, ownerId: 0 });
    }
  };
}

interface MobileTabSwitcherOpenRequest {
  startedRevision: number;
  ownerId: number;
}

// 스와이프 지연 커밋 → 시작 시점 패널 revision·등록 소유자가 그대로일 때만 시트 열기
export function requestOpenMobileTabSwitcher({
  startedRevision,
  ownerId,
}: MobileTabSwitcherOpenRequest): boolean {
  const { openSwitcher, ownerId: currentOwnerId } = useMobileTabSwitcherRequestStore.getState();
  const isCurrent = isTabSwitcherSwipeOwnerCurrent({
    startedRevision,
    currentRevision: usePanelStore.getState().mobilePanel.revision,
    startedOwnerId: ownerId,
    currentOwnerId,
  });
  if (!openSwitcher || !isCurrent) {
    return false;
  }
  openSwitcher();
  return true;
}

// 탭 전환 시트 열림 상태 (포커스 중에만 스와이프 대상으로 등록, 포커스 해제 시 닫아서 복귀 때 다시 열리지 않게)
export function useFocusedMobileTabSwitcherOpenState(
  isRouteFocused: boolean,
  beforeOpen: () => void,
) {
  const [isOpen, setIsOpen] = useState(false);

  const openSwitcher = useCallback(() => {
    beforeOpen();
    setIsOpen(true);
  }, [beforeOpen]);

  useEffect(() => {
    if (!isRouteFocused) {
      setIsOpen(false);
      return;
    }
    return registerMobileTabSwitcherOpener(openSwitcher);
  }, [isRouteFocused, openSwitcher]);

  return { isOpen, setIsOpen, openSwitcher };
}

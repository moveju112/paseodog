import { useEffect, useState } from "react";

// 새 선택 요청마다 테두리를 두 번 켜고, 재선택·해제·언마운트 시 이전 타이머를 정리한다.
export function useSessionRevealFlash(requestId: number | null): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (requestId === null) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const timers = [
      setTimeout(() => setVisible(false), 400),
      setTimeout(() => setVisible(true), 520),
      setTimeout(() => setVisible(false), 920),
    ];
    return () => timers.forEach(clearTimeout);
  }, [requestId]);

  return requestId !== null && visible;
}

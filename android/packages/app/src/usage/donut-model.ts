// PaseoDog: 사이드바 도넛 요약의 순수 계산 (usage_widget의 초기화 카운트다운 표기를 따른다).
// 웹 번들 패치(patches/paseo-usage-donut.mjs)도 같은 계산을 쓰며 tests/usage-donut.test.mjs가 둘을 비교한다.

/** Ring diameter and stroke width in px. */
export const DONUT_SIZE = 30;
export const DONUT_STROKE = 3;

// 초기화까지 남은 시간 (하루 이상 -> "6D", 미만 -> "0:53", 모름 -> "--:--")
export function usageCountdownText(resetsAt: string | null, now: number): string {
  const at = resetsAt ? Date.parse(resetsAt) : Number.NaN;
  if (!Number.isFinite(at)) return "--:--";
  const seconds = (at - now) / 1000;
  if (seconds <= 0) return "0:00";
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)}D`;
  const minutes = Math.max(1, Math.floor(seconds / 60));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

// 반원 두 개의 호 회전각 (퍼센트 -> 오른쪽·왼쪽 회전각, 보이지 않는 쪽은 null)
// 왼쪽·아래 테두리만 칠한 원은 135°~315° 호라서 회전만으로 각 반쪽의 채움 길이를 정한다.
export function donutArcRotations(percent: number): { right: number | null; left: number | null } {
  const angle = (Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0)) / 100) * 360;
  return {
    right: angle > 0 ? 45 + Math.min(angle, 180) : null,
    left: angle > 180 ? angle - 180 - 135 : null,
  };
}

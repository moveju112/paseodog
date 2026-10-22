import type { UsagePin } from "./preferences";
import type { UsageReportEntry } from "./types";

// 이전 Claude 고정 항목을 전용 Mixdog 보고서의 같은 기간에 연결하고 명시적 숨김은 유지한다.
// COMPAT(claudeUsagePins): added in v1.0.0-rc.7, remove after 2027-04-22.
export function restoreClaudeUsagePins(
  pins: UsagePin[],
  reports: readonly UsageReportEntry[],
): UsagePin[] {
  const native = reports.find(
    (entry) => entry.id === "claude:mixdog-anthropic-oauth" && entry.sourceId === "claude",
  );
  if (native?.report.status !== "available") return pins;
  const windows = native.report.windows;
  const periodLabels: Record<string, string> = { five_hour: "5H", weekly: "7D" };
  return pins.map((pin) => {
    if (pin.sourceId !== "claude" || windows.some((window) => window.id === pin.windowId))
      return pin;
    const label = periodLabels[pin.windowId];
    const period = label ? windows.find((candidate) => candidate.label === label) : undefined;
    return period ? { ...pin, windowId: period.id } : pin;
  });
}

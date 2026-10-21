import { formatPct } from "./format";
import { displayPercent } from "./model";
import { effectiveUsagePins, type UsagePreferences } from "./preferences";
import { windowTone } from "./tone";
import type { UsageReportEntry, UsageTone, UsageWindow } from "./types";

/** One summary window of one account, as the sidebar Usage item shows it. */
export interface PinnedUsageWindow {
  key: string;
  /** Accessible description, including the source, account, window and percent meaning. */
  label: string;
  /** The window's short name ("5h"), empty for none, or its label when the source sends none. */
  shortLabel: string;
  /** The share shown, under the user's used/remaining preference. */
  percent: number;
  percentText: string;
  tone: UsageTone;
  /** PaseoDog: when the window resets, for the donut summary's countdown. */
  resetsAt: string | null;
}

/** One account's summary windows, under its source's icon. */
export interface PinnedUsageSource {
  key: string;
  sourceId: string;
  /** PaseoDog: the source and account name, for the donut summary's hover text. */
  label: string;
  icon: string | null;
  windows: PinnedUsageWindow[];
}

/** How much of each window the one-line summary has room for. */
export type PinnedUsageLayout = "meters" | "labels" | "percents";

// A meter narrower than this is a sliver that reads as noise rather than a share.
export const MIN_METER_WIDTH = 16;
/** The space between a meter and its text. */
export const METER_GAP = 4;

/**
 * The richest layout that fits on one line: every window's meter, else its short label, else its
 * percent alone. Meters are all or none; a line never mixes them. Until the widths are known it
 * shows labels, which never flashes meters that turn out not to fit.
 */
export function choosePinnedUsageLayout(input: {
  available: number | null;
  labelsWidth: number | null;
  percentsWidth: number | null;
  windowCount: number;
}): PinnedUsageLayout {
  const { available, labelsWidth, percentsWidth, windowCount } = input;
  if (available === null || labelsWidth === null || percentsWidth === null) return "labels";
  if (labelsWidth + windowCount * (MIN_METER_WIDTH + METER_GAP) <= available) return "meters";
  if (labelsWidth <= available) return "labels";
  return percentsWidth < labelsWidth ? "percents" : "labels";
}

// 공급자·계정 이름 (보고서 -> "Claude (work)")
function sourceName(entry: UsageReportEntry): string {
  const account = entry.account.label ? ` (${entry.account.label})` : "";
  return `${entry.sourceLabel}${account}`;
}

function describe(entry: UsageReportEntry, windowLabel: string): string {
  return `${sourceName(entry)} ${windowLabel}`;
}

// PaseoDog: 보고서 도착 순서와 무관하게 Codex -> Claude -> 나머지 공급자 순으로 고정한다.
const SOURCE_ORDER = ["codex", "claude"];

// 공급자 순위 계산 (고정 목록 순위 -> 목록 밖은 모두 뒤)
function sourceRank(sourceId: string): number {
  const rank = SOURCE_ORDER.indexOf(sourceId);
  return rank < 0 ? SOURCE_ORDER.length : rank;
}

// 로케일과 무관한 문자열 비교 (코드 단위 순)
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Reports with every account of a source together, in PaseoDog's fixed source order. */
// 보고서 고정 정렬 (공급자 순위 -> sourceId -> 계정 보고서 id), 입력 배열은 바꾸지 않는다.
function groupBySource(reports: readonly UsageReportEntry[]): UsageReportEntry[] {
  return [...reports].sort(
    (left, right) =>
      sourceRank(left.sourceId) - sourceRank(right.sourceId) ||
      compareText(left.sourceId, right.sourceId) ||
      compareText(left.id, right.id),
  );
}

// 사이드바 짧은 이름 (주간 창 "wk" -> "7D", 5H 등 나머지는 원본 그대로)
function sidebarShortLabel(usageWindow: UsageWindow): string {
  const shortLabel = usageWindow.shortLabel ?? usageWindow.label;
  return shortLabel === "wk" ? "7D" : shortLabel;
}

/**
 * The sidebar Usage item's summary: one group per account, grouped by source in a fixed order,
 * each with its windows in its report's order. Accounts with nothing to show are left out.
 */
export function resolvePinnedUsage(
  reports: readonly UsageReportEntry[],
  preferences: UsagePreferences,
): PinnedUsageSource[] {
  const pins = effectiveUsagePins(preferences, reports);
  const meaning = preferences.displayAs === "remaining" ? "left" : "used";
  return groupBySource(reports).flatMap((entry) => {
    if (entry.report.status !== "available") return [];
    const windows = entry.report.windows
      .filter(
        (window) =>
          displayPercent(window, preferences.displayAs) !== null &&
          pins.some((pin) => pin.sourceId === entry.sourceId && pin.windowId === window.id),
      )
      .map((window) => {
        const percent = displayPercent(window, preferences.displayAs) ?? 0;
        const percentText = formatPct(percent);
        return {
          key: `${entry.id}/${window.id}`,
          label: `${describe(entry, window.label)} ${percentText} ${meaning}`,
          shortLabel: sidebarShortLabel(window),
          percent,
          percentText,
          tone: windowTone(window),
          resetsAt: window.resetsAt ?? null,
        };
      });
    if (windows.length === 0) return [];
    return [
      {
        key: entry.id,
        sourceId: entry.sourceId,
        label: sourceName(entry),
        icon: entry.icon ?? null,
        windows,
      },
    ];
  });
}

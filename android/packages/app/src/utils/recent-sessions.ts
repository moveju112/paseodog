import type { TFunction } from "i18next";
import type { Agent } from "@/stores/session-store";
import {
  collectAllPanes,
  collectAllTabs,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-actions";

/** 최근 목록 한 묶음: 가장 최근 세션과, 분할 화면으로 함께 열린 나머지 최근 세션 */
export interface RecentSessionGroup {
  agent: Agent;
  linked: Agent[];
}

// 설정에서 고를 수 있는 범위 (짧은 순, 자정 기준인 오늘은 맨 뒤)
export const RECENT_SESSIONS_WINDOW_OPTIONS = [
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "8h",
  "12h",
  "24h",
  "today",
] as const;

export type RecentSessionsWindow = (typeof RECENT_SESSIONS_WINDOW_OPTIONS)[number];

export const DEFAULT_RECENT_SESSIONS_WINDOWS: readonly RecentSessionsWindow[] = [
  "30m",
  "4h",
  "12h",
];

export const MAX_RECENT_SESSIONS_WINDOWS = 3;

const WINDOW_MINUTES: Record<Exclude<RecentSessionsWindow, "today">, number> = {
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "2h": 120,
  "4h": 240,
  "8h": 480,
  "12h": 720,
  "24h": 1440,
};

// 최근 범위 하한 계산 (선택 범위 -> 기준 시각 이후 하한 ms)
export function recentSessionsCutoff(window: RecentSessionsWindow, now: Date): number {
  if (window === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
  return now.getTime() - WINDOW_MINUTES[window] * 60_000;
}

// 설정한 범위 정리 (선택지 순서·중복 제거·최대 개수, 비어 있으면 기본값)
export function normalizeRecentSessionsWindows(
  windows: readonly RecentSessionsWindow[],
): RecentSessionsWindow[] {
  const result = RECENT_SESSIONS_WINDOW_OPTIONS.filter((option) => windows.includes(option)).slice(
    0,
    MAX_RECENT_SESSIONS_WINDOWS,
  );
  return result.length > 0 ? result : [...DEFAULT_RECENT_SESSIONS_WINDOWS];
}

// 표시할 선택 범위 (저장된 선택이 목록에 없으면 그 이상인 첫 범위, 없으면 가장 넓은 범위)
export function effectiveRecentSessionsWindow(
  window: RecentSessionsWindow,
  windows: readonly RecentSessionsWindow[],
): RecentSessionsWindow {
  if (windows.includes(window)) return window;
  const rank = RECENT_SESSIONS_WINDOW_OPTIONS.indexOf(window);
  return (
    windows.find((option) => RECENT_SESSIONS_WINDOW_OPTIONS.indexOf(option) >= rank) ??
    windows[windows.length - 1]!
  );
}

// 범위 표시 이름 (60분 미만은 분, 그 이상은 시간)
export function recentSessionsWindowLabel(t: TFunction, window: RecentSessionsWindow): string {
  if (window === "today") return t("sidebar.recentSessions.windows.today");
  const minutes = WINDOW_MINUTES[window];
  return minutes < 60
    ? t("sidebar.recentSessions.windows.minutes", { value: minutes })
    : t("sidebar.recentSessions.windows.hours", { value: minutes / 60 });
}

// 최근 세션 추림 (서버별 세션 -> 내 마지막 채팅이 범위 안인 최상위 세션, 최신순)
export function selectRecentSessions(
  agentsByServer: Record<string, ReadonlyMap<string, Agent> | undefined>,
  window: RecentSessionsWindow,
  now: Date,
  hiddenThrough: Readonly<Record<string, number>> = {},
): Agent[] {
  const cutoff = recentSessionsCutoff(window, now);
  const result: Agent[] = [];
  for (const agents of Object.values(agentsByServer)) {
    if (!agents) continue;
    for (const agent of agents.values()) {
      const messagedAt = agent.lastUserMessageAt?.getTime();
      if (messagedAt === undefined || messagedAt < cutoff) continue;
      if (agent.archivedAt || agent.parentAgentId) continue;
      const hiddenAt = hiddenThrough[`${agent.serverId}:${agent.id}`];
      if (hiddenAt !== undefined && messagedAt <= hiddenAt) continue;
      result.push(agent);
    }
  }
  return result.sort(
    (left, right) =>
      (right.lastUserMessageAt?.getTime() ?? 0) - (left.lastUserMessageAt?.getTime() ?? 0),
  );
}

// 분할 화면 세션 묶음 (작업공간 레이아웃 -> 보이는 칸마다 선택된 세션이 둘 이상인 "서버:세션" 키 묶음)
export function selectSplitSessionGroups(
  layoutByWorkspace: Readonly<Record<string, WorkspaceLayout>>,
): string[][] {
  const groups: string[][] = [];
  for (const [workspaceKey, layout] of Object.entries(layoutByWorkspace)) {
    const separator = workspaceKey.indexOf(":");
    if (separator <= 0) continue;
    const serverId = workspaceKey.slice(0, separator);
    const tabs = new Map(collectAllTabs(layout.root).map((tab) => [tab.tabId, tab.target]));
    const keys: string[] = [];
    for (const pane of collectAllPanes(layout.root)) {
      const target = pane.focusedTabId ? tabs.get(pane.focusedTabId) : undefined;
      if (target?.kind === "agent") keys.push(`${serverId}:${target.agentId}`);
    }
    const unique = [...new Set(keys)];
    if (unique.length > 1) groups.push(unique);
  }
  return groups;
}

// 최근 목록 묶기 (최신순 세션·분할 묶음 -> 함께 열린 세션은 그중 가장 최근 세션 아래에 최신순으로 붙임)
export function groupRecentSessionsBySplit(
  sessions: readonly Agent[],
  splitGroups: readonly (readonly string[])[],
): RecentSessionGroup[] {
  const groupIndexByKey = new Map<string, number>();
  splitGroups.forEach((keys, index) => {
    for (const key of keys) if (!groupIndexByKey.has(key)) groupIndexByKey.set(key, index);
  });
  const leaderByGroup = new Map<number, RecentSessionGroup>();
  const result: RecentSessionGroup[] = [];
  for (const agent of sessions) {
    const groupIndex = groupIndexByKey.get(`${agent.serverId}:${agent.id}`);
    const leader = groupIndex === undefined ? undefined : leaderByGroup.get(groupIndex);
    if (leader) {
      leader.linked.push(agent);
      continue;
    }
    const entry: RecentSessionGroup = { agent, linked: [] };
    if (groupIndex !== undefined) leaderByGroup.set(groupIndex, entry);
    result.push(entry);
  }
  return result;
}

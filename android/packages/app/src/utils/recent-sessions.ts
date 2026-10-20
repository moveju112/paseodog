import type { Agent } from "@/stores/session-store";

export type RecentSessionsWindow = "15m" | "1h" | "today";

export const RECENT_SESSIONS_WINDOWS: readonly RecentSessionsWindow[] = ["15m", "1h", "today"];

// 최근 범위 하한 계산 (선택 범위 -> 기준 시각 이후 하한 ms)
export function recentSessionsCutoff(window: RecentSessionsWindow, now: Date): number {
  if (window === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
  return now.getTime() - (window === "15m" ? 15 : 60) * 60_000;
}

// 최근 세션 추림 (서버별 세션 -> 내 마지막 채팅이 범위 안인 최상위 세션, 최신순)
export function selectRecentSessions(
  agentsByServer: Record<string, ReadonlyMap<string, Agent> | undefined>,
  window: RecentSessionsWindow,
  now: Date,
): Agent[] {
  const cutoff = recentSessionsCutoff(window, now);
  const result: Agent[] = [];
  for (const agents of Object.values(agentsByServer)) {
    if (!agents) continue;
    for (const agent of agents.values()) {
      const messagedAt = agent.lastUserMessageAt?.getTime();
      if (messagedAt === undefined || messagedAt < cutoff) continue;
      if (agent.archivedAt || agent.parentAgentId) continue;
      result.push(agent);
    }
  }
  return result.sort(
    (left, right) =>
      (right.lastUserMessageAt?.getTime() ?? 0) - (left.lastUserMessageAt?.getTime() ?? 0),
  );
}

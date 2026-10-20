import { describe, expect, it } from "vitest";
import type { Agent } from "@/stores/session-store";
import { recentSessionsCutoff, selectRecentSessions } from "./recent-sessions";

const now = new Date(2026, 9, 20, 23, 0, 0);

function agent(id: string, input: Partial<Agent> = {}): Agent {
  return {
    serverId: "server-1",
    id,
    lastUserMessageAt: null,
    archivedAt: null,
    parentAgentId: null,
    ...input,
  } as Agent;
}

function minutesAgo(minutes: number): Date {
  return new Date(now.getTime() - minutes * 60_000);
}

describe("recent sessions", () => {
  it("uses rolling windows and local midnight for today", () => {
    expect(recentSessionsCutoff("15m", now)).toBe(minutesAgo(15).getTime());
    expect(recentSessionsCutoff("1h", now)).toBe(minutesAgo(60).getTime());
    expect(recentSessionsCutoff("today", now)).toBe(new Date(2026, 9, 20).getTime());
  });

  it("keeps top-level sessions messaged inside the window, newest first", () => {
    const sessions = {
      "server-1": new Map([
        ["old", agent("old", { lastUserMessageAt: minutesAgo(90) })],
        ["recent", agent("recent", { lastUserMessageAt: minutesAgo(10) })],
        ["never", agent("never")],
        ["child", agent("child", { lastUserMessageAt: minutesAgo(1), parentAgentId: "recent" })],
        ["archived", agent("archived", { lastUserMessageAt: minutesAgo(2), archivedAt: now })],
      ]),
      "server-2": new Map([
        ["other", agent("other", { serverId: "server-2", lastUserMessageAt: minutesAgo(5) })],
      ]),
      "server-3": undefined,
    };
    expect(selectRecentSessions(sessions, "15m", now).map((entry) => entry.id)).toEqual([
      "other",
      "recent",
    ]);
    expect(selectRecentSessions(sessions, "today", now).map((entry) => entry.id)).toEqual([
      "other",
      "recent",
      "old",
    ]);
  });
});

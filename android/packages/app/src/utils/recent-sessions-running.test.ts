import { describe, expect, it } from "vitest";
import type { Agent } from "@/stores/session-store";
import { RECENT_SESSIONS_WINDOW_OPTIONS, selectRecentSessions } from "./recent-sessions";

const now = new Date("2026-10-31T12:00:00Z");
const oldMessage = new Date(now.getTime() - 48 * 60 * 60_000);

function agent(id: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    serverId: "host",
    status: "running",
    lastUserMessageAt: oldMessage,
    archivedAt: null,
    parentAgentId: null,
    ...overrides,
  } as Agent;
}

function sessions(...agents: Agent[]) {
  return { host: new Map(agents.map((entry) => [entry.id, entry])) };
}

describe("running recent sessions", () => {
  it.each(RECENT_SESSIONS_WINDOW_OPTIONS)(
    "keeps running sessions outside %s until completion",
    (window) => {
      const running = agent("running");
      const recent = agent("recent", {
        status: "idle",
        lastUserMessageAt: new Date(now.getTime() - 60_000),
      });
      const source = sessions(running, recent, agent("finished", { status: "idle" }));
      expect(selectRecentSessions(source, window, now)).toEqual([recent, running]);
      running.status = "idle";
      expect(selectRecentSessions(source, window, now)).toEqual([recent]);
    },
  );

  it("shows an hour-old running command in the 30-minute range", () => {
    const running = agent("running", {
      lastUserMessageAt: new Date(now.getTime() - 60 * 60_000),
    });
    expect(selectRecentSessions(sessions(running), "30m", now)).toEqual([running]);
  });

  it.each(RECENT_SESSIONS_WINDOW_OPTIONS)(
    "preserves explicit hiding and exclusions in %s",
    (window) => {
      const hidden = agent("hidden");
      const source = sessions(
        hidden,
        agent("archived", { archivedAt: now }),
        agent("child", { parentAgentId: "parent" }),
        agent("never-messaged", { lastUserMessageAt: null }),
      );
      const hiddenThrough = { "host:hidden": oldMessage.getTime() };
      expect(selectRecentSessions(source, window, now, hiddenThrough)).toEqual([]);
      hidden.lastUserMessageAt = new Date(oldMessage.getTime() + 60_000);
      expect(selectRecentSessions(source, window, now, hiddenThrough)).toEqual([hidden]);
    },
  );
});

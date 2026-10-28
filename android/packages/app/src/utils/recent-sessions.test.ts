import { describe, expect, it } from "vitest";
import type { Agent } from "@/stores/session-store";
import type { WorkspaceLayout } from "@/stores/workspace-layout-actions";
import { matchSessionReveal } from "@/stores/session-reveal-store";
import { i18n } from "@/i18n/i18next";
import {
  DEFAULT_RECENT_SESSIONS_WINDOWS,
  effectiveRecentSessionsWindow,
  groupRecentSessionsBySplit,
  normalizeRecentSessionsWindows,
  recentSessionsCutoff,
  recentSessionsWindowLabel,
  selectRecentSessions,
  selectSplitSessionGroups,
} from "./recent-sessions";

// 저장된 작업공간 레이아웃 (칸마다 탭 목록·선택 탭)
function layout(
  panes: { id: string; tabs: { tabId: string; agentId?: string }[]; focused: string }[],
  hidden: string[] = [],
): WorkspaceLayout {
  const node = (pane: (typeof panes)[number]) => ({
    kind: "pane",
    pane: {
      id: pane.id,
      tabIds: pane.tabs.map((tab) => tab.tabId),
      focusedTabId: pane.focused,
      ...(hidden.includes(pane.id) ? { hidden: true } : {}),
      tabs: pane.tabs.map((tab) => ({
        tabId: tab.tabId,
        createdAt: 0,
        target: tab.agentId ? { kind: "agent", agentId: tab.agentId } : { kind: "files" },
      })),
    },
  });
  return {
    root: {
      kind: "group",
      group: { id: "root", direction: "horizontal", sizes: [], children: panes.map(node) },
    },
    focusedPaneId: panes[0]?.id ?? null,
  } as unknown as WorkspaceLayout;
}

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
    expect(recentSessionsCutoff("30m", now)).toBe(minutesAgo(30).getTime());
    expect(recentSessionsCutoff("4h", now)).toBe(minutesAgo(240).getTime());
    expect(recentSessionsCutoff("12h", now)).toBe(minutesAgo(720).getTime());
    expect(recentSessionsCutoff("24h", now)).toBe(minutesAgo(1440).getTime());
    expect(recentSessionsCutoff("today", now)).toBe(new Date(2026, 9, 20).getTime());
  });

  it("keeps configured ranges in option order, unique, at most three, never empty", () => {
    expect(DEFAULT_RECENT_SESSIONS_WINDOWS).toEqual(["30m", "4h", "12h"]);
    expect(normalizeRecentSessionsWindows(["today", "4h", "4h", "15m"])).toEqual([
      "15m",
      "4h",
      "today",
    ]);
    expect(normalizeRecentSessionsWindows(["24h", "15m", "2h", "8h"])).toEqual(["15m", "2h", "8h"]);
    expect(normalizeRecentSessionsWindows([])).toEqual(["30m", "4h", "12h"]);
  });

  it("falls back from a removed selection to the next wider configured range", () => {
    const windows = normalizeRecentSessionsWindows(["30m", "4h", "12h"]);
    expect(effectiveRecentSessionsWindow("4h", windows)).toBe("4h");
    // 예전 기본 선택(1h)·범위 밖 선택은 그 이상인 첫 범위, 더 넓은 범위가 없으면 가장 넓은 범위
    expect(effectiveRecentSessionsWindow("1h", windows)).toBe("4h");
    expect(effectiveRecentSessionsWindow("15m", windows)).toBe("30m");
    expect(effectiveRecentSessionsWindow("today", windows)).toBe("12h");
  });

  it("labels ranges in minutes, hours or today in the app language", async () => {
    const original = i18n.language;
    const labels = () =>
      (["30m", "4h", "12h", "today"] as const).map((window) =>
        recentSessionsWindowLabel(i18n.t, window),
      );
    try {
      await i18n.changeLanguage("ko");
      expect(labels()).toEqual(["30분", "4시간", "12시간", "오늘"]);
      await i18n.changeLanguage("en");
      expect(labels()).toEqual(["30m", "4h", "12h", "Today"]);
    } finally {
      await i18n.changeLanguage(original);
    }
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

  it("finds sessions shown side by side in visible split panes, per server", () => {
    const groups = selectSplitSessionGroups({
      "server-1:workspace-a": layout([
        {
          id: "left",
          tabs: [
            { tabId: "t1", agentId: "a" },
            { tabId: "t2", agentId: "x" },
          ],
          focused: "t1",
        },
        { id: "right", tabs: [{ tabId: "t3", agentId: "b" }], focused: "t3" },
        { id: "files", tabs: [{ tabId: "t4" }], focused: "t4" },
      ]),
      // 숨긴 칸·같은 세션만 보이는 칸·한 칸뿐인 작업공간은 분할 묶음이 아니다.
      "server-1:workspace-b": layout(
        [
          { id: "left", tabs: [{ tabId: "t5", agentId: "c" }], focused: "t5" },
          { id: "right", tabs: [{ tabId: "t6", agentId: "d" }], focused: "t6" },
        ],
        ["right"],
      ),
      "server-2:workspace-c": layout([
        { id: "left", tabs: [{ tabId: "t7", agentId: "e" }], focused: "t7" },
        { id: "right", tabs: [{ tabId: "t8", agentId: "e" }], focused: "t8" },
      ]),
    });
    expect(groups).toEqual([["server-1:a", "server-1:b"]]);
  });

  it("attaches split partners under the newest one and keeps every other order", () => {
    const sessions = ["n1", "b", "n2", "a", "n3"].map((id, index) =>
      agent(id, { lastUserMessageAt: minutesAgo(index) }),
    );
    const grouped = groupRecentSessionsBySplit(sessions, [["server-1:a", "server-1:b"]]);
    expect(grouped.map((entry) => [entry.agent.id, entry.linked.map((item) => item.id)])).toEqual([
      ["n1", []],
      ["b", ["a"]],
      ["n2", []],
      ["n3", []],
    ]);
    // 한쪽만 최근 범위에 있으면 묶지 않고 그대로 보인다.
    expect(
      groupRecentSessionsBySplit([agent("b")], [["server-1:a", "server-1:b"]]).map((entry) => [
        entry.agent.id,
        entry.linked.length,
      ]),
    ).toEqual([["b", 0]]);
  });

  it("highlights only the pane showing the chosen session, shortly after the choice", () => {
    const request = { serverId: "server-1", agentId: "a", id: 7, at: 1_000 };
    expect(matchSessionReveal(request, "server-1", "a", 2_500)).toBe(7);
    expect(matchSessionReveal(request, "server-1", "b", 2_500)).toBeNull();
    expect(matchSessionReveal(request, "server-2", "a", 2_500)).toBeNull();
    expect(matchSessionReveal(request, "server-1", null, 2_500)).toBeNull();
    expect(matchSessionReveal(request, "server-1", "a", 3_500)).toBeNull();
    expect(matchSessionReveal(null, "server-1", "a", 2_500)).toBeNull();
  });
});

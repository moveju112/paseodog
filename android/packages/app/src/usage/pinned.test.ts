import { describe, expect, it } from "vitest";
import type { UsagePreferences } from "./preferences";
import {
  choosePinnedUsageLayout,
  resolvePinnedUsage,
  type PinnedUsageSource,
  type PinnedUsageWindow,
} from "./pinned";
import type { UsageReportEntry, UsageWindow } from "./types";

function report(input: {
  sourceId: string;
  sourceLabel: string;
  account?: string;
  icon?: string;
  windows: UsageWindow[];
}): UsageReportEntry {
  return {
    id: `${input.sourceId}:${input.account ?? "default"}`,
    account: input.account ? { label: input.account } : {},
    fetchedAt: "2026-01-01T00:00:00.000Z",
    sourceId: input.sourceId,
    sourceLabel: input.sourceLabel,
    ...(input.icon ? { icon: input.icon } : {}),
    report: { status: "available", windows: input.windows },
  };
}

const claude = report({
  sourceId: "claude",
  sourceLabel: "Claude",
  icon: "<svg/>",
  windows: [
    { id: "five-hour", label: "Session", shortLabel: "5h", usedPct: 31 },
    { id: "weekly", label: "Weekly", shortLabel: "wk", usedPct: 80 },
  ],
});
const codex = report({
  sourceId: "codex",
  sourceLabel: "Codex",
  windows: [{ id: "weekly", label: "Weekly", remainingPct: 88 }],
});

function windows(reports: UsageReportEntry[], prefs: UsagePreferences): PinnedUsageWindow[] {
  return resolvePinnedUsage(reports, prefs).flatMap((source) => source.windows);
}

function preferences(
  pinned: UsagePreferences["pins"],
  displayAs: UsagePreferences["displayAs"] = "used",
): UsagePreferences {
  return { displayAs, pins: pinned, serverId: null };
}

describe("choosePinnedUsageLayout", () => {
  const widths = { labelsWidth: 200, percentsWidth: 120, windowCount: 2 };

  it("shows meters only when every window's meter fits beside the labels", () => {
    expect(choosePinnedUsageLayout({ ...widths, available: 240 })).toBe("meters");
    expect(choosePinnedUsageLayout({ ...widths, available: 239 })).toBe("labels");
  });

  it("drops the labels before it lets the line overflow", () => {
    expect(choosePinnedUsageLayout({ ...widths, available: 199 })).toBe("percents");
  });

  it("shows labels until the widths are measured", () => {
    expect(choosePinnedUsageLayout({ ...widths, available: null })).toBe("labels");
    expect(choosePinnedUsageLayout({ ...widths, available: 999, labelsWidth: null })).toBe(
      "labels",
    );
  });
});

describe("resolvePinnedUsage", () => {
  it("defaults to source-wide pins collected from each account", () => {
    const work = report({
      sourceId: "claude",
      sourceLabel: "Claude",
      account: "work",
      windows: [
        { id: "empty", label: "Empty" },
        { id: "weekly", label: "Weekly", usedPct: 90 },
      ],
    });
    const empty = report({
      sourceId: "empty",
      sourceLabel: "Empty",
      windows: [{ id: "empty", label: "Empty" }],
    });
    expect(
      windows([claude, codex, work, empty], preferences(null)).map((item) => [
        item.key,
        item.percentText,
      ]),
    ).toEqual([
      ["claude:default/five-hour", "31%"],
      ["claude:default/weekly", "80%"],
      ["claude:work/weekly", "90%"],
      ["codex:default/weekly", "12%"],
    ]);
  });

  it("pins replace defaults, and removing all pins restores defaults", () => {
    const reports = [claude, codex];
    expect(
      windows(reports, preferences([{ sourceId: "claude", windowId: "weekly" }])).map(
        (item) => item.key,
      ),
    ).toEqual(["claude:default/weekly"]);
    expect(windows(reports, preferences(null)).map((item) => item.key)).toEqual([
      "claude:default/five-hour",
      "codex:default/weekly",
    ]);
  });

  it("groups pinned windows by source in the fixed Claude-then-Codex order, not pin order", () => {
    const work = report({
      sourceId: "claude",
      sourceLabel: "Claude",
      account: "work",
      windows: [{ id: "weekly", label: "Weekly", usedPct: 90 }],
    });
    const sources = resolvePinnedUsage(
      [claude, codex, work],
      preferences([
        { sourceId: "claude", windowId: "weekly" },
        { sourceId: "codex", windowId: "weekly" },
        { sourceId: "claude", windowId: "five-hour" },
      ]),
    );

    const windowKeys = (source: PinnedUsageSource) => source.windows.map((window) => window.key);
    expect(sources.map((source) => [source.key, windowKeys(source)])).toEqual([
      ["claude:default", ["claude:default/five-hour", "claude:default/weekly"]],
      ["claude:work", ["claude:work/weekly"]],
      ["codex:default", ["codex:default/weekly"]],
    ]);
    expect(sources[0]).toEqual({
      key: "claude:default",
      sourceId: "claude",
      label: "Claude",
      icon: "<svg/>",
      windows: [
        {
          key: "claude:default/five-hour",
          label: "Claude Session 31% used",
          shortLabel: "5h",
          percent: 31,
          percentText: "31%",
          tone: "default",
          resetsAt: null,
        },
        {
          key: "claude:default/weekly",
          label: "Claude Weekly 80% used",
          shortLabel: "7D",
          percent: 80,
          percentText: "80%",
          tone: "warning",
          resetsAt: null,
        },
      ],
    });
  });

  it("names a window by its label when the source gives no short label", () => {
    const items = windows([codex], preferences([{ sourceId: "codex", windowId: "weekly" }]));

    expect(items.map((item) => item.shortLabel)).toEqual(["Weekly"]);
  });

  it("defaults to every window the source marks as summary, when it marks any", () => {
    const marked = report({
      sourceId: "claude",
      sourceLabel: "Claude",
      windows: [
        { id: "five-hour", label: "Session", shortLabel: "5h", usedPct: 31, summary: true },
        { id: "weekly", label: "Weekly", shortLabel: "wk", usedPct: 80, summary: true },
        { id: "weekly-fable", label: "Weekly · Fable", usedPct: 8 },
      ],
    });

    expect(windows([marked, codex], preferences(null)).map((item) => item.key)).toEqual([
      "claude:default/five-hour",
      "claude:default/weekly",
      "codex:default/weekly",
    ]);
  });

  it("keeps an empty short label empty, for a percent that needs no name", () => {
    const opencode = report({
      sourceId: "opencode",
      sourceLabel: "OpenCode Go",
      windows: [{ id: "rolling", label: "Rolling", shortLabel: "", usedPct: 21 }],
    });
    const items = windows([opencode], preferences(null));

    expect(items.map((item) => item.shortLabel)).toEqual([""]);
  });

  it("formats the share left when the user reads usage as remaining", () => {
    const items = windows(
      [claude, codex],
      preferences(
        [
          { sourceId: "claude", windowId: "five-hour" },
          { sourceId: "codex", windowId: "weekly" },
        ],
        "remaining",
      ),
    );

    expect(items.map((item) => item.percentText)).toEqual(["69%", "88%"]);
    expect(items.map((item) => item.label)).toEqual([
      "Claude Session 69% left",
      "Codex Weekly 88% left",
    ]);
  });

  it("keeps the same source order whichever report arrives first", () => {
    const grok = report({
      sourceId: "grok",
      sourceLabel: "Grok",
      windows: [{ id: "weekly", label: "Weekly", shortLabel: "wk", usedPct: 5 }],
    });
    const expected = [
      ["claude:default", ["claude:default/five-hour", "claude:default/weekly"]],
      ["codex:default", ["codex:default/weekly"]],
      ["grok:default", ["grok:default/weekly"]],
    ];
    const pins = preferences([
      { sourceId: "claude", windowId: "five-hour" },
      { sourceId: "claude", windowId: "weekly" },
      { sourceId: "codex", windowId: "weekly" },
      { sourceId: "grok", windowId: "weekly" },
    ]);
    for (const reports of [
      [claude, codex, grok],
      [grok, codex, claude],
      [codex, grok, claude],
    ]) {
      const before = [...reports];
      expect(
        resolvePinnedUsage(reports, pins).map((source) => [
          source.key,
          source.windows.map((window) => window.key),
        ]),
      ).toEqual(expected);
      expect(reports).toEqual(before);
    }
  });

  it("shows weekly short labels as 7D and keeps 5H and other short labels", () => {
    const mixdog = report({
      sourceId: "claude",
      sourceLabel: "Claude",
      windows: [
        { id: "claude-0", label: "5H", usedPct: 2, summary: true },
        { id: "claude-1", label: "7D", usedPct: 64, summary: true },
      ],
    });
    const builtin = report({
      sourceId: "codex",
      sourceLabel: "Codex",
      windows: [
        { id: "five_hour", label: "5-hour", shortLabel: "5h", usedPct: 0, summary: true },
        { id: "weekly", label: "Weekly", shortLabel: "wk", usedPct: 97, summary: true },
        {
          id: "code_review:weekly",
          label: "Code review · Weekly",
          shortLabel: "Code review wk",
          usedPct: 1,
        },
      ],
    });
    const items = windows([mixdog, builtin], preferences(null));

    expect(items.map((item) => [item.shortLabel, item.percentText, item.label])).toEqual([
      ["5H", "2%", "Claude 5H 2% used"],
      ["7D", "64%", "Claude 7D 64% used"],
      ["5h", "0%", "Codex 5-hour 0% used"],
      ["7D", "97%", "Codex Weekly 97% used"],
    ]);
  });

  it("leaves out a pinned window that no report has, or that reports no percent", () => {
    const noPercent = report({
      sourceId: "opencode",
      sourceLabel: "OpenCode",
      windows: [{ id: "monthly", label: "Monthly" }],
    });
    const items = windows(
      [claude, noPercent],
      preferences([
        { sourceId: "claude", windowId: "monthly" },
        { sourceId: "codex", windowId: "weekly" },
        { sourceId: "opencode", windowId: "monthly" },
      ]),
    );

    expect(items).toEqual([]);
  });

  it("shows a pin once per account of the source", () => {
    const personal = report({
      sourceId: "claude",
      sourceLabel: "Claude",
      account: "personal",
      windows: [{ id: "five-hour", label: "5-hour", usedPct: 10 }],
    });
    const work = report({
      sourceId: "claude",
      sourceLabel: "Claude",
      account: "work",
      windows: [{ id: "five-hour", label: "5-hour", usedPct: 90 }],
    });
    const items = windows(
      [personal, codex, work],
      preferences([{ sourceId: "claude", windowId: "five-hour" }]),
    );

    expect(items.map((item) => [item.label, item.percentText])).toEqual([
      ["Claude (personal) 5-hour 10% used", "10%"],
      ["Claude (work) 5-hour 90% used", "90%"],
    ]);
  });
});

it("keeps unavailable and error reports out of the sidebar summary", () => {
  const expired: UsageReportEntry = {
    ...claude,
    report: {
      status: "unavailable",
      problem: { kind: "expired", expiresAt: "2026-10-01T00:00:00.000Z", refreshedBy: "claude" },
    },
  };
  const failed: UsageReportEntry = {
    ...codex,
    report: { status: "error", error: "Store deleted" },
  };
  expect(resolvePinnedUsage([expired, failed], preferences(null))).toEqual([]);
});

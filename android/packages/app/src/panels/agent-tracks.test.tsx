// @vitest-environment jsdom
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AgentTracks } from "./agent-tracks";

const fixture = vi.hoisted(() => ({
  appState: "active",
  appListeners: new Set<() => void>(),
  hasDiff: false,
  showGitDiffSummary: true,
  provider: "paseodog",
  invokePluginRpc: vi.fn(),
}));

vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return fixture.appState;
    },
    addEventListener: (_event: string, listener: () => void) => {
      fixture.appListeners.add(listener);
      return { remove: () => fixture.appListeners.delete(listener) };
    },
  },
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/constants/platform", () => ({ isNative: true, isWeb: false }));
vi.mock("@/constants/layout", () => ({
  supportsDesktopPaneSplits: () => false,
  useIsCompactFormFactor: () => true,
}));
vi.mock("@/composer/tracks", () => ({
  ComposerTrackBar: ({ children }: { children: ReactNode }) => (
    <div data-testid="bar">{children}</div>
  ),
  ComposerTrackPill: ({
    children,
    testID,
    accessibilityLabel,
  }: {
    children: ReactNode;
    testID: string;
    accessibilityLabel: string;
  }) => (
    <div data-testid={testID} aria-label={accessibilityLabel}>
      {children}
    </div>
  ),
  ComposerTrackRow: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/composer/pill-styles", () => ({
  composerPillStyles: { label: {} },
}));
vi.mock("@/composer/diff-stat-pill", () => ({
  WorkspaceDiffStatPill: ({
    serverId,
    workspaceId,
  }: {
    serverId: string;
    workspaceId: string;
  }) =>
    fixture.hasDiff ? (
      <div data-testid="diff">
        {serverId}:{workspaceId}
      </div>
    ) : null,
}));
vi.mock("@/composer/workspace-diff-stat", () => ({
  useWorkspaceHasDiffStat: () => fixture.hasDiff,
}));
vi.mock("@/composer/task-list", () => ({ AgentTaskList: () => null }));
vi.mock("@/panels/pane-context", () => ({
  usePaneContext: () => ({ tabId: "tab", openTab: vi.fn() }),
}));
vi.mock("@/hooks/use-settings", () => ({
  useSettings: (
    select: (settings: {
      showGitDiffSummary: boolean;
      openInSidePane: object;
    }) => unknown
  ) =>
    select({
      showGitDiffSummary: fixture.showGitDiffSummary,
      openInSidePane: {},
    }),
}));
vi.mock("@/plugins", () => ({ PluginComposerPills: () => null }));
vi.mock("@/subagents", () => ({
  useArchiveSubagent: () => vi.fn(),
  useDetachSubagent: () => vi.fn(),
}));
vi.mock("@/subagents/track", () => ({ SubagentsTrack: () => null }));
vi.mock("@/utils/navigate-to-agent", () => ({ navigateToAgent: vi.fn() }));
vi.mock("@/workspace-tabs/model", () => ({
  buildWorkspaceTabPersistenceKey: () => "workspace",
}));
vi.mock("@/workspace-tabs/open-beside", () => ({
  openPreferredWorkspaceTarget: vi.fn(),
}));
vi.mock("@/workspace-tabs/open-supporting-view", () => ({
  openComposerChanges: vi.fn(),
}));
vi.mock("@/stores/session-store", () => {
  const client = { invokePluginRpc: fixture.invokePluginRpc };
  const agent = {
    get provider() {
      return fixture.provider;
    },
    persistence: {
      sessionId: 'plugin:{"version":2,"data":{"bridgeId":"parent"}}',
    },
  };
  const state = {
    sessions: { host: { client, agents: new Map([["agent", agent]]) } },
  };
  return {
    useSessionStore: (select: (value: typeof state) => unknown) =>
      select(state),
  };
});

let root: Root;
let container: HTMLDivElement;
const props = {
  serverId: "host",
  workspaceId: "workspace",
  agentId: "agent",
  cwd: "/work",
  subagentRows: [],
  tasks: [],
  archiveFinishedStatus: { kind: "idle" as const },
  onArchiveFinished: () => {},
  hasPluginComposerPills: false,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.appState = "active";
  fixture.provider = "paseodog";
  fixture.hasDiff = false;
  fixture.showGitDiffSummary = true;
  fixture.invokePluginRpc.mockReset();
  fixture.invokePluginRpc.mockResolvedValue({
    sessions: [
      {
        bridgeId: "parent",
        jobs: [{ id: "a", agent: "Worker", status: "running" }],
      },
      {
        bridgeId: "other",
        jobs: [{ id: "b", agent: "Other", status: "queued" }],
      },
    ],
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// 실제 가시성 저장소에 AppState 전환을 전달한다.
async function setAppState(state: string): Promise<void> {
  await act(async () => {
    fixture.appState = state;
    for (const listener of fixture.appListeners) listener();
  });
}

test("progress alone keeps the track visible, isolates the parent, and preserves the diff pill", async () => {
  await act(async () => root.render(<AgentTracks {...props} />));
  expect(container.querySelector('[data-testid="bar"]')).not.toBeNull();
  expect(container.textContent).toBe("Worker · 실행 중");
  expect(
    container
      .querySelector('[data-testid="paseodog-agent-progress"]')
      ?.getAttribute("aria-label")
  ).toBe("이 세션 하위 에이전트: 에이전트 1 실행");
  fixture.hasDiff = true;
  await act(async () => root.render(<AgentTracks {...props} cwd="/changed" />));
  expect(
    container
      .querySelector('[data-testid="bar"]')
      ?.lastElementChild?.getAttribute("data-testid")
  ).toBe("diff");
  expect(container.querySelector('[data-testid="diff"]')?.textContent).toBe(
    "host:workspace"
  );
  fixture.invokePluginRpc.mockResolvedValue({
    sessions: [{ bridgeId: "parent", jobs: [{ status: "idle" }] }],
  });
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(
    container.querySelector('[data-testid="paseodog-agent-progress"]')
  ).toBeNull();
  expect(container.querySelector('[data-testid="diff"]')).not.toBeNull();
});

test("showGitDiffSummary false hides the composer diff pill and its track, true keeps it", async () => {
  fixture.provider = "codex";
  fixture.hasDiff = true;
  fixture.showGitDiffSummary = false;
  await act(async () => root.render(<AgentTracks {...props} />));
  expect(container.querySelector('[data-testid="diff"]')).toBeNull();
  expect(container.querySelector('[data-testid="bar"]')).toBeNull();
  fixture.showGitDiffSummary = true;
  await act(async () => root.render(<AgentTracks {...props} cwd="/changed" />));
  expect(container.querySelector('[data-testid="diff"]')?.textContent).toBe(
    "host:workspace"
  );
});

test("native inactive/background states stop reads and active resumes without idle terminal pills", async () => {
  await setAppState("background");
  await act(async () => root.render(<AgentTracks {...props} />));
  expect(fixture.invokePluginRpc).toHaveBeenCalledTimes(0);
  expect(container.textContent).toBe("");
  await setAppState("active");
  expect(fixture.invokePluginRpc).toHaveBeenCalledTimes(1);
  expect(container.textContent).toBe("Worker · 실행 중");
  await setAppState("inactive");
  await act(async () => vi.advanceTimersByTimeAsync(10000));
  expect(fixture.invokePluginRpc).toHaveBeenCalledTimes(1);
  expect(container.textContent).toBe("");
  fixture.invokePluginRpc.mockResolvedValue({
    sessions: [{ bridgeId: "parent", jobs: [{ status: "completed" }] }],
  });
  await setAppState("active");
  expect(fixture.invokePluginRpc).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[data-testid="bar"]')).toBeNull();
});

test("a failed first read is visible, while another provider never starts polling", async () => {
  fixture.provider = "codex";
  await act(async () => root.render(<AgentTracks {...props} />));
  expect(fixture.invokePluginRpc).toHaveBeenCalledTimes(0);
  fixture.provider = "paseodog";
  fixture.invokePluginRpc.mockRejectedValue(new Error("Disconnected"));
  await act(async () => root.render(<AgentTracks {...props} cwd="/changed" />));
  expect(fixture.invokePluginRpc).toHaveBeenCalledTimes(1);
  expect(
    container
      .querySelector('[data-testid="paseodog-agent-progress"]')
      ?.getAttribute("aria-label")
  ).toBe("이 세션 하위 에이전트: 하위 작업 확인 불가");
  expect(container.textContent).toBe(
    "연결이 끊겼거나 조회에 실패했어요. 다음 확인에서 다시 표시해요."
  );
});

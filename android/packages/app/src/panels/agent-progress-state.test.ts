import { afterEach, expect, test, vi } from "vitest";
import {
  agentProgressSegments,
  createAgentProgressState,
  getAgentProgressState,
  paseodogBridgeId,
  selectAgentProgress,
  summarizeAgentJobs,
} from "./agent-progress-state";

afterEach(() => vi.useRealTimers());

test("matches desktop live-job classification, with terminal and idle jobs excluded", () => {
  expect(
    summarizeAgentJobs([
      { status: "idle", stage: "streaming" },
      { status: "completed", waitingApproval: true },
      { status: "failed" },
      { status: "done" },
      { status: "success" },
      { status: "closed" },
      { status: "error" },
      { status: "cancelled" },
      { status: "killed" },
      { status: "timeout" },
      { status: "running", stage: "cancelled" },
      {},
    ]),
  ).toBeNull();
  const summary = summarizeAgentJobs([
    { id: "a", agent: "Worker", tag: "w1", status: "running", stage: "streaming" },
    { id: "b", agent: "Reviewer", status: "queued" },
    { id: "c", agent: "Worker", status: "running", waitingApproval: true },
    { id: "d", stage: "tool_running" },
    { id: "e", status: "pending" },
    { id: "f", status: "starting" },
    { id: "g", status: "idle", stage: "running" },
  ]);
  expect(summary).toEqual({
    running: 2,
    waiting: 1,
    queued: 3,
    jobs: [
      { id: "a", agent: "Worker", tag: "w1", state: "running" },
      { id: "b", agent: "Reviewer", tag: "", state: "queued" },
      { id: "c", agent: "Worker", tag: "", state: "waiting" },
      { id: "d", agent: "Agent", tag: "", state: "running" },
      { id: "e", agent: "Agent", tag: "", state: "queued" },
      { id: "f", agent: "Agent", tag: "", state: "queued" },
    ],
  });
  expect(agentProgressSegments(summary)).toEqual([
    { bucket: "running", text: "에이전트 2 실행" },
    { bucket: "needs_input", text: "1 승인 대기" },
    { bucket: null, text: "3 실행 대기" },
  ]);
  expect(agentProgressSegments(null)).toEqual([]);
});

test("extracts only PaseoDog bridge IDs from metadata or plugin handles", () => {
  const persistence = {
    provider: "paseodog",
    sessionId: `plugin:${JSON.stringify({ version: 2, data: { bridgeId: "parent" } })}`,
  };
  expect(paseodogBridgeId({ provider: "paseodog", persistence })).toBe("parent");
  expect(
    paseodogBridgeId({
      provider: "paseodog",
      persistence: {
        ...persistence,
        metadata: { pluginProviderPersistence: { data: { bridgeId: "metadata" } } },
      },
    }),
  ).toBe("metadata");
  expect(paseodogBridgeId({ provider: "codex", persistence })).toBeNull();
  expect(
    paseodogBridgeId({
      provider: "paseodog",
      persistence: { ...persistence, sessionId: "plugin:{bad" },
    }),
  ).toBeNull();
  expect(
    paseodogBridgeId({
      provider: "paseodog",
      persistence: { ...persistence, sessionId: "plugin:null" },
    }),
  ).toBeNull();
  expect(
    paseodogBridgeId({
      provider: "paseodog",
      persistence: { ...persistence, sessionId: 'plugin:{"data":{"bridgeId":""}}' },
    }),
  ).toBeNull();
  expect(paseodogBridgeId(null)).toBeNull();
});

test("one monitor per host shares the exact engine-status RPC but isolates parent rows", async () => {
  vi.useFakeTimers();
  const invokePluginRpc = vi.fn().mockResolvedValue({
    sessions: [
      { bridgeId: "parent", jobs: [{ id: "a", status: "running" }] },
      {
        bridgeId: "other",
        jobs: [
          { id: "b", status: "queued" },
          { id: "c", status: "queued" },
        ],
      },
    ],
  });
  const client = { invokePluginRpc };
  const state = getAgentProgressState(client);
  expect(getAgentProgressState(client)).toBe(state);
  expect(getAgentProgressState({ invokePluginRpc })).not.toBe(state);
  const unsubscribe = state.subscribe(vi.fn());
  const unsubscribeOther = state.subscribe(vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  expect(invokePluginRpc.mock.calls).toEqual([["paseodog-provider", "engine-status", {}]]);
  expect(selectAgentProgress(state.getSnapshot(), "parent")).toEqual({
    running: 1,
    waiting: 0,
    queued: 0,
    jobs: [{ id: "a", agent: "Agent", tag: "", state: "running" }],
  });
  expect(selectAgentProgress(state.getSnapshot(), "missing")).toBeNull();
  expect(selectAgentProgress(state.getSnapshot(), null)).toBeNull();
  unsubscribe();
  await vi.advanceTimersByTimeAsync(2000);
  expect(invokePluginRpc).toHaveBeenCalledTimes(2);
  unsubscribeOther();
  await vi.advanceTimersByTimeAsync(10000);
  expect(invokePluginRpc).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

test("first-read failure is explicit and a successful idle read clears the pill", async () => {
  vi.useFakeTimers();
  const invokePluginRpc = vi
    .fn()
    .mockRejectedValueOnce(new Error("Disconnected"))
    .mockResolvedValue({ sessions: [{ bridgeId: "parent", jobs: [{ status: "idle" }] }] });
  const state = createAgentProgressState({ invokePluginRpc });
  const unsubscribe = state.subscribe(vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  const progress = selectAgentProgress(state.getSnapshot(), "parent");
  expect(progress).toEqual({ failed: true });
  expect(agentProgressSegments(progress)).toEqual([
    { bucket: "failed", text: "하위 작업 확인 불가" },
  ]);
  await vi.advanceTimersByTimeAsync(2000);
  expect(selectAgentProgress(state.getSnapshot(), "parent")).toBeNull();
  expect(state.getSnapshot().failed).toBe(false);
  unsubscribe();
});

test("unrelated unavailable sessions do not poison healthy or idle parents", async () => {
  vi.useFakeTimers();
  const state = createAgentProgressState({ invokePluginRpc: vi.fn().mockResolvedValue({
    sessions: [
      { bridgeId: "parent", jobs: [{ id: "child", status: "running" }] },
      { bridgeId: "idle", jobs: [] },
      { bridgeId: "broken", state: "unavailable", jobs: [{ status: "running" }] },
      { id: "legacy-broken", state: "unavailable" },
    ],
  }) });
  const unsubscribe = state.subscribe(vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  expect(selectAgentProgress(state.getSnapshot(), "parent")).toMatchObject({ running: 1 });
  expect(selectAgentProgress(state.getSnapshot(), "idle")).toBeNull();
  expect(selectAgentProgress(state.getSnapshot(), "broken")).toEqual({ failed: true });
  unsubscribe();
});

test("unidentifiable unavailable rows and malformed RPC output fail explicitly", async () => {
  vi.useFakeTimers();
  const invokePluginRpc = vi
    .fn()
    .mockResolvedValueOnce({ sessions: [{ id: "paseo-id", state: "unavailable" }] })
    .mockResolvedValueOnce({ sessions: "invalid" });
  const state = createAgentProgressState({ invokePluginRpc });
  const unsubscribe = state.subscribe(vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  expect(selectAgentProgress(state.getSnapshot(), "parent")).toEqual({ failed: true });
  await vi.advanceTimersByTimeAsync(2000);
  expect(selectAgentProgress(state.getSnapshot(), "parent")).toEqual({ failed: true });
  unsubscribe();
});

test("hide/resume never overlaps a pending read or accepts the previous visibility generation", async () => {
  vi.useFakeTimers();
  let release: (value: unknown) => void = () => {};
  const pending = new Promise<unknown>((resolve) => {
    release = resolve;
  });
  const invokePluginRpc = vi
    .fn()
    .mockReturnValueOnce(pending)
    .mockResolvedValue({
      sessions: [{ bridgeId: "parent", jobs: [{ id: "new", status: "queued" }] }],
    });
  const state = createAgentProgressState({ invokePluginRpc });
  const notify = vi.fn();
  const unsubscribe = state.subscribe(notify);
  await vi.advanceTimersByTimeAsync(10000);
  expect(invokePluginRpc).toHaveBeenCalledTimes(1);
  unsubscribe();
  const unsubscribeResumed = state.subscribe(notify);
  expect(invokePluginRpc).toHaveBeenCalledTimes(1);
  release({ sessions: [{ bridgeId: "parent", jobs: [{ id: "stale", status: "running" }] }] });
  await vi.advanceTimersByTimeAsync(0);
  expect(invokePluginRpc).toHaveBeenCalledTimes(2);
  expect(notify).toHaveBeenCalledTimes(1);
  expect(selectAgentProgress(state.getSnapshot(), "parent")).toEqual({
    running: 0,
    waiting: 0,
    queued: 1,
    jobs: [{ id: "new", agent: "Agent", tag: "", state: "queued" }],
  });
  unsubscribeResumed();
  await vi.advanceTimersByTimeAsync(10000);
  expect(invokePluginRpc).toHaveBeenCalledTimes(2);
});

test("late completion after the last unsubscribe cannot publish or schedule another read", async () => {
  vi.useFakeTimers();
  let release: (value: unknown) => void = () => {};
  const invokePluginRpc = vi.fn(
    () =>
      new Promise<unknown>((resolve) => {
        release = resolve;
      }),
  );
  const state = createAgentProgressState({ invokePluginRpc });
  const notify = vi.fn();
  const unsubscribe = state.subscribe(notify);
  unsubscribe();
  release({ sessions: [{ bridgeId: "parent", jobs: [{ status: "running" }] }] });
  await vi.advanceTimersByTimeAsync(10000);
  expect(notify).toHaveBeenCalledTimes(0);
  expect(selectAgentProgress(state.getSnapshot(), "parent")).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

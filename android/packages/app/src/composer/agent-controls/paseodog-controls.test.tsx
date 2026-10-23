// @vitest-environment jsdom
import React, { type PropsWithChildren } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentFeature } from "@getpaseo/protocol/agent-types";

const runtime = vi.hoisted(() => ({
  client: {
    invokePluginRpc: vi.fn(),
    setAgentFeature: vi.fn(),
    fetchAgent: vi.fn(),
    isConnected: true,
  },
  connected: true,
  visible: true,
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => runtime.client,
  useHostRuntimeIsConnected: () => runtime.connected,
}));
vi.mock("@/hooks/use-app-visible", () => ({
  useAppActivelyVisible: () => runtime.visible,
}));
vi.mock("react-native", () => ({
  View: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Text: ({ children }: PropsWithChildren) => <span>{children}</span>,
  StyleSheet: { create: <T,>(styles: T) => styles },
}));
vi.mock("react-native-unistyles", () => {
  const theme = { colors: { foregroundMuted: "#999", accent: "#0a0", destructive: "#a00" } };
  return {
    StyleSheet: { create: () => ({ iconColor: { color: "#999" } }) },
    useUnistyles: () => ({ theme }),
    // 실제 withUnistyles처럼 uniProps(theme) 결과를 props에 합치고 ref를 그대로 넘긴다.
    withUnistyles: (Component: React.ComponentType<Record<string, unknown>>) =>
      React.forwardRef<unknown, { uniProps?: (value: typeof theme) => Record<string, unknown> }>(
        ({ uniProps, ...props }, ref) => <Component {...props} {...uniProps?.(theme)} ref={ref} />,
      ),
  };
});
vi.mock("lucide-react-native", () => ({ Zap: () => <svg data-testid="fast-icon" /> }));
vi.mock("@/components/ui/combobox-trigger", () => ({
  // 모드·추론과 같은 실제 AgentControlTrigger가 넘기는 접근성·중복 제출 계약을 DOM으로 노출한다.
  ComboboxTrigger: ({
    children,
    onPress,
    disabled,
    accessibilityRole,
    accessibilityLabel,
    accessibilityState,
  }: PropsWithChildren<{
    onPress: () => void;
    disabled: boolean;
    accessibilityRole: string;
    accessibilityLabel: string;
    accessibilityState: { expanded?: boolean; checked?: boolean };
  }>) => (
    <button
      type="button"
      role={accessibilityRole}
      aria-label={accessibilityLabel}
      aria-expanded={accessibilityState.expanded}
      aria-checked={accessibilityState.checked}
      disabled={disabled}
      onClick={onPress}
    >
      {children}
    </button>
  ),
}));
vi.mock("@/components/ui/combobox", () => ({
  // 실제 Combobox 선택 계약(runIfSelected)대로 keepOpenOnSelect가 아닐 때만 선택 후 닫는다.
  Combobox: ({
    open,
    title,
    options,
    stickyHeader,
    keepOpenOnSelect,
    onSelect,
    onOpenChange,
    renderOption,
  }: {
    open: boolean;
    title: string;
    options: { id: string; label: string }[];
    stickyHeader: React.ReactNode;
    keepOpenOnSelect?: boolean;
    onSelect: (id: string) => void;
    onOpenChange: (open: boolean) => void;
    renderOption: (args: {
      option: { id: string; label: string };
      selected: boolean;
      active: boolean;
      onPress: () => void;
    }) => React.ReactElement;
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        {stickyHeader}
        {options.map((option) => (
          <React.Fragment key={option.id}>
            {renderOption({
              option,
              selected: false,
              active: false,
              onPress: () => {
                onSelect(option.id);
                if (!keepOpenOnSelect) onOpenChange(false);
              },
            })}
          </React.Fragment>
        ))}
      </div>
    ) : null,
  ComboboxItem: ({
    label,
    description,
    selected,
    disabled,
    accessibilityLabel,
    onPress,
  }: {
    label: string;
    description: string;
    selected: boolean;
    disabled: boolean;
    accessibilityLabel: string;
    onPress: () => void;
  }) => (
    <button
      type="button"
      aria-label={accessibilityLabel}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onPress}
    >
      {label}
      {description}
    </button>
  ),
}));
import { AUTO_EFFORT_ID, usePaseodogAutoEffort } from "@/components/paseodog-auto-effort";
import { PaseodogCollaboration, PaseodogFastScope } from "@/components/paseodog-collaboration";
import {
  autoEffortSnapshotSchema,
  collaborationSnapshotSchema,
  createConfirmedHostControl,
} from "@/hooks/use-paseodog-host-control";

const options = [
  { id: "low", label: "Low" },
  { id: "high", label: "High" },
];
const autoFeature: AgentFeature = {
  id: "autoEffort",
  type: "toggle",
  label: "Auto effort",
  value: false,
};
const firstFastScope = { paseodogScope: "live" as const, agentId: "one" };
const secondFastScope = { paseodogScope: "live" as const, agentId: "two" };

// PC 패치가 허용하는 최소 RPC 응답을 만든다.
function snapshot(autoEffort = false, orchestration = "none", supported = true, enabled = true) {
  return {
    route: { autoEffort },
    orchestration,
    toolModules: { autoEffort: { supported, enabled } },
  };
}

// 저장 완료 시점을 테스트에서 직접 제어한다.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  runtime.client = {
    invokePluginRpc: vi.fn().mockResolvedValue(snapshot()),
    setAgentFeature: vi.fn().mockResolvedValue(undefined),
    fetchAgent: vi.fn(),
    isConnected: true,
  };
  runtime.connected = true;
  runtime.visible = true;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("native Effort list contract", () => {
  it("uses only the live session feature and leaves manual selection on its existing path", async () => {
    const select = vi.fn();
    const props = {
      provider: "paseodog",
      scope: "live" as const,
      serverId: "host",
      agentId: "agent-one",
      features: [autoFeature],
      thinkingOptions: options,
      selectedThinkingOptionId: "low",
      onSelectThinkingOption: select,
    };
    const { result, rerender } = renderHook((input) => usePaseodogAutoEffort(input), {
      initialProps: props,
    });
    expect(result.current.thinkingOptions?.map((option) => option.id)).toEqual([
      AUTO_EFFORT_ID,
      "low",
      "high",
    ]);
    expect(result.current.features).toEqual([]);
    expect(runtime.client.invokePluginRpc).not.toHaveBeenCalled();
    act(() => result.current.onSelectThinkingOption(AUTO_EFFORT_ID));
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(runtime.client.setAgentFeature).toHaveBeenCalledExactlyOnceWith(
      "agent-one",
      "autoEffort",
      true,
    );
    expect(result.current.selectedThinkingOptionId).toBe("low");
    rerender({ ...props, features: [{ ...autoFeature, value: true }] });
    expect(result.current.selectedThinkingOptionId).toBe(AUTO_EFFORT_ID);
    act(() => result.current.onSelectThinkingOption("high"));
    expect(select).toHaveBeenCalledExactlyOnceWith("high");
    expect(runtime.client.invokePluginRpc).not.toHaveBeenCalled();
    expect(runtime.client.setAgentFeature).toHaveBeenCalledTimes(1);
  });

  it("exposes live pending/error, blocks duplicates and never automatically replays a write", async () => {
    const pending = deferred<void>();
    runtime.client.setAgentFeature.mockReturnValue(pending.promise);
    const { result, rerender } = renderHook(
      ({ agentId }) =>
        usePaseodogAutoEffort({
          provider: "paseodog",
          scope: "live",
          serverId: "host",
          agentId,
          features: [autoFeature],
          thinkingOptions: options,
        }),
      { initialProps: { agentId: "agent-one" } },
    );
    act(() => {
      result.current.onSelectThinkingOption(AUTO_EFFORT_ID);
      result.current.onSelectThinkingOption(AUTO_EFFORT_ID);
    });
    expect(result.current.busy).toBe(true);
    expect(result.current.thinkingOptions?.[0].label).toBe("자동 추론 (저장 중)");
    expect(runtime.client.setAgentFeature).toHaveBeenCalledTimes(1);
    await act(async () => pending.reject(new Error("connection lost")));
    expect(result.current.error).toBe("connection lost");
    expect(result.current.thinkingOptions?.[0].label).toBe("자동 추론 (확인 필요)");
    rerender({ agentId: "agent-one" });
    expect(runtime.client.setAgentFeature).toHaveBeenCalledTimes(1);
    rerender({ agentId: "agent-two" });
    expect(result.current.error).toBe("");
  });

  it.each([
    { provider: "codex", features: [autoFeature], thinkingOptions: options },
    { provider: "paseodog", features: [], thinkingOptions: options },
    { provider: "paseodog", features: [autoFeature], thinkingOptions: [] },
  ])("does not advertise unsupported live Auto: %j", (input) => {
    const { result } = renderHook(() =>
      usePaseodogAutoEffort({
        ...input,
        scope: "live",
        serverId: "host",
        agentId: "agent",
      }),
    );
    expect(result.current.thinkingOptions).toEqual(input.thinkingOptions);
    expect(result.current.features).toEqual(input.features);
    expect(runtime.client.invokePluginRpc).not.toHaveBeenCalled();
  });

  it("draft manual selection waits for confirmed Main disable and shares the host result", async () => {
    runtime.client.invokePluginRpc.mockResolvedValue(snapshot(true));
    const select = vi.fn();
    const { result } = renderHook(() => ({
      first: usePaseodogAutoEffort({
        provider: "paseodog",
        scope: "draft",
        serverId: "host",
        thinkingOptions: options,
        onSelectThinkingOption: select,
      }),
      second: usePaseodogAutoEffort({
        provider: "paseodog",
        scope: "draft",
        serverId: "host",
        thinkingOptions: options,
      }),
    }));
    await waitFor(() => expect(result.current.first.selectedThinkingOptionId).toBe(AUTO_EFFORT_ID));
    expect(runtime.client.invokePluginRpc).toHaveBeenCalledTimes(1);
    const pending = deferred<ReturnType<typeof snapshot>>();
    runtime.client.invokePluginRpc.mockReturnValueOnce(pending.promise);
    act(() => {
      result.current.first.onSelectThinkingOption("high");
      result.current.first.onSelectThinkingOption("high");
    });
    expect(select).not.toHaveBeenCalled();
    expect(result.current.first.busy).toBe(true);
    expect(runtime.client.invokePluginRpc).toHaveBeenLastCalledWith(
      "paseodog-provider",
      "engine-controls",
      { action: "main", route: { autoEffort: false } },
    );
    await act(async () => pending.resolve(snapshot(false)));
    expect(select).toHaveBeenCalledExactlyOnceWith("high");
    expect(result.current.second.selectedThinkingOptionId).toBeUndefined();
    expect(runtime.client.setAgentFeature).not.toHaveBeenCalled();
  });

  it("draft failure preserves the error, reads on next selection, and does not replay manual selection", async () => {
    runtime.client.invokePluginRpc.mockResolvedValue(snapshot(true));
    const select = vi.fn();
    const { result } = renderHook(() =>
      usePaseodogAutoEffort({
        provider: "paseodog",
        scope: "draft",
        serverId: "host",
        thinkingOptions: options,
        onSelectThinkingOption: select,
      }),
    );
    await waitFor(() => expect(result.current.selectedThinkingOptionId).toBe(AUTO_EFFORT_ID));
    runtime.client.invokePluginRpc.mockRejectedValueOnce(new Error("timeout"));
    act(() => result.current.onSelectThinkingOption("high"));
    await waitFor(() => expect(result.current.error).toContain("새로고침만"));
    expect(select).not.toHaveBeenCalled();
    act(() => result.current.onSelectThinkingOption("high"));
    await waitFor(() => expect(result.current.error).toBe(""));
    expect(runtime.client.invokePluginRpc.mock.calls.map((call) => call[2])).toEqual([
      { action: "read" },
      { action: "main", route: { autoEffort: false } },
      { action: "read" },
    ]);
    expect(select).not.toHaveBeenCalled();
  });

  it("draft Auto writes only autoEffort, refreshes on app return, and gates unavailable modules", async () => {
    const { result, rerender } = renderHook(() =>
      usePaseodogAutoEffort({
        provider: "paseodog",
        scope: "draft",
        serverId: "host",
        thinkingOptions: options,
      }),
    );
    await waitFor(() => expect(result.current.thinkingOptions).toHaveLength(3));
    runtime.client.invokePluginRpc.mockResolvedValue(snapshot(true));
    act(() => result.current.onSelectThinkingOption(AUTO_EFFORT_ID));
    await waitFor(() => expect(result.current.selectedThinkingOptionId).toBe(AUTO_EFFORT_ID));
    expect(runtime.client.invokePluginRpc).toHaveBeenLastCalledWith(
      "paseodog-provider",
      "engine-controls",
      { action: "main", route: { autoEffort: true } },
    );
    runtime.visible = false;
    rerender();
    runtime.client.invokePluginRpc.mockResolvedValue(snapshot(false, "none", false));
    runtime.visible = true;
    rerender();
    await waitFor(() => expect(result.current.thinkingOptions).toEqual(options));
    expect(runtime.client.invokePluginRpc).toHaveBeenLastCalledWith(
      "paseodog-provider",
      "engine-controls",
      { action: "read" },
    );
  });

  it("does not forward a delayed draft manual choice after switching hosts", async () => {
    runtime.client.invokePluginRpc.mockResolvedValue(snapshot(true));
    const select = vi.fn();
    const { result, rerender } = renderHook(
      ({ serverId }) =>
        usePaseodogAutoEffort({
          provider: "paseodog",
          scope: "draft",
          serverId,
          thinkingOptions: options,
          onSelectThinkingOption: select,
        }),
      { initialProps: { serverId: "host-one" } },
    );
    await waitFor(() => expect(result.current.selectedThinkingOptionId).toBe(AUTO_EFFORT_ID));
    const pending = deferred<ReturnType<typeof snapshot>>();
    runtime.client.invokePluginRpc.mockReturnValueOnce(pending.promise);
    act(() => result.current.onSelectThinkingOption("high"));
    runtime.client = {
      invokePluginRpc: vi.fn().mockResolvedValue(snapshot()),
      setAgentFeature: vi.fn(),
      fetchAgent: vi.fn(),
      isConnected: true,
    };
    rerender({ serverId: "host-two" });
    await waitFor(() => expect(result.current.thinkingOptions).toHaveLength(3));
    await act(async () => pending.resolve(snapshot(false)));
    expect(select).not.toHaveBeenCalled();
  });
});

describe("native Fast lightning toggle", () => {
  const fastSnapshot = (fast = false, fastCapable = true) => ({
    route: { provider: "test", model: "model", fast },
    models: [{ provider: "test", id: "model", fastCapable }],
  });
  it("keeps the toolbar icon-only and shows shared confirmed draft states in the sheet", async () => {
    runtime.client.invokePluginRpc.mockResolvedValue(fastSnapshot());
    render(
      <>
        <PaseodogCollaboration provider="paseodog" serverId="host" />
        <PaseodogCollaboration provider="paseodog" serverId="host" surface="sheet" />
      </>,
    );
    const triggers = screen.getAllByRole("switch", { name: /^Fast mode/ });
    await waitFor(() => expect(triggers[0].getAttribute("aria-label")).toBe("Fast mode: 꺼짐"));
    expect(triggers[0].textContent).toBe("");
    expect(triggers[1].textContent).toBe("Fast꺼짐");
    expect(screen.getAllByTestId("fast-icon")).toHaveLength(2);
    expect(screen.queryByText("OCHE")).toBeNull();
    expect(runtime.client.invokePluginRpc).toHaveBeenCalledTimes(1);
    const pending = deferred<ReturnType<typeof fastSnapshot>>();
    runtime.client.invokePluginRpc.mockReturnValueOnce(pending.promise);
    runtime.client.invokePluginRpc.mockResolvedValue(fastSnapshot(true));
    fireEvent.click(triggers[0]);
    // 저장 중에는 같은 호스트의 다른 스위치도 막혀 중복 쓰기가 없다.
    expect(triggers.map((toggle) => toggle.hasAttribute("disabled"))).toEqual([true, true]);
    expect(triggers[1].textContent).toBe("Fast확인 중");
    fireEvent.click(triggers[1]);
    expect(runtime.client.invokePluginRpc).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve(fastSnapshot(true)));
    expect(triggers.map((toggle) => toggle.getAttribute("aria-checked"))).toEqual(["true", "true"]);
    expect(triggers[1].textContent).toBe("Fast켜짐");
    expect(triggers[0].textContent).toBe("");
    runtime.client.invokePluginRpc.mockResolvedValue(fastSnapshot());
    fireEvent.click(triggers[1]);
    await waitFor(() => expect(triggers[0].getAttribute("aria-checked")).toBe("false"));
    expect(triggers[1].textContent).toBe("Fast꺼짐");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(runtime.client.invokePluginRpc.mock.calls.map((call) => call[2])).toEqual([
      { action: "read" },
      { action: "main", route: { fast: true } },
      { action: "read" },
      { action: "main", route: { fast: false } },
      { action: "read" },
    ]);
    expect(runtime.client.setAgentFeature).not.toHaveBeenCalled();
  });

  it("keeps uncertain-write feedback visible and the next press only refreshes", async () => {
    runtime.client.invokePluginRpc.mockResolvedValue(fastSnapshot());
    render(<PaseodogCollaboration provider="paseodog" serverId="host" />);
    const trigger = screen.getByRole("switch", { name: /^Fast mode/ });
    await waitFor(() => expect(trigger.getAttribute("aria-label")).toBe("Fast mode: 꺼짐"));
    runtime.client.invokePluginRpc.mockRejectedValueOnce(new Error("timeout"));
    fireEvent.click(trigger);
    await waitFor(() => expect(trigger.getAttribute("aria-label")).toBe("Fast mode: 확인 필요"));
    expect(screen.getAllByText(/저장 요청은 자동 재전송하지 않아요/).length).toBeGreaterThan(0);
    fireEvent.click(trigger);
    await waitFor(() => expect(trigger.getAttribute("aria-label")).toBe("Fast mode: 꺼짐"));
    expect(runtime.client.invokePluginRpc.mock.calls.map((call) => call[2])).toEqual([
      { action: "read" },
      { action: "main", route: { fast: true } },
      { action: "read" },
    ]);
  });

  it("gates the trigger while the composer is disabled or the host is disconnected", async () => {
    runtime.client.invokePluginRpc.mockResolvedValue(fastSnapshot());
    const { rerender } = render(
      <PaseodogCollaboration provider="paseodog" serverId="host" disabled />,
    );
    const trigger = screen.getByRole("switch", { name: /^Fast mode/ });
    expect(trigger.hasAttribute("disabled")).toBe(true);
    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog")).toBeNull();
    runtime.connected = false;
    rerender(<PaseodogCollaboration provider="paseodog" serverId="host" />);
    expect(trigger.hasAttribute("disabled")).toBe(true);
    expect(runtime.client.invokePluginRpc.mock.calls.map((call) => call[2])).toEqual([
      { action: "read" },
    ]);
  });

  it("shows the unsupported-model status in the sheet and disables the toggle", async () => {
    runtime.client.invokePluginRpc.mockResolvedValue(fastSnapshot(false, false));
    render(<PaseodogCollaboration provider="paseodog" serverId="host" surface="sheet" />);
    const trigger = screen.getByRole("switch", { name: /^Fast mode/ });
    await waitFor(() =>
      expect(trigger.getAttribute("aria-label")).toBe("Fast mode: 지원하지 않는 모델"),
    );
    expect(trigger.textContent).toBe("Fast지원하지 않는 모델");
    expect(trigger.hasAttribute("disabled")).toBe(true);
  });

  it("changes only the current live session, not Main or another session", async () => {
    runtime.client.fetchAgent.mockResolvedValue({
      agent: { features: [{ id: "fast", type: "toggle", value: false }] },
    });
    const { rerender } = render(
      <PaseodogFastScope.Provider value={firstFastScope}>
        <PaseodogCollaboration provider="paseodog" serverId="host" />
      </PaseodogFastScope.Provider>,
    );
    const trigger = screen.getByRole("switch", { name: /^Fast mode/ });
    await waitFor(() => expect(trigger.getAttribute("aria-checked")).toBe("false"));
    await waitFor(() => expect(trigger.hasAttribute("disabled")).toBe(false));
    runtime.client.fetchAgent.mockResolvedValue({
      agent: { features: [{ id: "fast", type: "toggle", value: true }] },
    });
    fireEvent.click(trigger);
    await waitFor(() => expect(trigger.getAttribute("aria-checked")).toBe("true"));
    expect(runtime.client.setAgentFeature).toHaveBeenCalledExactlyOnceWith("one", "fast", true);
    expect(runtime.client.invokePluginRpc).not.toHaveBeenCalled();
    runtime.client.fetchAgent.mockResolvedValue({
      agent: { features: [{ id: "fast", type: "toggle", value: false }] },
    });
    rerender(
      <PaseodogFastScope.Provider value={secondFastScope}>
        <PaseodogCollaboration provider="paseodog" serverId="host" />
      </PaseodogFastScope.Provider>,
    );
    await waitFor(() => expect(trigger.getAttribute("aria-checked")).toBe("false"));
    expect(runtime.client.fetchAgent).toHaveBeenLastCalledWith("two");
  });

  it("does not render or query collaboration for a direct provider", () => {
    render(<PaseodogCollaboration provider="codex" serverId="host" />);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(runtime.client.invokePluginRpc).not.toHaveBeenCalled();
  });
});

describe("PC-compatible confirmed control responses", () => {
  it("discards an invalidated in-flight read and refreshes once without replaying writes", async () => {
    const auto = createConfirmedHostControl(
      runtime.client,
      autoEffortSnapshotSchema,
      "unconfirmed",
    );
    runtime.client.invokePluginRpc.mockResolvedValue(snapshot(false));
    await auto.refresh();
    const pending = deferred<ReturnType<typeof snapshot>>();
    runtime.client.invokePluginRpc.mockReturnValueOnce(pending.promise);
    const staleRead = auto.refresh();
    runtime.client.invokePluginRpc.mockResolvedValue(snapshot(true));
    auto.invalidate();
    auto.invalidate();
    pending.resolve(snapshot(false));
    expect(await staleRead).toBe(false);
    await waitFor(() => expect(auto.getSnapshot().value?.route.autoEffort).toBe(true));
    expect(runtime.client.invokePluginRpc.mock.calls.map((call) => call[2])).toEqual([
      { action: "read" },
      { action: "read" },
      { action: "read" },
    ]);
  });

  it("rejects malformed snapshots and legacy collaboration modes", async () => {
    const auto = createConfirmedHostControl(
      runtime.client,
      autoEffortSnapshotSchema,
      "unconfirmed",
    );
    runtime.client.invokePluginRpc.mockResolvedValue({ route: { autoEffort: "true" } });
    expect(await auto.refresh()).toBe(false);
    expect(auto.getSnapshot()).toEqual({ value: null, busy: false, error: "unconfirmed" });
    const collaboration = createConfirmedHostControl(
      runtime.client,
      collaborationSnapshotSchema,
      "unconfirmed",
    );
    runtime.client.invokePluginRpc.mockResolvedValue({ orchestration: "balanced" });
    expect(await collaboration.refresh()).toBe(false);
    expect(collaboration.getSnapshot().error).toBe("unconfirmed");
  });
});

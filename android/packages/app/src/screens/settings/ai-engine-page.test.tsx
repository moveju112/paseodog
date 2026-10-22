// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";

const host = vi.hoisted(() => ({
  connected: true,
  invokePluginRpc: vi.fn(),
  openExternalUrl: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/utils/open-external-url", () => ({ openExternalUrl: host.openExternalUrl }));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => host,
  useHostRuntimeIsConnected: () => host.connected,
}));
vi.mock("@/hooks/use-app-visible", () => ({
  useAppActivelyVisible: () => true,
}));
interface MockChildren {
  children?: React.ReactNode;
}
interface MockLabelled extends MockChildren {
  accessibilityLabel?: string;
  disabled?: boolean;
}
interface MockOption {
  value: string;
  label: string;
}
interface MockInputProps {
  initialValue?: string;
  resetKey?: string | number;
  onChangeText?: (text: string) => void;
  accessibilityLabel?: string;
  multiline?: boolean;
  placeholder?: string;
}
vi.mock("react-native", () => ({
  View: ({ children }: MockChildren) => <div>{children}</div>,
  Text: ({ children, accessibilityLabel }: MockLabelled) => (
    <span aria-label={accessibilityLabel}>{children}</span>
  ),
  Pressable: ({
    children,
    onPress,
    accessibilityLabel,
  }: MockLabelled & { onPress?: () => void }) => (
    <button type="button" aria-label={accessibilityLabel} onClick={onPress}>
      {children}
    </button>
  ),
}));
// 실제 입력창처럼 초기값만 받고 resetKey가 바뀌면 새 값으로 교체한다.
vi.mock("@/components/adaptive-text-input", () => ({
  AdaptiveTextInput: function MockTextInput({
    initialValue,
    resetKey,
    onChangeText,
    accessibilityLabel,
    multiline,
    placeholder,
  }: MockInputProps) {
    const handleChange = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        onChangeText?.(event.target.value),
      [onChangeText],
    );
    return multiline ? (
      <textarea
        key={resetKey}
        placeholder={placeholder}
        aria-label={accessibilityLabel}
        defaultValue={initialValue}
        onChange={handleChange}
      />
    ) : (
      <input
        key={resetKey}
        placeholder={placeholder}
        aria-label={accessibilityLabel}
        defaultValue={initialValue}
        onChange={handleChange}
      />
    );
  },
}));
vi.mock("@/styles/settings", () => ({ settingsStyles: {} }));
vi.mock("@/components/settings/headings/settings-section", () => ({
  SettingsSection: ({ title, children }: MockChildren & { title: string }) => (
    <section aria-label={title}>{children}</section>
  ),
}));
vi.mock("@/components/ui/segmented-control", () => {
  // 선택지 버튼 하나 (누름 -> 해당 값 전달)
  function MockSegment({
    option,
    onValueChange,
  }: {
    option: MockOption;
    onValueChange: (value: string) => void;
  }) {
    const handleClick = React.useCallback(
      () => onValueChange(option.value),
      [onValueChange, option.value],
    );
    return (
      <button type="button" onClick={handleClick}>
        {option.label}
      </button>
    );
  }
  return {
    SegmentedControl: ({
      options,
      onValueChange,
    }: {
      options: MockOption[];
      onValueChange: (value: string) => void;
    }) => (
      <div>
        {options.map((option) => (
          <MockSegment key={option.value} option={option} onValueChange={onValueChange} />
        ))}
      </div>
    ),
  };
});
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: MockChildren) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: MockChildren) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: MockChildren & { onSelect: () => void }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/ui/dropdown-trigger", () => ({
  DropdownTrigger: ({ children, disabled, accessibilityLabel }: MockLabelled) => (
    <button type="button" disabled={disabled} aria-label={accessibilityLabel}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/ui/switch", () => ({
  Switch: function MockSwitch({
    value,
    onValueChange,
    accessibilityLabel,
    disabled,
  }: MockLabelled & {
    value: boolean;
    onValueChange: (value: boolean) => void;
  }) {
    const handleChange = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => onValueChange(event.target.checked),
      [onValueChange],
    );
    return (
      <input
        type="checkbox"
        aria-label={accessibilityLabel}
        checked={value}
        disabled={disabled}
        onChange={handleChange}
      />
    );
  },
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    disabled,
    accessibilityLabel,
    onPress,
  }: MockLabelled & { onPress?: () => void }) => (
    <button type="button" aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
// 닫기 버튼이 실제 시트의 닫기·Android 뒤로가기와 같은 onClose를 호출한다.
vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({
    visible,
    header,
    onClose,
    children,
  }: MockChildren & {
    visible: boolean;
    header: { title: string; actions?: React.ReactNode };
    onClose: () => void;
  }) =>
    visible ? (
      <div role="dialog" aria-label={header.title}>
        {header.actions}
        <button type="button" onClick={onClose}>
          시트 닫기
        </button>
        {children}
      </div>
    ) : null,
}));
import { AiEnginePage, type EngineSection } from "./ai-engine-page";
import { clearAiEngineSnapshotCache, useAiEngineSettings } from "./use-ai-engine-settings";
import { usePaseodogAutoEffortHost } from "@/hooks/use-paseodog-host-control";
import { EngineAccounts } from "./engine-accounts";

const route = {
  provider: "subscription",
  model: "small",
  effort: "low",
  autoEffort: false,
  fast: false,
};
const snapshot = {
  route,
  instructionFiles: "agents",
  compaction: { auto: true, onModelChange: true, mainBufferPercent: 0.2, mainBufferRatio: 20 },
  autoClear: { enabled: false, idleMs: 3600000, idleMinutes: 60, minContextPercent: 50 },
  orchestration: "balanced",
  models: [
    {
      id: "small",
      provider: "subscription",
      label: "Small",
      fastCapable: true,
      effortOptions: [{ id: "low", label: "Low" }],
    },
  ],
  agents: [
    {
      id: "worker",
      label: "Worker",
      description: "구현 담당",
      body: "---\nname: worker\n---\n  들여쓰기 유지\n",
      disabled: false,
      route,
    },
  ],
  workflows: [
    {
      id: "default",
      name: "Default",
      description: "기본 워크플로",
      body: "# Workflow Instructions\n",
      active: true,
    },
  ],
  workflowPack: {
    id: "default",
    name: "Default",
    description: "기본 워크플로",
    body: "# Workflow Instructions\n",
    source: "builtin",
    userOverride: false,
    editable: true,
  },
  tools: { modules: { core: true, search: true, web: true, subagent: true, review: true } },
  skills: {
    disabled: ["*"],
    items: [{ id: "demo-skill", name: "Demo Skill", description: "샘플 스킬", enabled: false }],
  },
  hooks: { rules: [] },
  sessions: [],
};

beforeEach(() => {
  clearAiEngineSnapshotCache();
  host.connected = true;
  host.invokePluginRpc.mockReset().mockResolvedValue(snapshot);
});
afterEach(cleanup);

describe("native host AI engine settings", () => {
  it("retains each host output style after saving, rereading and reopening settings", async () => {
    const outputStyles = [
      { id: "detailed", label: "Detailed" },
      { id: "simple", label: "Simple" },
      { id: "minimal", label: "Minimal" },
      { id: "extreme-minimal", label: "Extreme Minimal" },
      { id: "custom-style", label: "Custom Style" },
    ];
    let outputStyle = "simple";
    host.invokePluginRpc.mockImplementation(async (_plugin, _method, input) => {
      if (input.action === "preferences") outputStyle = input.outputStyle;
      return { ...snapshot, outputStyle, outputStyles };
    });
    let page = render(<AiEnginePage serverId="style-host" section="workflow" />);
    for (const style of outputStyles) {
      await screen.findByRole("button", { name: "응답 출력 스타일" });
      fireEvent.click(
        screen.getByRole("button", {
          name: `${outputStyle === style.id ? "✓ " : ""}${style.label}`,
        }),
      );
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "응답 출력 스타일" }).textContent).toBe(
          style.label,
        ),
      );
      await screen.findByText("저장했어요. 실시간으로 반영돼요.");
      page.unmount();
      clearAiEngineSnapshotCache();
      page = render(<AiEnginePage serverId="style-host" section="workflow" />);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "응답 출력 스타일" }).textContent).toBe(
          style.label,
        ),
      );
    }
    expect(
      host.invokePluginRpc.mock.calls
        .filter(([, , input]) => input.action === "preferences")
        .map(([, , input]) => input.outputStyle),
    ).toEqual(outputStyles.map((style) => style.id));
  });

  it("does not invent unsupported output styles when the host has no catalog", async () => {
    render(<AiEnginePage serverId="style-host" section="workflow" />);
    expect(await screen.findByRole("button", { name: "응답 출력 스타일" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.queryByRole("button", { name: "간결함 (Concise)" })).toBeNull();
  });

  it("refreshes mounted draft Auto after a settings save and settings after a draft save", async () => {
    let autoEffort = false;
    host.invokePluginRpc.mockImplementation(async (_plugin, _method, input) => {
      if (input.action === "main") autoEffort = input.route.autoEffort;
      return {
        ...snapshot,
        orchestration: "none",
        route: { ...route, autoEffort },
      };
    });
    const { result } = renderHook(() => ({
      settings: useAiEngineSettings("shared-host"),
      draft: usePaseodogAutoEffortHost("shared-host", true),
    }));
    await waitFor(() => expect(result.current.draft.snapshot.value?.route.autoEffort).toBe(false));
    await act(async () => {
      await result.current.settings.request({ action: "main", route: { autoEffort: true } });
    });
    await waitFor(() => expect(result.current.draft.snapshot.value?.route.autoEffort).toBe(true));
    await act(async () => {
      await result.current.draft.control?.request({ action: "main", route: { autoEffort: false } });
    });
    await waitFor(() => expect(result.current.settings.snapshot?.route.autoEffort).toBe(false));
    expect(
      host.invokePluginRpc.mock.calls.filter(([, , input]) => input.action === "main"),
    ).toHaveLength(2);
  });

  it("waits for workflow save confirmation and retains the editor on failure", async () => {
    let failSave: (error: Error) => void = () => {};
    host.invokePluginRpc.mockImplementation(async (_plugin, _method, input) => {
      if (input.action === "workflowSave")
        return new Promise((_resolve, reject) => {
          failSave = reject;
        });
      return snapshot;
    });
    render(<AiEnginePage serverId="host-one" section="workflow" />);
    fireEvent.click(await screen.findByRole("button", { name: "작업 규칙 Default" }));
    fireEvent.click(screen.getByLabelText("작업 규칙 활성화"));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByText("저장 중…")).toBeTruthy();
    expect(screen.queryByText("저장했어요. 실시간으로 반영돼요.")).toBeNull();
    expect(screen.getByRole("dialog", { name: "작업 규칙 편집" })).toBeTruthy();
    expect(host.invokePluginRpc).toHaveBeenCalledWith(
      "paseodog-provider",
      "engine-controls",
      expect.objectContaining({ action: "workflowSave", activate: false }),
    );
    failSave(new Error("disconnected"));
    await screen.findByText(
      "저장 결과를 확인하지 못했어요. 새로고침으로 현재 설정을 확인해 주세요.",
    );
    expect(screen.getByRole("dialog", { name: "작업 규칙 편집" })).toBeTruthy();
    expect(screen.queryByText("저장했어요. 실시간으로 반영돼요.")).toBeNull();
  });

  it("opens provider login and submits a one-time code only through account RPC", async () => {
    const onConnected = vi.fn();
    host.invokePluginRpc.mockImplementation(async (_plugin, _method, input) => {
      if (input.action === "status")
        return { state: "idle", connected: input.provider === "openai-oauth" };
      if (input.action === "start")
        return {
          state: "pending",
          id: "flow",
          url: "https://claude.ai/oauth/authorize",
          acceptsCode: true,
        };
      return { state: "completed" };
    });
    render(<EngineAccounts serverId="host-one" onConnected={onConnected} />);
    await screen.findByText("연결 안 됨");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText("일회성 로그인 코드")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));
    expect(screen.getByRole("dialog", { name: "Claude 구독 로그인" })).toBeTruthy();
    // 창을 여는 것만으로는 로그인을 시작하지 않는다.
    expect(host.invokePluginRpc.mock.calls.map(([, , input]) => input.action)).toEqual([
      "status",
      "status",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "브라우저 로그인 시작" }));
    await screen.findByLabelText("일회성 로그인 코드");
    expect(host.openExternalUrl).toHaveBeenCalledWith("https://claude.ai/oauth/authorize");
    fireEvent.change(screen.getByLabelText("일회성 로그인 코드"), {
      target: { value: "one-time-code" },
    });
    fireEvent.click(screen.getByRole("button", { name: "코드 제출" }));
    await waitFor(() => expect(onConnected).toHaveBeenCalledOnce());
    expect(host.invokePluginRpc).toHaveBeenLastCalledWith("paseodog-provider", "engine-auth", {
      action: "complete",
      provider: "anthropic-oauth",
      id: "flow",
      code: "one-time-code",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText("일회성 로그인 코드")).toBeNull();
    expect(document.body.textContent).not.toContain("one-time-code");
  });
  it("cancels a pending login when the sheet closes, including a late start reply", async () => {
    let releaseStart: (value: unknown) => void = () => {};
    host.invokePluginRpc.mockImplementation(async (_plugin, _method, input) => {
      if (input.action === "status") return { state: "idle", connected: false };
      if (input.action === "start")
        return {
          state: "pending",
          id: "flow",
          url: "https://claude.ai/oauth/authorize",
          acceptsCode: true,
        };
      return { state: "idle" };
    });
    render(<EngineAccounts serverId="host-one" onConnected={vi.fn()} />);
    await screen.findAllByText("연결 안 됨");
    fireEvent.click(screen.getAllByRole("button", { name: "로그인" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "브라우저 로그인 시작" }));
    fireEvent.change(await screen.findByLabelText("일회성 로그인 코드"), {
      target: { value: "secret-code" },
    });
    // 시트 닫기는 Android 뒤로가기와 같은 onClose 경로다.
    fireEvent.click(screen.getByRole("button", { name: "시트 닫기" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() =>
      expect(host.invokePluginRpc).toHaveBeenLastCalledWith("paseodog-provider", "engine-auth", {
        action: "cancel",
        provider: "anthropic-oauth",
        id: "flow",
      }),
    );
    expect(await screen.findByText("로그인을 취소했어요.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("secret-code");

    // 시작 응답 전에 닫으면 늦게 생성된 요청도 취소한다.
    host.invokePluginRpc.mockImplementation(async (_plugin, _method, input) => {
      if (input.action === "start")
        return new Promise((resolve) => {
          releaseStart = resolve;
        });
      if (input.action === "cancel") throw new Error("disconnected");
      return { state: "idle" };
    });
    fireEvent.click(screen.getAllByRole("button", { name: "로그인" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "브라우저 로그인 시작" }));
    fireEvent.click(screen.getByRole("button", { name: "시트 닫기" }));
    releaseStart({
      state: "pending",
      id: "late-flow",
      url: "https://claude.ai/oauth/authorize",
      acceptsCode: true,
    });
    await waitFor(() =>
      expect(host.invokePluginRpc).toHaveBeenLastCalledWith("paseodog-provider", "engine-auth", {
        action: "cancel",
        provider: "anthropic-oauth",
        id: "late-flow",
      }),
    );
    expect(await screen.findByText(/로그인 취소를 확인하지 못했어요/)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("shows only the controls of each separate host section and no main model picker", async () => {
    const markers: Record<Exclude<EngineSection, "agents">, string> = {
      accounts: "계정 연결",
      workflow: "자동 오케스트레이터 (Orchestration)",
      tokens: "Mixdog 토큰 절감 기술",
      instructions: "지침 파일",
      tools: "내장 도구 모듈 (Built-in Tools)",
      skills: "스킬 및 훅 (Skills & Lifecycle Hooks)",
    };
    for (const section of Object.keys(markers) as Array<Exclude<EngineSection, "agents">>) {
      clearAiEngineSnapshotCache();
      const view = render(<AiEnginePage serverId="host-one" section={section} />);
      await screen.findByRole("region", { name: markers[section] });
      for (const [other, marker] of Object.entries(markers)) {
        if (other !== section) expect(screen.queryByRole("region", { name: marker })).toBeNull();
      }
      expect(screen.queryByText("기본 모델 & 추론")).toBeNull();
      expect(screen.queryByText("새 대화와 메인 에이전트에 사용할 기본 모델")).toBeNull();
      expect(screen.queryByRole("button", { name: "모델" })).toBeNull();
      expect(screen.queryByRole("dialog")).toBeNull();
      view.unmount();
    }
  });
  it("sends token-saving changes from the token section", async () => {
    render(<AiEnginePage serverId="host-one" section="tokens" />);
    const compaction = await screen.findByRole("checkbox", { name: "자동 압축" });
    expect(screen.queryByText("자동 추론 조절 (Auto-Effort)")).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "토큰절감 자동 추론 조절" })).toBeNull();
    expect(host.invokePluginRpc.mock.calls.every(([, , input]) => input.action === "read")).toBe(
      true,
    );
    fireEvent.click(compaction);
    await waitFor(() =>
      expect(host.invokePluginRpc).toHaveBeenLastCalledWith(
        "paseodog-provider",
        "engine-controls",
        { action: "compaction", enabled: false },
      ),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "유휴 컨텍스트 자동 초기화" }));
    await waitFor(() =>
      expect(host.invokePluginRpc).toHaveBeenLastCalledWith(
        "paseodog-provider",
        "engine-controls",
        { action: "autoClear", enabled: true },
      ),
    );
  });
  it("toggles instruction file loading without touching language or profile settings", async () => {
    host.invokePluginRpc.mockImplementation(async (_plugin, _method, input) => ({
      ...snapshot,
      instructionFiles: input.action === "instructionFiles" && !input.enabled ? "off" : "all",
    }));
    render(<AiEnginePage serverId="host-one" section="instructions" />);
    const toggle = await screen.findByRole("checkbox", { name: "지침 파일 로딩" });
    await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(true));
    expect(screen.getByText(/~\/\.codex\/AGENTS\.md/)).toBeTruthy();
    expect(screen.getByText("변경 사항은 새 세션부터 적용돼요.")).toBeTruthy();
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(host.invokePluginRpc).toHaveBeenLastCalledWith(
        "paseodog-provider",
        "engine-controls",
        { action: "instructionFiles", enabled: false },
      ),
    );
    await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(false));
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(host.invokePluginRpc).toHaveBeenLastCalledWith(
        "paseodog-provider",
        "engine-controls",
        { action: "instructionFiles", enabled: true },
      ),
    );
    await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(true));
    const sent = host.invokePluginRpc.mock.calls.map(([, , input]) => JSON.stringify(input));
    expect(sent.some((input) => /language|profile/.test(input))).toBe(false);
  });
  it("restores the confirmed value when an optimistic save fails", async () => {
    let failSave: (error: Error) => void = () => {};
    host.invokePluginRpc.mockImplementation(async (_plugin, _method, input) => {
      if (input.action === "instructionFiles") {
        return new Promise((_resolve, reject) => {
          failSave = reject;
        });
      }
      return snapshot;
    });
    render(<AiEnginePage serverId="host-one" section="instructions" />);
    const toggle = await screen.findByRole("checkbox", { name: "지침 파일 로딩" });
    await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(true));
    fireEvent.click(toggle);
    await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(false));
    expect(screen.getByText("저장 중…")).toBeTruthy();
    failSave(new Error("disconnected"));
    await screen.findByText(
      "저장 결과를 확인하지 못했어요. 새로고침으로 현재 설정을 확인해 주세요.",
    );
    expect((toggle as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByText("저장 중…")).toBeNull();
  });
  it("keeps unsaved optimistic values out of the shared cache across remounts", async () => {
    let reads = 0;
    host.invokePluginRpc.mockImplementation(async (_plugin, _method, input) => {
      if (input.action === "read" && ++reads > 1) return new Promise(() => {});
      if (input.action === "instructionFiles") return new Promise(() => {});
      return snapshot;
    });
    const first = render(<AiEnginePage serverId="host-one" section="instructions" />);
    const toggle = await screen.findByRole("checkbox", { name: "지침 파일 로딩" });
    await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(true));
    fireEvent.click(toggle);
    await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(false));
    first.unmount();
    render(<AiEnginePage serverId="host-one" section="instructions" />);
    const remounted = await screen.findByRole("checkbox", { name: "지침 파일 로딩" });
    expect((remounted as HTMLInputElement).checked).toBe(true);
  });
  it("rolls back to the newest confirmed save, ignoring older out-of-order successes", async () => {
    const saves: Array<{ resolve: (value: unknown) => void; reject: (error: Error) => void }> = [];
    host.invokePluginRpc.mockImplementation(async (_plugin, _method, input) => {
      if (input.action !== "instructionFiles") return snapshot;
      return new Promise((resolve, reject) => saves.push({ resolve, reject }));
    });
    render(<AiEnginePage serverId="host-one" section="instructions" />);
    const toggle = (await screen.findByRole("checkbox", {
      name: "지침 파일 로딩",
    })) as HTMLInputElement;
    await waitFor(() => expect(toggle.checked).toBe(true));
    fireEvent.click(toggle);
    await waitFor(() => expect(saves).toHaveLength(1));
    fireEvent.click(toggle);
    await waitFor(() => expect(saves).toHaveLength(2));
    fireEvent.click(toggle);
    await waitFor(() => expect(saves).toHaveLength(3));
    await act(async () => saves[1].resolve({ ...snapshot, instructionFiles: "all" }));
    await act(async () => saves[0].resolve({ ...snapshot, instructionFiles: "off" }));
    expect(toggle.checked).toBe(false);
    await act(async () => saves[2].reject(new Error("disconnected")));
    await waitFor(() => expect(toggle.checked).toBe(true));
    expect(screen.queryByText(/일부 지침 파일만 불러오는 설정/)).toBeNull();
  });
  it("uses an earlier queued success as the rollback baseline when the latest save fails", async () => {
    const saves: Array<{ resolve: (value: unknown) => void; reject: (error: Error) => void }> = [];
    host.invokePluginRpc.mockImplementation(async (_plugin, _method, input) => {
      if (input.action !== "instructionFiles") return snapshot;
      return new Promise((resolve, reject) => saves.push({ resolve, reject }));
    });
    render(<AiEnginePage serverId="host-one" section="instructions" />);
    const toggle = (await screen.findByRole("checkbox", {
      name: "지침 파일 로딩",
    })) as HTMLInputElement;
    await waitFor(() => expect(toggle.checked).toBe(true));
    fireEvent.click(toggle);
    await waitFor(() => expect(saves).toHaveLength(1));
    fireEvent.click(toggle);
    await waitFor(() => expect(saves).toHaveLength(2));
    await act(async () => saves[0].resolve({ ...snapshot, instructionFiles: "off" }));
    expect(toggle.checked).toBe(true);
    await act(async () => saves[1].reject(new Error("disconnected")));
    await waitFor(() => expect(toggle.checked).toBe(false));
  });
  it("keeps a selective instruction mode on screen until the user toggles it", async () => {
    render(<AiEnginePage serverId="host-one" section="instructions" />);
    const toggle = await screen.findByRole("checkbox", { name: "지침 파일 로딩" });
    await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(true));
    expect(screen.getByText(/일부 지침 파일만 불러오는 설정\(agents\)/)).toBeTruthy();
    expect(host.invokePluginRpc.mock.calls.map(([, , input]) => input.action)).toEqual(["read"]);
  });
  it("opens Mixdog-style agent editor modal with switch, model chain, and AGENT.md body", async () => {
    render(<AiEnginePage serverId="host-one" section="workflow" />);
    fireEvent.click(await screen.findByRole("button", { name: "에이전트 Worker" }));
    expect(screen.getByRole("dialog", { name: "에이전트 편집" })).toBeTruthy();
    expect((screen.getByLabelText("에이전트 프롬프트 본문") as HTMLTextAreaElement).value).toBe(
      "---\nname: worker\n---\n  들여쓰기 유지\n",
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "에이전트 사용" }));
    await waitFor(() =>
      expect(host.invokePluginRpc).toHaveBeenCalledWith("paseodog-provider", "engine-controls", {
        action: "agent",
        agent: "worker",
        route: { disabled: true },
      }),
    );
    fireEvent.change(screen.getByLabelText("에이전트 프롬프트 본문"), {
      target: { value: "# Updated Worker\n" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() =>
      expect(host.invokePluginRpc).toHaveBeenCalledWith(
        "paseodog-provider",
        "engine-controls",
        expect.objectContaining({
          action: "agentSave",
          agent: "worker",
          name: "Worker",
          description: "구현 담당",
          body: "# Updated Worker\n",
          route: expect.objectContaining({
            disabled: true,
            provider: "subscription",
            model: "small",
          }),
        }),
      ),
    );
  });
  it("selects disabled workflow directly without opening or reading its document", async () => {
    host.invokePluginRpc.mockResolvedValue({
      ...snapshot,
      workflows: [...snapshot.workflows, { id: "none", name: "사용 안 함", active: false }],
    });
    render(<AiEnginePage serverId="host-one" section="workflow" />);
    fireEvent.click(await screen.findByRole("button", { name: "작업 규칙 사용 안 함" }));
    await waitFor(() =>
      expect(host.invokePluginRpc).toHaveBeenCalledWith("paseodog-provider", "engine-controls", {
        action: "workflow",
        workflow: "none",
      }),
    );
    expect(screen.queryByRole("dialog", { name: "작업 규칙 편집" })).toBeNull();
    expect(host.invokePluginRpc).not.toHaveBeenCalledWith("paseodog-provider", "engine-controls", {
      action: "workflowPack",
      workflow: "none",
    });
    expect(
      screen.getByText(
        "기본값은 사용 안 함입니다. 사용 안 함은 WORKFLOW.md를 읽거나 대화 지침에 추가하지 않습니다.",
      ),
    ).toBeTruthy();
  });

  it("opens Mixdog-style workflow rule modals to edit and create workflow rules", async () => {
    render(<AiEnginePage serverId="host-one" section="workflow" />);
    fireEvent.click(await screen.findByRole("button", { name: "협업" }));
    await waitFor(() =>
      expect(host.invokePluginRpc).toHaveBeenLastCalledWith(
        "paseodog-provider",
        "engine-controls",
        { action: "orchestration", mode: "swarm" },
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "작업 규칙 Default" }));
    expect(screen.getByRole("dialog", { name: "작업 규칙 편집" })).toBeTruthy();
    const bodyInput = await screen.findByLabelText("워크플로 본문");
    expect(bodyInput.getAttribute("placeholder")).toBe("사용할 WORKFLOW.md 지침을 작성하세요.");
    fireEvent.change(bodyInput, { target: { value: "# Custom Rules\n- Always verify.\n" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() =>
      expect(host.invokePluginRpc).toHaveBeenCalledWith("paseodog-provider", "engine-controls", {
        action: "workflowSave",
        workflow: "default",
        name: "Default",
        description: "기본 워크플로",
        body: "# Custom Rules\n- Always verify.\n",
        activate: true,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "새 작업 규칙 추가" }));
    expect(screen.getByRole("dialog", { name: "새 작업 규칙" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("새 워크플로 이름"), {
      target: { value: "Native Copy" },
    });
    fireEvent.change(screen.getByLabelText("새 워크플로 본문"), {
      target: { value: "# Custom\n\n  keep \tspacing\n" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() =>
      expect(host.invokePluginRpc).toHaveBeenLastCalledWith(
        "paseodog-provider",
        "engine-controls",
        {
          action: "workflowCreate",
          workflow: "native-copy",
          name: "Native Copy",
          description: "",
          body: "# Custom\n\n  keep \tspacing\n",
          activate: true,
        },
      ),
    );
  });
  it("keeps offline hosts from issuing settings requests", () => {
    host.connected = false;
    render(<AiEnginePage serverId="offline" section="workflow" />);
    expect(screen.getByText("호스트에 연결한 뒤 설정할 수 있어요.")).toBeTruthy();
    expect(host.invokePluginRpc).not.toHaveBeenCalled();
  });
  it("shows an unavailable-engine error rather than an empty successful form", async () => {
    host.invokePluginRpc.mockRejectedValue(new Error("Plugin not registered"));
    render(<AiEnginePage serverId="plain-paseo" section="tokens" />);
    expect(await screen.findByText(/AI 엔진을 불러오지 못했어요/)).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "자동 압축" })).toBeNull();
  });
});

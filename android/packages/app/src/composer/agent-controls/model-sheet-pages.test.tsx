// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const layout = vi.hoisted(() => ({ compact: true }));
// Android 뒤로가기 대역: 최신 리스너부터 호출하고 true면 전파를 멈춘다.
const backPress = vi.hoisted(() => {
  const listeners: (() => boolean)[] = [];
  return {
    listeners,
    press: () => [...listeners].reverse().some((listener) => listener()),
  };
});
vi.mock("@/components/ui/isolated-bottom-sheet-modal/back-press", () => ({
  systemBackPress: {
    subscribe(listener: () => boolean) {
      backPress.listeners.push(listener);
      return () => {
        const index = backPress.listeners.indexOf(listener);
        if (index >= 0) backPress.listeners.splice(index, 1);
      };
    },
  },
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("react-native", () => ({
  Keyboard: { dismiss() {} },
  View: ({ children, testID }: any) => <div data-testid={testID}>{children}</div>,
  Text: ({ children }: any) => <span>{children}</span>,
  ScrollView: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => ({ providerIcon: { color: "#fff" } }) },
}));
vi.mock("@/components/ui/scroll-view", () => ({
  ScrollView: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => layout.compact }));
vi.mock("@/constants/platform", () => ({ isNative: true, isWeb: false }));
vi.mock("@/components/provider-icons", () => ({ useProviderIcon: () => () => null }));
// 시트 렌더 횟수와 헤더(뒤로·닫기)를 DOM으로 노출한다.
vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({ visible, header, onClose, presentation, children }: any) =>
    visible ? (
      <div role="dialog" data-presentation={presentation ?? "root"}>
        <h2>{header.title}</h2>
        {header.back ? <button onClick={header.back.onPress}>back</button> : null}
        <button onClick={onClose}>close</button>
        {children}
      </div>
    ) : null,
}));
vi.mock("@/components/ui/combobox-trigger", () => ({
  ComboboxTrigger: ({ onPress, children }: any) => (
    <button aria-label="model settings" onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@/composer/agent-controls/control", () => ({
  AgentControlTrigger: ({ label, onPress, disabled }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("@/composer/agent-controls/glyph", () => ({
  ComposerToolbarGlyph: ({ children }: any) => children,
}));
// 브라우저 상태(전체/제공자)를 실제 훅처럼 유지하는 최소 대역.
vi.mock("@/components/model-browser", async () => {
  const { useState } = await import("react");
  return {
    useModelBrowser: ({ providers }: { providers: unknown[] }) => {
      const [view, setView] = useState<string>("all");
      return {
        view,
        header:
          view === "all"
            ? { title: "modelSelector.title", search: { onChange() {}, resetKey: 0 } }
            : {
                title: `provider:${view}`,
                back: providers.length > 1 ? { onPress: () => setView("all") } : undefined,
              },
        selectedModelLabel: "Small",
        triggerLabel: "Small",
        showAll: () => setView("all"),
        reset() {},
        drillDown: (providerId: string) => setView(providerId),
      };
    },
    ModelBrowser: ({ state, onSelect, rootBrowseContent }: any) =>
      rootBrowseContent ? (
        <div>{rootBrowseContent}</div>
      ) : (
        <div data-testid={`browser-${state.view}`}>
          {state.view === "all" ? (
            <button onClick={() => state.drillDown("paseodog")}>open provider</button>
          ) : null}
          <button onClick={() => onSelect("paseodog", "large")}>pick large</button>
        </div>
      ),
  };
});
import { CompactModelSheet, type CompactSheetThinkingPage } from "./model-sheet";

const AUTO_EFFORT_ID = "paseodog:auto-effort";
const providers = [
  { id: "paseodog", label: "PaseoDog", modelSelection: { kind: "models" as const, rows: [] } },
  { id: "codex", label: "Codex", modelSelection: { kind: "models" as const, rows: [] } },
];

beforeEach(() => {
  vi.stubGlobal("React", React);
  layout.compact = true;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// 내부 페이지 계약을 검증하는 시트를 렌더한다.
function renderSheet({
  canSwitchProvider = false,
  thinkingDisabled = false,
}: { canSwitchProvider?: boolean; thinkingDisabled?: boolean } = {}) {
  const onSelect = vi.fn();
  const onThinkingSelect = vi.fn();
  const onClose = vi.fn();
  const thinkingPage: CompactSheetThinkingPage = {
    title: "agentControls.thinking.title",
    options: [
      { id: AUTO_EFFORT_ID, label: "자동 추론" },
      { id: "low", label: "Low" },
      { id: "high", label: "High" },
    ],
    value: "low",
    onSelect: onThinkingSelect,
    renderOption: ({ option, selected, onPress }) => (
      <button aria-pressed={selected} onClick={onPress}>
        {`option:${option.label}`}
      </button>
    ),
  };
  render(
    <CompactModelSheet
      providers={providers}
      selectedProvider="paseodog"
      selectedModel="small"
      thinkingLabel="Low"
      onSelect={onSelect}
      onClose={onClose}
      isLoading={false}
      serverId="host"
      glyphSize={16}
      canSwitchProvider={canSwitchProvider}
      thinkingPage={layout.compact ? thinkingPage : null}
    >
      {({ openThinkingPage }) => (
        <button disabled={thinkingDisabled} onClick={openThinkingPage}>
          {openThinkingPage ? "thinking page trigger" : "thinking combobox trigger"}
        </button>
      )}
    </CompactModelSheet>,
  );
  return { onSelect, onThinkingSelect, onClose };
}

function openRoot() {
  fireEvent.click(screen.getByRole("button", { name: "model settings" }));
}

// Android 뒤로가기 한 번 (처리 여부 반환)
function pressBack(): boolean {
  let handled = false;
  act(() => {
    handled = backPress.press();
  });
  return handled;
}

function expectSingleRootSheet() {
  const dialogs = screen.getAllByRole("dialog");
  expect(dialogs).toHaveLength(1);
  expect(dialogs[0].getAttribute("data-presentation")).toBe("root");
}

describe("compact model sheet internal pages", () => {
  it("opens the model page inside the one root sheet and back returns to the menu", () => {
    const { onSelect } = renderSheet();
    openRoot();
    expectSingleRootSheet();
    fireEvent.click(screen.getByText("modelSelector.model"));
    expectSingleRootSheet();
    expect(screen.getByTestId("browser-paseodog")).toBeTruthy();
    expect(screen.queryByText("thinking page trigger")).toBeNull();
    fireEvent.click(screen.getByText("back"));
    expectSingleRootSheet();
    expect(screen.getByText("modelSelector.selectModel")).toBeTruthy();
    expect(screen.getByText("thinking page trigger")).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps provider drilldown back steps before returning to the menu", () => {
    const { onSelect } = renderSheet({ canSwitchProvider: true });
    openRoot();
    fireEvent.click(screen.getByText("modelSelector.model"));
    expect(screen.getByTestId("browser-all")).toBeTruthy();
    fireEvent.click(screen.getByText("open provider"));
    expect(screen.getByText("provider:paseodog")).toBeTruthy();
    fireEvent.click(screen.getByText("back"));
    expect(screen.getByTestId("browser-all")).toBeTruthy();
    fireEvent.click(screen.getByText("open provider"));
    fireEvent.click(screen.getByText("pick large"));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("paseodog", "large");
    expectSingleRootSheet();
    expect(screen.getByText("thinking page trigger")).toBeTruthy();
  });

  it("selects Auto effort on the thinking page once and returns to the menu", () => {
    const { onThinkingSelect } = renderSheet();
    openRoot();
    fireEvent.click(screen.getByText("thinking page trigger"));
    expectSingleRootSheet();
    expect(screen.getByText("agentControls.thinking.title")).toBeTruthy();
    expect(screen.getByText("option:Low").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByText("option:자동 추론"));
    expect(onThinkingSelect).toHaveBeenCalledExactlyOnceWith(AUTO_EFFORT_ID);
    expect(screen.queryByText("option:자동 추론")).toBeNull();
    expect(screen.getByText("thinking page trigger")).toBeTruthy();
    expectSingleRootSheet();
  });

  it("survives repeated taps and thinking back navigation without stacking sheets", () => {
    const { onThinkingSelect } = renderSheet();
    openRoot();
    for (let round = 0; round < 3; round += 1) {
      fireEvent.click(screen.getByText("thinking page trigger"));
      expectSingleRootSheet();
      fireEvent.click(screen.getByText("back"));
      fireEvent.click(screen.getByText("modelSelector.model"));
      expectSingleRootSheet();
      fireEvent.click(screen.getByText("back"));
      expectSingleRootSheet();
    }
    expect(onThinkingSelect).not.toHaveBeenCalled();
  });

  it("global close from an internal page fully resets and reopens at the menu", () => {
    const { onClose } = renderSheet();
    openRoot();
    fireEvent.click(screen.getByText("thinking page trigger"));
    fireEvent.click(screen.getByText("close"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
    openRoot();
    expectSingleRootSheet();
    expect(screen.getByText("modelSelector.selectModel")).toBeTruthy();
    fireEvent.click(screen.getByText("modelSelector.model"));
    fireEvent.click(screen.getByText("close"));
    openRoot();
    expect(screen.getByText("thinking page trigger")).toBeTruthy();
    expect(screen.queryByTestId("browser-paseodog")).toBeNull();
  });

  it("keeps disabled thinking controls inert", () => {
    renderSheet({ thinkingDisabled: true });
    openRoot();
    fireEvent.click(screen.getByText("thinking page trigger"));
    expect(screen.queryByText("option:Low")).toBeNull();
    expect(screen.getByText("thinking page trigger")).toBeTruthy();
  });

  it("routes Android back through internal pages before the sheet may close", () => {
    const { onSelect, onThinkingSelect, onClose } = renderSheet({ canSwitchProvider: true });
    openRoot();
    expect(backPress.listeners).toHaveLength(0);
    fireEvent.click(screen.getByText("modelSelector.model"));
    fireEvent.click(screen.getByText("open provider"));
    expect(pressBack()).toBe(true);
    expect(screen.getByTestId("browser-all")).toBeTruthy();
    expect(pressBack()).toBe(true);
    expect(screen.getByText("thinking page trigger")).toBeTruthy();
    fireEvent.click(screen.getByText("thinking page trigger"));
    expect(pressBack()).toBe(true);
    expect(screen.queryByText("option:Low")).toBeNull();
    expect(screen.getByText("thinking page trigger")).toBeTruthy();
    expectSingleRootSheet();
    expect(backPress.listeners).toHaveLength(0);
    expect(backPress.press()).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onThinkingSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("leaves the desktop dialog on its existing combobox path", () => {
    layout.compact = false;
    renderSheet();
    openRoot();
    expectSingleRootSheet();
    expect(screen.getByText("thinking combobox trigger")).toBeTruthy();
    expect(screen.queryByText("thinking page trigger")).toBeNull();
    expect(screen.queryByText("back")).toBeNull();
  });
});

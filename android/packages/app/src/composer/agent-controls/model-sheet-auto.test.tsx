// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const layout = vi.hoisted(() => ({ compact: true }));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("react-native", () => ({
  Keyboard: { dismiss() {} },
  View: ({ children }: any) => <div>{children}</div>,
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
vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({ visible, children }: any) =>
    visible ? <div role="dialog">{children}</div> : null,
}));
vi.mock("@/components/ui/combobox-trigger", () => ({
  ComboboxTrigger: ({ onPress, children }: any) => (
    <button aria-label="채팅 모델 설정" onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@/composer/agent-controls/control", () => ({
  AgentControlTrigger: ({ label, onPress }: any) => <button onClick={onPress}>{label}</button>,
}));
vi.mock("@/composer/agent-controls/glyph", () => ({
  ComposerToolbarGlyph: ({ children }: any) => children,
}));
vi.mock("@/components/model-browser", () => ({
  useModelBrowser: () => ({
    header: {},
    selectedModelLabel: "Small",
    triggerLabel: "Small",
    showAll() {},
    reset() {},
    drillDown() {},
  }),
  ModelBrowser: ({ rootBrowseContent }: any) => <div>{rootBrowseContent}</div>,
}));
import { CompactModelSheet } from "./model-sheet";

beforeEach(() => {
  vi.stubGlobal("React", React);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("chat model settings effort ownership", () => {
  it.each([true, false])(
    "keeps Effort children without a separate Auto toggle (compact=%s)",
    (compact) => {
      layout.compact = compact;
      render(
        <CompactModelSheet
          providers={[]}
          selectedProvider="paseodog"
          selectedModel="small"
          thinkingLabel="Low"
          onSelect={() => {}}
          isLoading={false}
          serverId="dedicated-host"
          glyphSize={16}
          canSwitchProvider={false}
        >
          <span>사고 수준</span>
        </CompactModelSheet>,
      );
      expect(screen.queryByText(/자동 추론 조절/)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "채팅 모델 설정" }));
      expect(screen.getByText("사고 수준")).toBeTruthy();
      expect(screen.queryByText(/자동 추론 조절/)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "채팅 모델 설정" }));
      expect(screen.queryByText(/자동 추론 조절/)).toBeNull();
    },
  );
  it.each(["codex", "claude"])(
    "does not advertise Mixdog Auto for direct %s sessions",
    (provider) => {
      layout.compact = true;
      render(
        <CompactModelSheet
          providers={[]}
          selectedProvider={provider}
          selectedModel="small"
          thinkingLabel="Low"
          onSelect={() => {}}
          isLoading={false}
          serverId="host"
          glyphSize={16}
          canSwitchProvider={false}
        >
          {null}
        </CompactModelSheet>,
      );
      fireEvent.click(screen.getByRole("button", { name: "채팅 모델 설정" }));
      expect(screen.queryByText(/자동 추론 조절/)).toBeNull();
    },
  );
});

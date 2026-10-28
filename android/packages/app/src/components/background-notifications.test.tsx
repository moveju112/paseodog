/** @vitest-environment jsdom */
import React from "react";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  enabled: true,
  active: true,
  appState: "active",
  sync: () => {},
  visibility: () => {},
  setActive: vi.fn(),
  unsubscribe: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  AppState: {
    get currentState() {
      return state.appState;
    },
    addEventListener: (_: string, callback: () => void) => {
      state.visibility = callback;
      return { remove: state.remove };
    },
  },
}));
vi.mock("expo-modules-core", () => ({
  requireNativeModule: () => ({ setActive: state.setActive }),
}));
vi.mock("@/hooks/use-settings", () => ({
  useAppSettings: () => ({ settings: { backgroundNotificationsEnabled: state.enabled } }),
}));
vi.mock("@/stores/session-store", () => ({
  selectAgentTurnPresentation: () => ({ isActive: state.active }),
  useSessionStore: {
    getState: () => ({
      sessions: { host: { agents: new Map([["agent", {}]]), messageSubmissions: new Map() } },
    }),
    subscribe: (callback: () => void) => {
      state.sync = callback;
      return state.unsubscribe;
    },
  },
}));
import { BackgroundNotifications } from "./background-notifications";

beforeEach(() => {
  vi.clearAllMocks();
  state.enabled = true;
  state.active = true;
  state.appState = "active";
});
afterEach(() => vi.restoreAllMocks());

it("keeps the service across home/other apps and stops when work finishes", () => {
  const view = render(<BackgroundNotifications />);
  expect(state.setActive.mock.calls).toEqual([[true]]);
  state.appState = "background";
  state.visibility();
  state.sync();
  expect(state.setActive.mock.calls).toEqual([[true]]);
  state.active = false;
  state.sync();
  expect(state.setActive.mock.calls).toEqual([[true], [false]]);
  view.unmount();
  expect(state.unsubscribe).toHaveBeenCalledOnce();
  expect(state.remove).toHaveBeenCalledOnce();
});

it("never starts for idle work or disabled notifications", () => {
  state.active = false;
  const view = render(<BackgroundNotifications />);
  expect(state.setActive).not.toHaveBeenCalled();
  state.enabled = false;
  state.active = true;
  view.rerender(<BackgroundNotifications />);
  expect(state.setActive.mock.calls).toEqual([[false]]);
  view.unmount();
});

it("defers a new service start until foreground, then retries", () => {
  state.appState = "background";
  const view = render(<BackgroundNotifications />);
  expect(state.setActive).not.toHaveBeenCalled();
  state.appState = "active";
  state.visibility();
  expect(state.setActive).toHaveBeenCalledWith(true);
  state.enabled = false;
  view.rerender(<BackgroundNotifications />);
  expect(state.setActive).toHaveBeenLastCalledWith(false);
  view.unmount();
});

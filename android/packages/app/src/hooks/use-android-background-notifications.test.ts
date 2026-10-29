/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  platform: "android",
  fdroid: false,
  appState: "active",
  enabled: true,
  loading: false,
  listeners: new Set<(state: string) => void>(),
  permissions: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return state.platform;
    },
  },
  AppState: {
    get currentState() {
      return state.appState;
    },
    addEventListener: (_event: string, listener: (state: string) => void) => {
      state.listeners.add(listener);
      return { remove: () => state.listeners.delete(listener) };
    },
  },
}));
vi.mock("@/constants/build-profile", () => ({
  get isFdroidBuild() {
    return state.fdroid;
  },
}));
vi.mock("@/hooks/use-settings", () => ({
  useAppSettings: () => ({
    settings: { backgroundNotificationsEnabled: state.enabled },
    isLoading: state.loading,
  }),
}));
vi.mock("expo-notifications", () => ({ getPermissionsAsync: state.permissions }));
vi.mock("@/utils/android-background-service", () => ({
  startAndroidBackgroundService: state.start,
  stopAndroidBackgroundService: state.stop,
}));
import { useAndroidBackgroundNotifications } from "./use-android-background-notifications";

function changeAppState(next: string) {
  act(() => {
    state.appState = next;
    state.listeners.forEach((listener) => listener(next));
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  state.platform = "android";
  state.fdroid = false;
  state.appState = "active";
  state.enabled = true;
  state.loading = false;
  state.listeners.clear();
  state.permissions.mockResolvedValue({ granted: true });
  state.start.mockResolvedValue(undefined);
  state.stop.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

it("starts while visible and preserves the service after going home", async () => {
  const view = renderHook(useAndroidBackgroundNotifications);
  await waitFor(() => expect(state.start).toHaveBeenCalledOnce());
  changeAppState("inactive");
  changeAppState("background");
  await act(async () => {});
  expect(state.stop).not.toHaveBeenCalled();
  changeAppState("active");
  await waitFor(() => expect(state.start).toHaveBeenCalledTimes(2));
  view.unmount();
  await waitFor(() => expect(state.stop).toHaveBeenCalledOnce());
  expect(state.listeners.size).toBe(0);
});

it("waits for stored opt-in and stops after opt-out", async () => {
  state.loading = true;
  const view = renderHook(useAndroidBackgroundNotifications);
  await act(async () => {});
  expect(state.start).not.toHaveBeenCalled();
  state.loading = false;
  state.enabled = false;
  view.rerender();
  await waitFor(() => expect(state.stop).toHaveBeenCalledOnce());
  expect(state.start).not.toHaveBeenCalled();
  state.enabled = true;
  view.rerender();
  await waitFor(() => expect(state.start).toHaveBeenCalledOnce());
  state.enabled = false;
  view.rerender();
  await waitFor(() => expect(state.stop).toHaveBeenCalledTimes(4));
  view.unmount();
});

it("defers a background mount until the app resumes", async () => {
  state.appState = "background";
  const view = renderHook(useAndroidBackgroundNotifications);
  await act(async () => {});
  expect(state.start).not.toHaveBeenCalled();
  expect(state.permissions).not.toHaveBeenCalled();
  changeAppState("active");
  await waitFor(() => expect(state.start).toHaveBeenCalledOnce());
  view.unmount();
});

it("does not start if the app backgrounds during the permission check", async () => {
  let resolve!: (value: { granted: boolean }) => void;
  state.permissions.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = renderHook(useAndroidBackgroundNotifications);
  await waitFor(() => expect(state.permissions).toHaveBeenCalledOnce());
  changeAppState("background");
  await act(async () => resolve({ granted: true }));
  expect(state.start).not.toHaveBeenCalled();
  view.unmount();
});

it("stops without requesting permission when permission was revoked", async () => {
  const view = renderHook(useAndroidBackgroundNotifications);
  await waitFor(() => expect(state.start).toHaveBeenCalledOnce());
  state.permissions.mockResolvedValue({ granted: false });
  changeAppState("background");
  changeAppState("active");
  await waitFor(() => expect(state.stop).toHaveBeenCalledOnce());
  expect(state.start).toHaveBeenCalledOnce();
  view.unmount();
});

it("serializes rapid opt-out and opt-in behind an in-flight start", async () => {
  let resolve!: () => void;
  const calls: string[] = [];
  state.start
    .mockImplementationOnce(() => {
      calls.push("start");
      return new Promise<void>((done) => {
        resolve = done;
      });
    })
    .mockImplementation(async () => {
      calls.push("start");
    });
  state.stop.mockImplementation(async () => {
    calls.push("stop");
  });
  const view = renderHook(useAndroidBackgroundNotifications);
  await waitFor(() => expect(state.start).toHaveBeenCalledOnce());
  state.enabled = false;
  view.rerender();
  state.enabled = true;
  view.rerender();
  await act(async () => resolve());
  await waitFor(() => expect(state.start).toHaveBeenCalledTimes(2));
  expect(calls).toEqual(["start", "stop", "stop", "start"]);
  view.unmount();
});

it("cancels a pending permission check on unmount", async () => {
  let resolve!: (value: { granted: boolean }) => void;
  state.permissions.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = renderHook(useAndroidBackgroundNotifications);
  await waitFor(() => expect(state.permissions).toHaveBeenCalledOnce());
  view.unmount();
  await act(async () => resolve({ granted: true }));
  await waitFor(() => expect(state.stop).toHaveBeenCalledOnce());
  expect(state.start).not.toHaveBeenCalled();
});

it.each(["ios", "web", "fdroid"])("does not change %s lifecycle", async (platform) => {
  state.platform = platform === "fdroid" ? "android" : platform;
  state.fdroid = platform === "fdroid";
  const view = renderHook(useAndroidBackgroundNotifications);
  await act(async () => {});
  expect(state.start).not.toHaveBeenCalled();
  expect(state.permissions).not.toHaveBeenCalled();
  view.unmount();
  expect(state.stop).not.toHaveBeenCalled();
});

it("reports a failed start and retries only after a foreground transition", async () => {
  const error = new Error("service unavailable");
  state.start.mockRejectedValueOnce(error);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const view = renderHook(useAndroidBackgroundNotifications);
  await waitFor(() =>
    expect(warn).toHaveBeenCalledWith("[Notifications] Background service failed", error),
  );
  changeAppState("background");
  expect(state.start).toHaveBeenCalledOnce();
  changeAppState("active");
  await waitFor(() => expect(state.start).toHaveBeenCalledTimes(2));
  view.unmount();
});

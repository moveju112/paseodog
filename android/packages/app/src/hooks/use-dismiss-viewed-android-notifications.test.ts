/** @vitest-environment jsdom */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  platform: "android",
  visible: true,
  dismiss: vi.fn(),
}));

vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return state.platform;
    },
  },
}));
vi.mock("@/hooks/use-app-visible", () => ({
  useAppActivelyVisible: () => state.visible,
}));
vi.mock("@/utils/android-notifications", () => ({
  dismissAndroidSessionNotifications: state.dismiss,
}));

import { useDismissViewedAndroidNotifications } from "./use-dismiss-viewed-android-notifications";

interface Props {
  serverId: string;
  agentId: string | null;
}

function useViewedSession({ serverId, agentId }: Props) {
  useDismissViewedAndroidNotifications(serverId, agentId);
}

beforeEach(() => {
  vi.resetAllMocks();
  state.platform = "android";
  state.visible = true;
  state.dismiss.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

it("clears the opened session and follows session and host changes", () => {
  const view = renderHook(useViewedSession, {
    initialProps: { serverId: "host", agentId: "a" } as Props,
  });
  view.rerender({ serverId: "host", agentId: "b" });
  view.rerender({ serverId: "other-host", agentId: "b" });

  expect(state.dismiss.mock.calls).toEqual([
    ["host", "a"],
    ["host", "b"],
    ["other-host", "b"],
  ]);
  view.unmount();
});

it("preserves notifications in the background and clears only the session visible on return", () => {
  state.visible = false;
  const view = renderHook(useViewedSession, {
    initialProps: { serverId: "host", agentId: "a" } as Props,
  });
  view.rerender({ serverId: "host", agentId: "b" });
  expect(state.dismiss).not.toHaveBeenCalled();

  state.visible = true;
  view.rerender({ serverId: "host", agentId: "b" });
  expect(state.dismiss.mock.calls).toEqual([["host", "b"]]);

  state.visible = false;
  view.rerender({ serverId: "host", agentId: "b" });
  expect(state.dismiss).toHaveBeenCalledTimes(1);
  state.visible = true;
  view.rerender({ serverId: "host", agentId: "b" });
  expect(state.dismiss).toHaveBeenCalledTimes(2);
  view.unmount();
});

it("does not clear notifications without an opened agent", () => {
  const view = renderHook(useViewedSession, {
    initialProps: { serverId: "host", agentId: null } as Props,
  });
  expect(state.dismiss).not.toHaveBeenCalled();
  view.unmount();
});

it.each(["ios", "web"])("leaves %s notification behavior unchanged", (platform) => {
  state.platform = platform;
  const view = renderHook(useViewedSession, {
    initialProps: { serverId: "host", agentId: "a" } as Props,
  });
  expect(state.dismiss).not.toHaveBeenCalled();
  view.unmount();
});

it("reports native failures without rejecting the session open", async () => {
  const error = new Error("tray unavailable");
  state.dismiss.mockRejectedValue(error);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const view = renderHook(useViewedSession, {
    initialProps: { serverId: "host", agentId: "a" } as Props,
  });
  await waitFor(() =>
    expect(warn).toHaveBeenCalledWith(
      "[Notifications] Failed to dismiss viewed session notifications",
      error,
    ),
  );
  view.unmount();
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  permissions: vi.fn(),
  request: vi.fn(),
  channel: vi.fn(),
  schedule: vi.fn(),
  presented: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("@/hooks/use-settings", () => ({ loadAppSettingsFromStorage: mocks.load }));
vi.mock("expo-notifications", () => ({
  getPermissionsAsync: mocks.permissions,
  requestPermissionsAsync: mocks.request,
  setNotificationChannelAsync: mocks.channel,
  scheduleNotificationAsync: mocks.schedule,
  getPresentedNotificationsAsync: mocks.presented,
  dismissNotificationAsync: mocks.dismiss,
  AndroidImportance: { HIGH: 4 },
  AndroidNotificationVisibility: { PRIVATE: 0 },
}));
import {
  dismissAndroidSessionNotifications,
  requestAndroidNotificationPermission,
  sendAndroidNotification,
} from "./android-notifications";

describe("Android local notifications", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.load.mockResolvedValue({ backgroundNotificationsEnabled: true });
    mocks.permissions.mockResolvedValue({ granted: true, canAskAgain: true });
    mocks.presented.mockResolvedValue([]);
    mocks.dismiss.mockResolvedValue(undefined);
  });
  it("sends a sounding local notification with its navigation target", async () => {
    const payload = { title: "Done", data: { serverId: "s", agentId: "a" } };
    expect(await sendAndroidNotification(payload)).toBe(true);
    expect(mocks.schedule).toHaveBeenCalledWith({
      content: { ...payload, sound: "default" },
      trigger: { channelId: "paseodog-completion" },
    });
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("does not notify when disabled", async () => {
    mocks.load.mockResolvedValue({ backgroundNotificationsEnabled: false });
    expect(await sendAndroidNotification({ title: "Done" })).toBe(false);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it("does not prompt for denied permission in the background", async () => {
    mocks.permissions.mockResolvedValue({ granted: false, canAskAgain: true });
    expect(await sendAndroidNotification({ title: "Done" })).toBe(false);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it("creates a sounding channel before requesting permission", async () => {
    mocks.permissions.mockResolvedValue({ granted: false, canAskAgain: true });
    mocks.request.mockResolvedValue({ granted: true });
    expect(await requestAndroidNotificationPermission()).toBe(true);
    expect(mocks.channel).toHaveBeenCalledWith(
      "paseodog-completion",
      expect.objectContaining({
        importance: 4,
        sound: "default",
        enableVibrate: true,
      }),
    );
    expect(mocks.channel.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.request.mock.invocationCallOrder[0],
    );
  });
  it("does not ask again when Android forbids it", async () => {
    mocks.permissions.mockResolvedValue({ granted: false, canAskAgain: false });
    expect(await requestAndroidNotificationPermission()).toBe(false);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("dismisses every notification for the viewed session, preserving other sessions and hosts", async () => {
    const notification = (identifier: string, data: Record<string, unknown> | null) => ({
      request: { identifier, content: { data } },
    });
    mocks.presented.mockResolvedValue([
      notification("finished", { serverId: "host", agentId: "agent" }),
      notification("permission", { serverId: "host", agentId: "agent" }),
      notification("other-session", { serverId: "host", agentId: "other" }),
      notification("other-host", { serverId: "other", agentId: "agent" }),
      notification("terminal", { serverId: "host", terminalId: "terminal" }),
      notification("background-service", null),
      notification("test", {}),
      notification("missing-host", { agentId: "agent" }),
    ]);

    await dismissAndroidSessionNotifications("host", "agent");

    expect(mocks.dismiss.mock.calls).toEqual([["finished"], ["permission"]]);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("can clear existing notifications even after notifications are disabled", async () => {
    mocks.load.mockResolvedValue({ backgroundNotificationsEnabled: false });
    mocks.permissions.mockResolvedValue({ granted: false });
    mocks.presented.mockResolvedValue([
      { request: { identifier: "old", content: { data: { serverId: "s", agentId: "a" } } } },
    ]);

    await dismissAndroidSessionNotifications("s", "a");

    expect(mocks.dismiss).toHaveBeenCalledWith("old");
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.permissions).not.toHaveBeenCalled();
  });

  it("leaves an empty notification tray unchanged", async () => {
    await dismissAndroidSessionNotifications("host", "agent");
    expect(mocks.dismiss).not.toHaveBeenCalled();
  });

  it("propagates dismissal failures to the caller", async () => {
    mocks.presented.mockRejectedValue(new Error("tray unavailable"));
    await expect(dismissAndroidSessionNotifications("s", "a")).rejects.toThrow("tray unavailable");
  });
});

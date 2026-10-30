import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  permissions: vi.fn(),
  request: vi.fn(),
  channel: vi.fn(),
  schedule: vi.fn(),
  presented: vi.fn(),
  dismiss: vi.fn(),
  appState: "background",
  sessions: {} as Record<
    string,
    { focusedAgentId: string | null; focusedTerminalId: string | null }
  >,
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return mocks.appState;
    },
  },
}));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: { getState: () => ({ sessions: mocks.sessions }) },
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
  shouldPresentAndroidNotification,
} from "./android-notifications";

describe("Android local notifications", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.load.mockResolvedValue({ backgroundNotificationsEnabled: true });
    mocks.permissions.mockResolvedValue({ granted: true, canAskAgain: true });
    mocks.presented.mockResolvedValue([]);
    mocks.dismiss.mockResolvedValue(undefined);
    mocks.appState = "background";
    mocks.sessions = {};
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
  it("suppresses remote presentation after opt-out", async () => {
    mocks.load.mockResolvedValue({ backgroundNotificationsEnabled: false });
    expect(await shouldPresentAndroidNotification({ serverId: "s", agentId: "a" })).toBe(false);
  });
  it("suppresses delayed push for the currently viewed session but not home-screen delivery", async () => {
    mocks.sessions = { s: { focusedAgentId: "a", focusedTerminalId: null } };
    const data = { serverId: "s", agentId: "a" };
    expect(await shouldPresentAndroidNotification(data)).toBe(true);
    mocks.appState = "active";
    expect(await shouldPresentAndroidNotification(data)).toBe(false);
    expect(await shouldPresentAndroidNotification({ serverId: "s", agentId: "other" })).toBe(true);
    expect(await shouldPresentAndroidNotification({ serverId: "other", agentId: "a" })).toBe(true);
  });
  it("suppresses delayed push for the currently viewed terminal", async () => {
    mocks.appState = "active";
    mocks.sessions = { s: { focusedAgentId: null, focusedTerminalId: "t" } };
    expect(await shouldPresentAndroidNotification({ serverId: "s", terminalId: "t" })).toBe(false);
    expect(await shouldPresentAndroidNotification({})).toBe(true);
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

  it("dismisses background FCM notifications by session tag when Android drops custom data", async () => {
    const own =
      "expo-notifications://foreign_notifications?tag=paseodog-session%3A%5B%22host%22%2C%22agent%22%5D&id=0";
    const notification = (identifier: string, data: Record<string, unknown> = {}) => ({
      request: { identifier, trigger: null, content: { data, title: "Agent finished" } },
    });
    mocks.presented.mockResolvedValue([
      notification(own, { "android.title": "Agent finished", "android.text": "Done" }),
      notification(
        "expo-notifications://foreign_notifications?tag=paseodog-session%3A%5B%22host%22%2C%22other%22%5D&id=0",
      ),
      notification(
        "expo-notifications://foreign_notifications?tag=paseodog-session%3A%5B%22other%22%2C%22agent%22%5D&id=0",
      ),
      notification("expo-notifications://foreign_notifications?tag=FCM-Notification%3A123&id=0"),
      notification("foreground-service"),
    ]);

    await dismissAndroidSessionNotifications("host", "agent");

    expect(mocks.dismiss.mock.calls).toEqual([[own]]);
  });

  it("does not use a tag to override conflicting data or match malformed identifiers", async () => {
    const own =
      "expo-notifications://foreign_notifications?tag=paseodog-session%3A%5B%22host%22%2C%22agent%22%5D&id=0";
    mocks.presented.mockResolvedValue([
      { request: { identifier: own, content: { data: { serverId: "other", agentId: "agent" } } } },
      {
        request: {
          identifier: own.replace("expo-notifications:", "https:"),
          content: { data: {} },
        },
      },
      { request: { identifier: "not a URL", content: { data: {} } } },
    ]);
    await dismissAndroidSessionNotifications("host", "agent");
    expect(mocks.dismiss).not.toHaveBeenCalled();
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

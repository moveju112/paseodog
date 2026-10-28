import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  permissions: vi.fn(),
  request: vi.fn(),
  channel: vi.fn(),
  schedule: vi.fn(),
}));
vi.mock("@/hooks/use-settings", () => ({ loadAppSettingsFromStorage: mocks.load }));
vi.mock("expo-notifications", () => ({
  getPermissionsAsync: mocks.permissions,
  requestPermissionsAsync: mocks.request,
  setNotificationChannelAsync: mocks.channel,
  scheduleNotificationAsync: mocks.schedule,
  AndroidImportance: { HIGH: 4 },
  AndroidNotificationVisibility: { PRIVATE: 0 },
}));
import {
  requestAndroidNotificationPermission,
  sendAndroidNotification,
} from "./android-notifications";

describe("Android local notifications", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.load.mockResolvedValue({ backgroundNotificationsEnabled: true });
    mocks.permissions.mockResolvedValue({ granted: true, canAskAgain: true });
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
});

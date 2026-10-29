import { expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { createFakeDesktopBridge, createInMemoryKeyValueStorage } from "./fakes";
import { loadAppSettingsFromStorage, normalizeAppSettings, saveAppSettings } from "./storage";

it("defaults background notifications off and persists explicit opt-in", async () => {
  expect(normalizeAppSettings({}).backgroundNotificationsEnabled).toBe(false);
  expect(
    normalizeAppSettings({ backgroundNotificationsEnabled: "true" }).backgroundNotificationsEnabled,
  ).toBe(false);
  const deps = {
    storage: createInMemoryKeyValueStorage(),
    desktop: createFakeDesktopBridge(),
  };
  const queryClient = new QueryClient();
  await saveAppSettings({ queryClient, updates: { backgroundNotificationsEnabled: true }, deps });
  expect((await loadAppSettingsFromStorage(deps)).backgroundNotificationsEnabled).toBe(true);
  await saveAppSettings({ queryClient, updates: { backgroundNotificationsEnabled: false }, deps });
  expect((await loadAppSettingsFromStorage(deps)).backgroundNotificationsEnabled).toBe(false);
  queryClient.clear();
});

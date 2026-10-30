import { beforeEach, expect, it, vi } from "vitest";
import type { StartPushNotificationsInput } from "./types";

const mocks = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  projectId: "project",
  permission: vi.fn(),
  token: vi.fn(),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => mocks.storage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      mocks.storage.set(key, value);
    },
    removeItem: async (key: string) => {
      mocks.storage.delete(key);
    },
  },
}));
vi.mock("expo-constants", () => ({
  default: {
    get easConfig() {
      return { projectId: mocks.projectId };
    },
  },
}));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("@/utils/android-notifications", () => ({
  requestAndroidNotificationPermission: mocks.permission,
}));
vi.mock("expo-notifications", () => ({ getExpoPushTokenAsync: mocks.token }));

import { revokeSubscription, startSubscription } from "./subscriptions";

const key = "@paseo:expo-push-token:host";

function client() {
  let listener = (_state: { status: string }) => {};
  const connection = {
    isConnected: true,
    registerPushToken: vi.fn(),
    unregisterPushToken: vi.fn().mockResolvedValue(undefined),
    getLastServerInfoMessage: () => ({ features: { pushTokenRevocation: true } }),
    subscribeConnectionStatus: vi.fn((callback: typeof listener) => {
      listener = callback;
      return vi.fn();
    }),
  };
  return {
    connection,
    input: {
      client: connection,
      serverId: "host",
      enabled: true,
    } as unknown as StartPushNotificationsInput,
    reconnect: () => {
      connection.isConnected = true;
      listener({ status: "connected" });
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.storage.clear();
  mocks.projectId = "project";
  mocks.permission.mockResolvedValue(true);
  mocks.token.mockResolvedValue({ data: "ExponentPushToken[test]" });
});

it("registers and renews the project token on reconnect", async () => {
  const c = client();
  const stop = startSubscription(c.input);
  await vi.waitFor(() =>
    expect(c.connection.registerPushToken).toHaveBeenCalledWith("ExponentPushToken[test]"),
  );
  expect(mocks.token).toHaveBeenCalledWith({ projectId: "project" });
  expect(mocks.storage.get(key)).toBe("ExponentPushToken[test]");
  c.reconnect();
  expect(c.connection.registerPushToken).toHaveBeenCalledTimes(2);
  stop();
  c.reconnect();
  expect(c.connection.registerPushToken).toHaveBeenCalledTimes(2);
});

it("retries token acquisition after a failed network request on reconnect", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.token.mockRejectedValueOnce(new Error("offline"));
  const c = client();
  const stop = startSubscription(c.input);
  await vi.waitFor(() => expect(warn).toHaveBeenCalled());
  c.reconnect();
  await vi.waitFor(() => expect(c.connection.registerPushToken).toHaveBeenCalledOnce());
  stop();
  warn.mockRestore();
});

it("does not persist or register a token after opt-out during acquisition", async () => {
  let finish!: (value: { data: string }) => void;
  mocks.token.mockReturnValue(new Promise((resolve) => (finish = resolve)));
  const c = client();
  const stop = startSubscription(c.input);
  await vi.waitFor(() => expect(mocks.token).toHaveBeenCalledOnce());
  stop();
  finish({ data: "ExponentPushToken[late]" });
  await Promise.resolve();
  await Promise.resolve();
  expect(mocks.storage.has(key)).toBe(false);
  expect(c.connection.registerPushToken).not.toHaveBeenCalled();
});

it("retains an offline opt-out token until server revocation is acknowledged", async () => {
  const c = client();
  mocks.storage.set(key, "ExponentPushToken[old]");
  c.connection.isConnected = false;
  await revokeSubscription(c.input);
  expect(mocks.storage.has(key)).toBe(true);
  expect(c.connection.unregisterPushToken).not.toHaveBeenCalled();
  c.connection.isConnected = true;
  await revokeSubscription(c.input);
  expect(c.connection.unregisterPushToken).toHaveBeenCalledWith("ExponentPushToken[old]");
  expect(mocks.storage.has(key)).toBe(false);
});

it("retains the token after a failed revocation for the next reconnect", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const c = client();
  mocks.storage.set(key, "ExponentPushToken[old]");
  c.connection.unregisterPushToken.mockRejectedValueOnce(new Error("disconnected"));
  await revokeSubscription(c.input);
  expect(mocks.storage.has(key)).toBe(true);
  await revokeSubscription(c.input);
  expect(mocks.storage.has(key)).toBe(false);
  warn.mockRestore();
});

it("revokes the existing server token when Android permission is denied", async () => {
  mocks.permission.mockResolvedValue(false);
  mocks.storage.set(key, "ExponentPushToken[old]");
  const c = client();
  const stop = startSubscription(c.input);
  await vi.waitFor(() => expect(c.connection.unregisterPushToken).toHaveBeenCalledOnce());
  expect(mocks.token).not.toHaveBeenCalled();
  expect(c.connection.registerPushToken).not.toHaveBeenCalled();
  stop();
});

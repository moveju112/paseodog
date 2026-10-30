import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  platform: "android",
  start: vi.fn(),
  revoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return mocks.platform;
    },
  },
}));
vi.mock("./internal/subscriptions", () => ({
  startSubscription: mocks.start,
  revokeSubscription: mocks.revoke,
}));
import type { StartPushNotificationsInput } from "./internal/types";
import { startPushNotifications } from "./index.native";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.platform = "android";
});

it("registers Android remote push when explicitly enabled", () => {
  const stop = vi.fn();
  mocks.start.mockReturnValue(stop);
  const input = { serverId: "host", enabled: true } as StartPushNotificationsInput;
  expect(startPushNotifications(input)).toBe(stop);
  expect(mocks.start).toHaveBeenCalledWith(input);
  expect(mocks.revoke).not.toHaveBeenCalled();
});

it("revokes disabled Android subscriptions immediately and on reconnect", () => {
  const stop = vi.fn();
  const subscribe = vi.fn((_listener: (state: { status: string }) => void) => stop);
  const input = {
    serverId: "host",
    enabled: false,
    client: { isConnected: true, subscribeConnectionStatus: subscribe },
  } as unknown as StartPushNotificationsInput;
  expect(startPushNotifications(input)).toBe(stop);
  expect(mocks.start).not.toHaveBeenCalled();
  expect(mocks.revoke).toHaveBeenCalledWith(input);
  subscribe.mock.calls[0][0]({ status: "connected" });
  expect(mocks.revoke).toHaveBeenCalledTimes(2);
});

it("retains iOS push delivery", () => {
  mocks.platform = "ios";
  const input = { serverId: "host" } as StartPushNotificationsInput;
  startPushNotifications(input);
  expect(mocks.start).toHaveBeenCalledWith(input);
  expect(mocks.revoke).not.toHaveBeenCalled();
});

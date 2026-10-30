import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type pino from "pino";
import { PushService } from "./push-service.js";
import { createStub } from "../test-utils/class-mocks.js";

const fetchMock = vi.fn();
const error = vi.fn();
const revoke = vi.fn();
let service: PushService;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  const logger = createStub<pino.Logger>({
    child: () => logger,
    error,
  });
  service = new PushService(logger, revoke);
});
afterEach(() => vi.unstubAllGlobals());

it("sends sounding high-priority Android push on the configured channel", async () => {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ data: [{ status: "ok", id: "receipt" }] }),
  });
  await service.sendPush(["ExponentPushToken[test]"], {
    title: "Done",
    body: "Completed",
    data: { agentId: "agent" },
  });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual([
    {
      to: "ExponentPushToken[test]",
      title: "Done",
      body: "Completed",
      data: { agentId: "agent" },
      sound: "default",
      channelId: "paseodog-completion",
      priority: "high",
    },
  ]);
});

it.each(["InvalidCredentials", "DeviceNotRegistered"])(
  "handles %s without exposing tokens or dropping recoverable registrations",
  async (failure) => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            status: "error",
            message: "Recipient ExponentPushToken[test] rejected",
            details: { error: failure },
          },
        ],
      }),
    });
    await service.sendPush(["ExponentPushToken[test]"], { title: "Done", body: "Completed" });
    expect(error).toHaveBeenCalledWith({ error: failure }, "Push delivery rejected");
    expect(JSON.stringify(error.mock.calls)).not.toContain("ExponentPushToken");
    if (failure === "DeviceNotRegistered") {
      expect(revoke).toHaveBeenCalledWith("ExponentPushToken[test]");
    } else {
      expect(revoke).not.toHaveBeenCalled();
    }
  },
);

it("preserves session identity in the Android tag even when background notification data is unavailable", async () => {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ data: [{ status: "ok", id: "receipt" }] }),
  });
  await service.sendPush(["ExponentPushToken[test]"], {
    title: "Done",
    body: "Completed",
    data: { serverId: "host", agentId: "agent", reason: "finished" },
  });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)[0]).toMatchObject({
    tag: 'paseodog-session:["host","agent"]',
    data: { serverId: "host", agentId: "agent", reason: "finished" },
  });
});

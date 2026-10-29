import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  platform: "android",
  fdroid: false,
  register: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  wait: vi.fn(),
}));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return mocks.platform;
    },
  },
  AppRegistry: { registerHeadlessTask: mocks.register },
}));
vi.mock("@/constants/build-profile", () => ({
  get isFdroidBuild() {
    return mocks.fdroid;
  },
}));
vi.mock("expo-modules-core", () => ({
  requireNativeModule: () => ({
    start: mocks.start,
    stop: mocks.stop,
    waitUntilStopped: mocks.wait,
  }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.platform = "android";
  mocks.fdroid = false;
});

it("keeps the headless task alive exactly until its native service generation stops", async () => {
  let stop!: () => void;
  mocks.wait.mockReturnValue(
    new Promise<void>((resolve) => {
      stop = resolve;
    }),
  );
  const service = await import("./android-background-service");
  expect(mocks.register).toHaveBeenCalledWith(
    "PaseodogBackgroundNotifications",
    expect.any(Function),
  );
  const task = mocks.register.mock.calls[0][1]();
  const finished = vi.fn();
  const pending = task({ generation: "run-1" }).then(finished);
  await service.startAndroidBackgroundService();
  expect(mocks.start).toHaveBeenCalledOnce();
  expect(mocks.wait).toHaveBeenCalledWith("run-1");
  expect(finished).not.toHaveBeenCalled();
  await service.stopAndroidBackgroundService();
  expect(mocks.stop).toHaveBeenCalledOnce();
  stop();
  await pending;
  expect(finished).toHaveBeenCalledOnce();
});

it.each(["ios", "web", "fdroid"])("does not register a headless task on %s", async (platform) => {
  mocks.platform = platform === "fdroid" ? "android" : platform;
  mocks.fdroid = platform === "fdroid";
  await import("./android-background-service");
  expect(mocks.register).not.toHaveBeenCalled();
});

it("propagates native start failures to the lifecycle owner", async () => {
  mocks.start.mockRejectedValue(new Error("not allowed"));
  const service = await import("./android-background-service");
  await expect(service.startAndroidBackgroundService()).rejects.toThrow("not allowed");
});

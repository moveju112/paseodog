import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import { channel, tracingChannel } from "./diagnostics-channel";

const appRequire = createRequire(import.meta.url);

describe("diagnostics_channel shim", () => {
  it("resolves node:diagnostics_channel to the shim on every platform", () => {
    const metroConfig = appRequire("../../metro.config.cjs");
    const shimPath = appRequire.resolve("./diagnostics-channel.ts");
    for (const moduleName of ["node:diagnostics_channel", "diagnostics_channel"]) {
      for (const platform of ["web", "android", "ios"]) {
        expect(
          metroConfig.resolver.resolveRequest({ originModulePath: shimPath }, moduleName, platform),
        ).toEqual({ type: "sourceFile", filePath: shimPath });
      }
    }
    // expo/metro-config 첫 로드가 릴리즈 병렬 검증에서 5초를 넘는다.
  }, 30_000);

  it("acts as channels without subscribers", async () => {
    const metrics = channel("lru-cache:metrics");
    expect(metrics.hasSubscribers).toBe(false);
    expect(() => metrics.publish({ op: "get" })).not.toThrow();

    const tracing = tracingChannel("lru-cache");
    expect(tracing.hasSubscribers).toBe(false);
    await expect(tracing.tracePromise(async () => "value", {})).resolves.toBe("value");
  });
});

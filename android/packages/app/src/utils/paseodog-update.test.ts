import { describe, expect, it } from "vitest";
import { parseAndroidUpdate } from "./paseodog-update";

const update = {
  versionCode: 11006,
  versionName: "0.11.4-paseodog.2",
  url: "https://github.com/moveju112/paseodog/releases/download/android-v0.11.4-2/PaseoDog-0.11.4-updater.apk",
  sha256: "a".repeat(64),
};

describe("Android update policy", () => {
  it("accepts a newer build from the exact repository", () => {
    expect(parseAndroidUpdate(update, 11005)).toEqual(update);
  });
  it.each([11006, 11007])("does not reinstall or downgrade build %s", (installed) => {
    expect(parseAndroidUpdate(update, installed)).toBeNull();
  });
  it.each([
    null, {}, { ...update, versionCode: 1.5 }, { ...update, versionCode: "11006" },
    { ...update, sha256: "bad" }, { ...update, url: update.url.replace("https:", "http:") },
    { ...update, url: update.url.replace("moveju112", "attacker") },
    { ...update, url: update.url + "?redirect=evil" },
  ])("rejects malformed or untrusted metadata", (value) => {
    expect(() => parseAndroidUpdate(value, 11005)).toThrow();
  });
  it("selects the device's preferred ABI and reports its actual download size", () => {
    const arm = { abi: "arm64-v8a", url: update.url.replace("updater.apk", "arm64-v8a.apk"), sha256: "b".repeat(64), size: 12345 };
    const x64 = { abi: "x86_64", url: update.url.replace("updater.apk", "x86_64.apk"), sha256: "c".repeat(64), size: 23456 };
    const manifest = { ...update, size: 99999, artifacts: [x64, arm] };
    expect(parseAndroidUpdate(manifest, 11005, ["arm64-v8a", "armeabi-v7a"])).toEqual({
      versionCode: update.versionCode, versionName: update.versionName, ...arm,
    });
    expect(parseAndroidUpdate(manifest, 11005)).toMatchObject({ url: update.url, size: 99999 });
    expect(() => parseAndroidUpdate(manifest, 11005, ["x86"])).toThrow();
    expect(parseAndroidUpdate(manifest, 11006, ["arm64-v8a"])).toBeNull();
  });
  it("validates every split and rejects duplicate ABIs, bad URLs and invalid sizes", () => {
    const artifact = { abi: "arm64-v8a", url: update.url, sha256: update.sha256, size: 100 };
    for (const artifacts of [[], [artifact, artifact], [{ ...artifact, size: -1 }],
      [{ ...artifact, url: "https://attacker.test/update.apk" }], [{ ...artifact, abi: "unknown" }]]) {
      expect(() => parseAndroidUpdate({ ...update, artifacts }, 11005, ["arm64-v8a"])).toThrow();
    }
  });
});

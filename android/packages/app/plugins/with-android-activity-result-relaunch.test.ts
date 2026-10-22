import { describe, expect, it } from "vitest";

const { configureActivityResultRelaunch } = require("./with-android-activity-result-relaunch");

// 이전 MainActivity 우회 제거와 사용자 코드 보존을 확인한다.
describe("withAndroidActivityResultRelaunch", () => {
  const source = [
    "class MainActivity : ReactActivity() {",
    "  override fun onCreate(savedInstanceState: Bundle?) {",
    "    SplashScreenManager.registerOnActivity(this)",
    "    super.onCreate(null)",
    "  }",
    "",
    '  override fun getMainComponentName(): String = "main"',
    "}",
  ].join("\n");

  it("leaves a fresh Activity and unrelated overrides unchanged", () => {
    expect(configureActivityResultRelaunch(source)).toBe(source);
    const custom = `${source}\n  override fun onDestroy() { customCleanup() }`;
    expect(configureActivityResultRelaunch(custom)).toBe(custom);
  });

  it("removes the obsolete forced host destruction idempotently", () => {
    const legacy = [
      "",
      "  // PASEODOG_ACTIVITY_RESULT_RELAUNCH: expo onDestroy is asynchronous, so a configuration relaunch can resume",
      "  // the new Activity before the React host hears about the old one. Notify synchronously so",
      "  // expo-modules-core re-registers activity result contracts (image picker) for the new Activity.",
      "  override fun onDestroy() {",
      "    if (isChangingConfigurations) {",
      "      reactHost?.onHostDestroy(this)",
      "    }",
      "    super.onDestroy()",
      "  }",
      "",
    ].join("\n");
    expect(configureActivityResultRelaunch(source + legacy)).toBe(source);
    expect(configureActivityResultRelaunch(configureActivityResultRelaunch(source + legacy))).toBe(source);
  });

  it("rejects a modified legacy override instead of removing unknown code", () => {
    expect(() => configureActivityResultRelaunch(`${source}\n// PASEODOG_ACTIVITY_RESULT_RELAUNCH`)).toThrow(
      "Unexpected legacy",
    );
  });
});

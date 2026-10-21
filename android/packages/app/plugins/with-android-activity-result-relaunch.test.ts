import { describe, expect, it } from "vitest";

const { configureActivityResultRelaunch } = require("./with-android-activity-result-relaunch");

// 재생성 보정 주입의 위치·멱등성·드리프트 거부 확인
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

  it("notifies the React host synchronously on configuration relaunch", () => {
    const configured = configureActivityResultRelaunch(source);

    expect(configured).toContain(
      "    super.onCreate(null)\n  }\n\n  // PASEODOG_ACTIVITY_RESULT_RELAUNCH",
    );
    expect(configured).toContain(
      "    if (isChangingConfigurations) {\n      reactHost?.onHostDestroy(this)\n    }\n    super.onDestroy()",
    );
    expect(configureActivityResultRelaunch(configured)).toBe(configured);
  });

  it("refuses to patch an unexpected MainActivity", () => {
    expect(() => configureActivityResultRelaunch("class MainActivity")).toThrow();
    expect(() =>
      configureActivityResultRelaunch(`${source}\n  override fun onDestroy() {}`),
    ).toThrow();
  });
});

const { withMainActivity } = require("expo/config-plugins");

const PATCH_MARKER = "PASEODOG_ACTIVITY_RESULT_RELAUNCH";
const ON_CREATE_END = "    super.onCreate(null)\n  }\n";
const ON_DESTROY_OVERRIDE = [
  "",
  `  // ${PATCH_MARKER}: expo onDestroy is asynchronous, so a configuration relaunch can resume`,
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

// 설정 변경 재생성 시 React 호스트 파괴를 동기 통지하는 onDestroy 주입 (MainActivity -> onDestroy)
function configureActivityResultRelaunch(contents) {
  if (contents.includes(PATCH_MARKER)) {
    return contents;
  }
  const at = contents.indexOf(ON_CREATE_END);
  if (at < 0 || contents.indexOf(ON_CREATE_END, at + 1) !== -1) {
    throw new Error("Could not find a single MainActivity onCreate end for the relaunch fix");
  }
  if (contents.includes("override fun onDestroy(")) {
    throw new Error("MainActivity already overrides onDestroy; merge the relaunch fix manually");
  }
  const insertAt = at + ON_CREATE_END.length;
  return contents.slice(0, insertAt) + ON_DESTROY_OVERRIDE + contents.slice(insertAt);
}

// Kotlin MainActivity에만 재생성 보정 적용 (config -> MainActivity.kt)
function withAndroidActivityResultRelaunch(config) {
  return withMainActivity(config, (modConfig) => {
    if (modConfig.modResults.language !== "kt") {
      throw new Error("Activity result relaunch fix requires a Kotlin MainActivity");
    }
    modConfig.modResults.contents = configureActivityResultRelaunch(modConfig.modResults.contents);
    return modConfig;
  });
}

module.exports = withAndroidActivityResultRelaunch;
module.exports.configureActivityResultRelaunch = configureActivityResultRelaunch;

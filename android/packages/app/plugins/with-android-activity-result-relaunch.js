const { withDangerousMod, withMainActivity } = require("expo/config-plugins");
const { dirname, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const PATCH_MARKER = "PASEODOG_ACTIVITY_RESULT_RELAUNCH";
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

// 이전 우회 코드는 제거하고 Expo 내부의 Activity 등록 순서를 직접 보정한다.
function configureActivityResultRelaunch(contents) {
  if (contents.includes(PATCH_MARKER) && !contents.includes(ON_DESTROY_OVERRIDE)) {
    throw new Error("Unexpected legacy Activity result relaunch patch");
  }
  return contents.replace(ON_DESTROY_OVERRIDE, "");
}

// prebuild마다 버전·해시 검증 패치를 적용하고 기존 MainActivity 우회를 제거한다.
function withAndroidActivityResultRelaunch(config) {
  config = withMainActivity(config, (modConfig) => {
    if (modConfig.modResults.language !== "kt") {
      throw new Error("Activity result relaunch fix requires a Kotlin MainActivity");
    }
    modConfig.modResults.contents = configureActivityResultRelaunch(modConfig.modResults.contents);
    return modConfig;
  });
  return withDangerousMod(config, [
    "android",
    async (modConfig) => {
      const { patchExpoActivityResult } = await import(
        pathToFileURL(resolve(__dirname, "../../../../scripts/patch-expo-activity-result.mjs")).href
      );
      patchExpoActivityResult(
        dirname(require.resolve("expo-modules-core/package.json", {
          paths: [modConfig.modRequest.projectRoot],
        })),
      );
      return modConfig;
    },
  ]);
}

module.exports = withAndroidActivityResultRelaunch;
module.exports.configureActivityResultRelaunch = configureActivityResultRelaunch;

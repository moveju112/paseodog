const { withAppBuildGradle } = require("expo/config-plugins");

const VERSION_CODE_LINE = /^(\s*)versionCode (\d+)$/m;

// 릴리즈 versionCode를 Gradle 속성으로 덮어쓰게 변환 (versionCode N -> -PpaseodogVersionCode 우선)
function configureVersionCodeOverride(contents) {
  if (contents.includes("paseodogVersionCode")) {
    return contents;
  }
  if (!VERSION_CODE_LINE.test(contents)) {
    throw new Error("Could not find a literal versionCode in app/build.gradle");
  }
  return contents.replace(
    VERSION_CODE_LINE,
    (_, indent, code) =>
      `${indent}versionCode Integer.parseInt((findProperty('paseodogVersionCode') ?: '${code}').toString())`,
  );
}

// prebuild 시 app/build.gradle에 versionCode 덮어쓰기 적용
function withAndroidVersionCode(config) {
  return withAppBuildGradle(config, (modConfig) => {
    if (modConfig.modResults.language !== "groovy") {
      throw new Error("versionCode override requires a Groovy app/build.gradle");
    }
    modConfig.modResults.contents = configureVersionCodeOverride(modConfig.modResults.contents);
    return modConfig;
  });
}

module.exports = withAndroidVersionCode;
module.exports.configureVersionCodeOverride = configureVersionCodeOverride;

const { withAppBuildGradle } = require("expo/config-plugins");

const marker = "// PaseoDog architecture-specific APKs";
const splits = `
    ${marker}
    splits {
        abi {
            enable true
            reset()
            include(*(project.findProperty("reactNativeArchitectures") ?: "armeabi-v7a,arm64-v8a,x86,x86_64").split(","))
            // 구버전 업데이터는 통합 APK만 이해하므로 호환용으로 유지한다.
            universalApk true
        }
    }
`;

function addApkSplits(source) {
  if (source.includes(marker)) return source;
  const anchor = "android {";
  if (source.split(anchor).length !== 2) throw new Error("Android Gradle anchor mismatch");
  return source.replace(anchor, anchor + splits);
}

module.exports = function withAndroidApkSplits(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== "groovy") throw new Error("Groovy Gradle required");
    mod.modResults.contents = addApkSplits(mod.modResults.contents);
    return mod;
  });
};
module.exports.addApkSplits = addApkSplits;

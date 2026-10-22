const { withAppBuildGradle } = require("expo/config-plugins");

const original =
  'cliFile = new File(["node", "--print", "require.resolve(\'@expo/cli\', { paths: [require.resolve(\'expo/package.json\')] })"].execute(null, rootDir).text.trim())';
const replacement = 'cliFile = file("../../scripts/expo-bundle.cjs")';

// Expo CLI 진입점만 교체하고 Gradle·Hermes의 입력 검증과 릴리즈 최적화는 유지한다.
function configureBundleCache(contents) {
  if (contents.includes(replacement)) return contents;
  if (contents.split(original).length !== 2) {
    throw new Error("Expected one Expo cliFile in app/build.gradle");
  }
  return contents.replace(original, replacement);
}

// prebuild가 생성한 네이티브 프로젝트에도 같은 캐시 정책을 적용한다.
function withAndroidBundleCache(config) {
  return withAppBuildGradle(config, (modConfig) => {
    if (modConfig.modResults.language !== "groovy") {
      throw new Error("Bundle cache requires a Groovy app/build.gradle");
    }
    modConfig.modResults.contents = configureBundleCache(modConfig.modResults.contents);
    return modConfig;
  });
}

module.exports = withAndroidBundleCache;
module.exports.configureBundleCache = configureBundleCache;

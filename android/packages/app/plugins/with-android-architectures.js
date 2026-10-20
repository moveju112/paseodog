const { withGradleProperties } = require("expo/config-plugins");

const ARCHITECTURES_PROPERTY = "reactNativeArchitectures";
// PaseoDog 기본 빌드 대상은 Galaxy S25 하나다. 다른 ABI는 gradle -PreactNativeArchitectures로 넓힌다.
const DEFAULT_ARCHITECTURES = "arm64-v8a";

// gradle.properties 기본 ABI 고정 (prebuild 템플릿의 4개 ABI -> S25 arm64-v8a)
function setReactNativeArchitectures(properties) {
  const existingProperty = properties.find(
    (property) => property.type === "property" && property.key === ARCHITECTURES_PROPERTY,
  );
  if (existingProperty) {
    existingProperty.value = DEFAULT_ARCHITECTURES;
    return properties;
  }
  properties.push({ type: "property", key: ARCHITECTURES_PROPERTY, value: DEFAULT_ARCHITECTURES });
  return properties;
}

// prebuild 시 gradle.properties에 기본 ABI 적용
function withAndroidArchitectures(config) {
  return withGradleProperties(config, (modConfig) => {
    setReactNativeArchitectures(modConfig.modResults);
    return modConfig;
  });
}

module.exports = withAndroidArchitectures;
module.exports.setReactNativeArchitectures = setReactNativeArchitectures;

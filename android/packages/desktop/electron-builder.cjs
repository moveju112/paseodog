const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const config = yaml.load(fs.readFileSync(path.join(__dirname, "electron-builder.yml"), "utf8"));

// 플랫폼별 제외 규칙이 별도 복사 작업으로 확장되지 않게 공통 필터와 한 번에 정규화한다.
for (const platform of ["mac", "linux", "win"]) {
  config[platform].files = [...config.files, ...(config[platform].files ?? [])];
}
delete config.files;

module.exports = config;

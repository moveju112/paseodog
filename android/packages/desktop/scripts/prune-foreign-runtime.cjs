const fs = require("node:fs");
const path = require("node:path");

// 패키징된 의존성 중 대상 OS/CPU에서 로드할 수 없는 네이티브 파일만 제외한다.
function foreignRuntimePackages(names, platform, arch) {
  const supported = /^(linux|darwin|win32)-(x64|arm64|ia32|arm)$/;
  if (!supported.test(`${platform}-${arch}`)) throw new Error("Unsupported package target");
  return names.filter((name) => {
    const match = /^sherpa-onnx-(linux|darwin|win)-(x64|arm64|ia32|arm)$/.exec(name);
    const target = platform === "win32" ? "win" : platform;
    return match && (match[1] !== target || match[2] !== arch);
  });
}

function pruneForeignRuntime(nodeModules, platform, arch) {
  for (const name of foreignRuntimePackages(fs.readdirSync(nodeModules), platform, arch))
    fs.rmSync(path.join(nodeModules, name), { recursive: true });
}

module.exports = { foreignRuntimePackages, pruneForeignRuntime };

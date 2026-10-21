import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./is-main-module.mjs";

const require = createRequire(import.meta.url);
const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsRoot, "..");

// 컴파일 출력의 경로와 바이트를 기록해 누락·외부 수정·오래된 파일을 검출한다.
function outputHashes(directory, root = directory) {
  if (!existsSync(directory)) return {};
  const result = {};
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      Object.assign(result, outputHashes(path, root));
    } else if (entry.isFile()) {
      result[relative(root, path)] = createHash("sha256").update(readFileSync(path)).digest("hex");
    } else {
      throw new Error(`Unsupported compiler output: ${path}`);
    }
  }
  return result;
}

// 깨진 생성 캐시는 무효화하되 실제 파일 접근 오류는 그대로 전달한다.
function readReceipt(receiptPath) {
  if (!existsSync(receiptPath)) return undefined;
  try {
    return JSON.parse(readFileSync(receiptPath, "utf8"));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return undefined;
  }
}

// 여러 tsconfig의 출력도 패키지 dist 안으로 제한하고 소스 목록을 함께 계산한다.
function parseConfigs(packageRoot, compilerPath, names) {
  const typescript = createRequire(compilerPath)("typescript");
  return names.map((name) => {
    if (basename(name) !== name || !name.endsWith(".json")) {
      throw new Error(`Expected package-local tsconfig: ${name}`);
    }
    const configPath = join(packageRoot, name);
    const config = typescript.readConfigFile(configPath, typescript.sys.readFile);
    if (config.error) {
      throw new Error(typescript.flattenDiagnosticMessageText(config.error.messageText, "\n"));
    }
    const parsed = typescript.parseJsonConfigFileContent(
      config.config,
      typescript.sys,
      packageRoot,
      undefined,
      configPath,
    );
    if (parsed.errors.length) {
      throw new Error(
        parsed.errors
          .map((error) => typescript.flattenDiagnosticMessageText(error.messageText, "\n"))
          .join("\n"),
      );
    }
    const output = relative(join(packageRoot, "dist"), resolve(parsed.options.outDir));
    if (output.startsWith("..") || isAbsolute(output)) {
      throw new Error(`Expected package-local dist output: ${parsed.options.outDir}`);
    }
    return { name, configPath, files: parsed.fileNames, options: parsed.options };
  });
}

// 같은 패키지의 컴파일·정리가 겹치면 기다리거나 잠금을 지우지 않고 명확히 실패한다.
export function withBuildLock(cachePath, operation) {
  mkdirSync(cachePath, { recursive: true });
  const lockPath = join(cachePath, "lock");
  try {
    mkdirSync(lockPath);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(`Package build already running; inspect lock before retrying: ${lockPath}`, {
        cause: error,
      });
    }
    throw error;
  }
  try {
    writeFileSync(join(lockPath, "owner.json"), JSON.stringify({ pid: process.pid }) + "\n");
    return operation();
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

// 기존 자산 스크립트는 매번 실행해 자산 변경·삭제와 복사 실패를 컴파일 캐시와 분리한다.
function runAssets(packageRoot, script) {
  if (!script) return 0;
  const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", script], {
    cwd: packageRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

// 다중 컴파일과 자산 처리가 전부 성공한 출력만 재사용 가능한 상태로 기록한다.
function compilePackage(packageRoot, compilerPath, configs, assetsScript) {
  const distPath = join(packageRoot, "dist");
  const cachePath = join(packageRoot, ".cache", "paseodog-build");
  const receiptPath = join(cachePath, "outputs.json");
  const buildInfoPaths = configs.map(({ name }) => join(cachePath, `${name}.tsbuildinfo`));
  const sources = configs
    .flatMap(({ name, files }) => files.map((path) => `${name}:${relative(packageRoot, path)}`))
    .sort();
  const definition = JSON.stringify(
    {
      configs: configs.map(({ name, options }) => ({ name, options })),
      assetsScript,
      assets: assetsScript
        ? JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).scripts
        : null,
    },
    (_key, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).sort(([first], [second]) => first.localeCompare(second)),
          )
        : value,
  );
  const receipt = readReceipt(receiptPath);
  const sourceSet = new Set(sources);
  const clean =
    receipt?.version !== 2 ||
    receipt.definition !== definition ||
    !Array.isArray(receipt.sources) ||
    receipt.sources.some((source) => !sourceSet.has(source)) ||
    JSON.stringify(receipt.outputs) !== JSON.stringify(outputHashes(distPath)) ||
    buildInfoPaths.some((path) => !existsSync(path));
  if (clean) {
    const result = spawnSync(process.execPath, [join(scriptsRoot, "clean-package-dist.mjs")], {
      cwd: packageRoot,
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) return result.status ?? 1;
    for (const path of buildInfoPaths) rmSync(path, { force: true });
  }
  // 실패·중단된 컴파일은 다음 실행에서 반드시 전체 정리 후 복구한다.
  rmSync(receiptPath, { force: true });
  for (const [index, { configPath }] of configs.entries()) {
    const result = spawnSync(
      process.execPath,
      [
        compilerPath,
        "-p",
        configPath,
        "--incremental",
        "true",
        "--tsBuildInfoFile",
        buildInfoPaths[index],
      ],
      { cwd: packageRoot, stdio: "inherit" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) return result.status ?? 1;
  }
  const assetStatus = runAssets(packageRoot, assetsScript);
  if (assetStatus !== 0) return assetStatus;
  writeFileSync(
    receiptPath,
    JSON.stringify({ version: 2, definition, sources, outputs: outputHashes(distPath) }) + "\n",
  );
  console.log(`[incremental] ${packageRoot}: ${clean ? "clean build" : "cached build"}`);
  return 0;
}

// 삭제·이름 변경·불완전한 빌드는 정리하고 정상 출력은 실제 TypeScript 증분 빌드로 재사용한다.
export function buildPackage(
  packageRoot = process.cwd(),
  compilerPath = require.resolve("typescript/bin/tsc"),
  { configs = ["tsconfig.json"], assetsScript } = {},
) {
  packageRoot = resolve(packageRoot);
  if (packageRoot === repoRoot)
    throw new Error("Refusing to build package dist from the repository root");
  if (!configs.length) throw new Error("At least one tsconfig is required");
  if (assetsScript && !/^[a-zA-Z0-9:_-]+$/.test(assetsScript)) {
    throw new Error("Invalid asset script name");
  }
  const parsed = parseConfigs(packageRoot, compilerPath, configs);
  return withBuildLock(join(packageRoot, ".cache", "paseodog-build"), () =>
    compilePackage(packageRoot, compilerPath, parsed, assetsScript),
  );
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const assets = args.find((arg) => arg.startsWith("--assets="));
  const configs = args.filter((arg) => !arg.startsWith("--assets="));
  process.exitCode = buildPackage(process.cwd(), require.resolve("typescript/bin/tsc"), {
    configs: configs.length ? configs : ["tsconfig.json"],
    assetsScript: assets?.slice("--assets=".length),
  });
}

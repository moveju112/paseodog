import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { constants as zlibConstants, createBrotliCompress, createGzip } from "node:zlib";
import { isMainModule } from "./is-main-module.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const APP_DIR = path.join(REPO_ROOT, "packages", "app");
const SOURCE_DIST = path.join(APP_DIR, "dist");
const TARGET_DIST = path.join(REPO_ROOT, "packages", "server", "dist", "server", "web-ui");
const COMPRESS_EXTENSIONS = new Set([".html", ".js", ".css", ".json", ".svg", ".map"]);
const COMPRESSION_CACHE = path.join(tmpdir(), "paseodog-web-compression");

function fmtMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      ...options,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed with exit code ${code}: ${command} ${args.join(" ")}`));
        return;
      }
      resolve();
    });
  });
}

async function exportBrowserWebApp() {
  console.log("Exporting browser web app...");
  await run("npm", ["run", "build:web", "--workspace=@getpaseo/app"], {
    cwd: REPO_ROOT,
  });
}

async function cleanTarget() {
  console.log(`Cleaning ${path.relative(REPO_ROOT, TARGET_DIST)}...`);
  await rm(TARGET_DIST, { recursive: true, force: true });
  await mkdir(TARGET_DIST, { recursive: true });
}

async function copyAssets() {
  console.log(`Copying assets to ${path.relative(REPO_ROOT, TARGET_DIST)}...`);
  await cp(SOURCE_DIST, TARGET_DIST, { recursive: true, force: true });
}

// 큰 번들은 메모리에 한꺼번에 올리지 않고 바이트 해시를 계산한다.
async function hashFile(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

// 생성 캐시의 누락·손상만 재압축 대상으로 삼고 실제 접근 오류는 그대로 전달한다.
async function validCompressionCache(prefix, sourceHash) {
  try {
    const receipt = JSON.parse(await readFile(`${prefix}.json`, "utf8"));
    if (!receipt || receipt.sourceHash !== sourceHash) return false;
    return (
      receipt.br === (await hashFile(`${prefix}.br`)) &&
      receipt.gz === (await hashFile(`${prefix}.gz`))
    );
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return false;
    throw error;
  }
}

// 최대 품질은 유지하고 동일 입력·Node 버전의 검증된 압축 바이트만 재사용한다.
export async function compressFile(filePath, cacheDirectory = COMPRESSION_CACHE) {
  const sourceHash = await hashFile(filePath);
  const key = createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        node: process.versions.node,
        sourceHash,
        brotliQuality: zlibConstants.BROTLI_MAX_QUALITY,
      }),
    )
    .digest("hex");
  const prefix = path.join(cacheDirectory, key);
  const cached = await validCompressionCache(prefix, sourceHash);
  if (!cached) await createCompressionCache(filePath, prefix, sourceHash);
  await Promise.all([
    copyFile(`${prefix}.br`, `${filePath}.br`),
    copyFile(`${prefix}.gz`, `${filePath}.gz`),
  ]);
  return { cached };
}

// 두 압축 작업이 모두 끝나고 입력이 유지됐을 때만 캐시 영수증을 원자적으로 공개한다.
async function createCompressionCache(filePath, prefix, sourceHash) {
  await mkdir(path.dirname(prefix), { recursive: true, mode: 0o700 });
  const temporary = `${prefix}.${randomUUID()}`;
  try {
    const results = await Promise.allSettled([
      pipeline(
        createReadStream(filePath),
        createBrotliCompress({
          params: { [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY },
        }),
        createWriteStream(`${temporary}.br`),
      ),
      pipeline(createReadStream(filePath), createGzip(), createWriteStream(`${temporary}.gz`)),
    ]);
    for (const result of results) if (result.status === "rejected") throw result.reason;
    if ((await hashFile(filePath)) !== sourceHash)
      throw new Error("Web asset changed during compression");
    const receipt = {
      sourceHash,
      br: await hashFile(`${temporary}.br`),
      gz: await hashFile(`${temporary}.gz`),
    };
    await rename(`${temporary}.br`, `${prefix}.br`);
    await rename(`${temporary}.gz`, `${prefix}.gz`);
    await writeFile(`${temporary}.json`, JSON.stringify(receipt) + "\n");
    await rename(`${temporary}.json`, `${prefix}.json`);
  } finally {
    await Promise.all(
      ["br", "gz", "json"].map((extension) => rm(`${temporary}.${extension}`, { force: true })),
    );
  }
}

async function precompressAssets(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  const dirs = entries.filter((entry) => entry.isDirectory());

  for (const file of files) {
    const filePath = path.join(dir, file.name);
    if (COMPRESS_EXTENSIONS.has(path.extname(file.name).toLowerCase())) {
      await compressFile(filePath);
    }
  }

  for (const subdir of dirs) {
    await precompressAssets(path.join(dir, subdir.name));
  }
}

async function measureBundle(dir) {
  let raw = 0;
  let gzip = 0;
  let brotli = 0;

  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      const info = await stat(entryPath);
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === ".br") {
        brotli += info.size;
      } else if (ext === ".gz") {
        gzip += info.size;
      } else {
        raw += info.size;
      }
    }
  }

  await walk(dir);
  return { raw, gzip, brotli };
}

async function main() {
  await exportBrowserWebApp();

  const sourceStat = await stat(SOURCE_DIST).catch(() => null);
  if (!sourceStat?.isDirectory()) {
    throw new Error(`Browser web export not found at ${SOURCE_DIST}`);
  }

  await cleanTarget();
  await copyAssets();
  await precompressAssets(TARGET_DIST);

  const sizes = await measureBundle(TARGET_DIST);
  console.log("Daemon web UI bundle:");
  console.log(`  raw:    ${fmtMiB(sizes.raw)}`);
  console.log(`  gzip:   ${fmtMiB(sizes.gzip)}`);
  console.log(`  brotli: ${fmtMiB(sizes.brotli)}`);
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

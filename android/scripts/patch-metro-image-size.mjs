import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ORIGINAL_HASH = "bb3f83881e8f3d765c8b9c1bf1de0e4f6ae5143e7eebf6f58a1df52fa6e793ec";
const ORIGINAL = `  const isImageInput = assetInfo.files[0].includes(".zip/")
    ? _fs.default.readFileSync(assetInfo.files[0])
    : assetInfo.files[0];`;
const PATCHED = `  const isImageInput = isImage
    ? _fs.default.readFileSync(assetInfo.files[0])
    : null;`;

export function withoutMetroImageSize(source) {
  return source.replace(PATCHED, ORIGINAL);
}

export function patchedMetroAssets(source) {
  const original = withoutMetroImageSize(source);
  if (createHash("sha256").update(original).digest("hex") !== ORIGINAL_HASH) {
    throw new Error("Metro image-size source hash mismatch");
  }
  return original.replace(ORIGINAL, PATCHED);
}

// image-size 2의 바이트 입력 계약에 맞추고 검토한 Metro 원본만 수정한다.
export function patchMetroImageSize(root, { check = false } = {}) {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (manifest.version !== "0.83.3") throw new Error("metro 0.83.3 required");
  const path = join(root, "src/Assets.js");
  const source = readFileSync(path, "utf8");
  const patched = patchedMetroAssets(source);
  if (check && source !== patched) throw new Error("Metro image-size patch is missing");
  if (!check && source !== patched) writeFileSync(path, patched);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    patchMetroImageSize(fileURLToPath(new URL("../node_modules/metro/", import.meta.url)), {
      check: process.argv.includes("--check"),
    });
    console.log("Metro image-size compatibility: OK");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

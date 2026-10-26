import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ORIGINAL = "caa3f2c8b45dfe1e91db22ae10743af68de8d96f26515132bb52485ec0f037fa";
const PATCHED = "fc1ca6e1961ba005e554b1bc0de932d6454bf59bfaea03d02c7261dbdcafcdbd";

// Keep Expo Router's CommonJS API while using the fixed ESM-only decoder.
export function patchQueryStringDecoder(root, { check = false } = {}) {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (manifest.version !== "7.1.3") throw new Error("query-string 7.1.3 required");
  const path = join(root, "index.js");
  const source = readFileSync(path, "utf8");
  const hash = createHash("sha256").update(source).digest("hex");
  if (hash === PATCHED) return;
  if (hash !== ORIGINAL) throw new Error("query-string decoder source hash mismatch");
  if (check) throw new Error("query-string decoder patch is missing");
  writeFileSync(
    path,
    source.replace(
      "const decodeComponent = require('decode-uri-component');",
      "const decodeComponent = require('decode-uri-component').default;",
    ),
  );
}

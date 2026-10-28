import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { applySherpaLoaderEnv, resolveSherpaLoaderEnv } from "./sherpa-runtime-env.js";
import { getSherpaOnnxModelSpec } from "./model-catalog.js";

test("CUDA selection requires the pinned runtime and reuses the Korean Turbo model", () => {
  const home = mkdtempSync(join(tmpdir(), "paseo-gpu-test-"));
  try {
    const env = { PASEO_HOME: home, PASEODOG_SPEECH_GPU: "1", LD_LIBRARY_PATH: "/existing" };
    expect(() => applySherpaLoaderEnv(env, "linux", "x64")).toThrow();
    const root = join(home, "speech-gpu", "sherpa-1.12.28-cuda12");
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, "ready.json"),
      JSON.stringify({ schema: 1, runtime: "sherpa-1.12.28-cuda12" }),
    );
    const resolved = resolveSherpaLoaderEnv("linux", "x64", env);
    expect(resolved?.modulePath).toBe(join(root, "node_modules", "sherpa-onnx-node"));
    expect(applySherpaLoaderEnv(env, "linux", "x64").changed).toBe(true);
    expect(applySherpaLoaderEnv(env, "linux", "x64").changed).toBe(false);
    expect(env.LD_LIBRARY_PATH).toBe(
      join(root, "node_modules", "sherpa-onnx-linux-x64") + ":/existing",
    );
    expect(() => applySherpaLoaderEnv(env, "darwin", "arm64")).toThrow("Linux x64");
    const gpu = getSherpaOnnxModelSpec("whisper-turbo-cuda");
    const cpu = getSherpaOnnxModelSpec("whisper-turbo-int8");
    expect(gpu.requiredFiles).toEqual(cpu.requiredFiles);
    expect(gpu.extractedDir).toBe(cpu.extractedDir);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

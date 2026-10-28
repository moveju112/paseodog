import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { expect, test, vi } from "vitest";
import { getSherpaOnnxModelSpec } from "./model-catalog.js";
import { SherpaOfflineRecognizerEngine } from "./sherpa-offline-recognizer.js";

const { seen } = vi.hoisted(() => ({
  seen: [] as Array<{ modelConfig: Record<string, unknown> }>,
}));
vi.mock("./sherpa-onnx-node-loader.js", () => ({
  loadSherpaOnnxNode: () => ({
    OfflineRecognizer: class {
      constructor(config: { modelConfig: Record<string, unknown> }) {
        seen.push(config);
      }
      createStream() {
        return {};
      }
    },
  }),
}));

test("Korean Whisper candidates resolve multilingual files and transcribe locally without a joiner", () => {
  const root = mkdtempSync(join(tmpdir(), "paseo-whisper-test-"));
  try {
    for (const name of ["base", "small", "turbo"] as const) {
      const spec = getSherpaOnnxModelSpec(`whisper-${name}-int8`);
      expect(spec.requiredFiles).toEqual([
        `${name}-encoder.int8.onnx`,
        `${name}-decoder.int8.onnx`,
        `${name}-tokens.txt`,
      ]);
      for (const file of spec.requiredFiles) writeFileSync(join(root, file), "fixture");
      const model = {
        kind: "whisper" as const,
        encoder: join(root, spec.requiredFiles[0]),
        decoder: join(root, spec.requiredFiles[1]),
        tokens: join(root, spec.requiredFiles[2]),
      };
      const engine = new SherpaOfflineRecognizerEngine({ model }, pino({ level: "silent" }));
      expect(engine.createStream()).toEqual({});
      const config = seen.at(-1);
      expect(config.modelConfig.whisper).toEqual({
        encoder: model.encoder,
        decoder: model.decoder,
        language: "ko",
        task: "transcribe",
        tailPaddings: -1,
      });
      expect(config.modelConfig.provider).toBe("cpu");
      expect(config.modelConfig.transducer).toBeUndefined();
      expect(
        () =>
          new SherpaOfflineRecognizerEngine(
            { model: { ...model, encoder: join(root, "missing") } },
            pino({ level: "silent" }),
          ),
      ).toThrow("Missing offline encoder");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

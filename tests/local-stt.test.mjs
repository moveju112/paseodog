import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import { LOCAL_STT_PATCHES, SENSE_VOICE_MODEL_ID, patchedLocalSttSource, patchPaseoLocalStt } from '../scripts/patch-paseo-local-stt.mjs';

const base = new URL('../tools/node_modules/@getpaseo/server/dist/server/server/', import.meta.url);

// 설치본(원본 또는 패치본)에서 패치 전 원본을 복원한다.
function originalOf(spec) {
    let original = patchedLocalSttSource(readFileSync(new URL(spec.file, base), 'utf8'), spec);
    for (const [before, after] of [...spec.edits].reverse()) original = original.replace(after, before);
    return original;
}

test('local-STT daemon patch is exact-blob gated, idempotent and rejects partial patches', () => {
    for (const spec of LOCAL_STT_PATCHES) {
        const original = originalOf(spec);
        const patched = patchedLocalSttSource(original, spec);
        assert.notEqual(original, patched);
        assert.equal(patchedLocalSttSource(patched, spec), patched);
        let previous = original;
        for (const [before, after] of spec.previousEdits) previous = previous.replace(before, after);
        assert.equal(patchedLocalSttSource(previous, spec), patched);
        if (spec.cpuEdits) {
            let cpu = original;
            for (const [before, after] of spec.cpuEdits) cpu = cpu.replace(before, after);
            assert.equal(patchedLocalSttSource(cpu, spec), patched);
        }
        assert.throws(() => patchedLocalSttSource(patched + '// drift', spec), /hash mismatch/);
        if (spec.edits.length > 1) {
            const [before, after] = spec.file.endsWith('model-catalog.js') ? spec.edits[0] : spec.edits.at(-1);
            assert.throws(() => patchedLocalSttSource(patched.replace(after, before), spec), /Partial/);
        }
    }
});

test('local-STT patch makes SenseVoice the default STT and keeps Parakeet transducer wiring', async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'paseodog-local-stt-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    writeFileSync(join(root, 'package.json'), '{"version":"0.11.4"}');
    for (const spec of LOCAL_STT_PATCHES) {
        const path = join(root, 'dist/server/server', spec.file);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, originalOf(spec));
    }
    assert.throws(() => patchPaseoLocalStt(root, { check: true }), /patch is missing/);
    patchPaseoLocalStt(root);
    patchPaseoLocalStt(root, { check: true });
    patchPaseoLocalStt(root);

    const local = join(root, 'dist/server/server/speech/providers/local');
    // 카탈로그는 zod만 의존하므로 설치 패키지의 zod로 치환해 실제 기본값을 평가한다.
    const zod = new URL('../tools/node_modules/zod/index.js', import.meta.url).href;
    const catalog = await import(`data:text/javascript,${encodeURIComponent(
        readFileSync(join(local, 'sherpa/model-catalog.js'), 'utf8').replace('from "zod"', `from "${zod}"`))}`);
    assert.equal(catalog.DEFAULT_LOCAL_STT_MODEL, SENSE_VOICE_MODEL_ID);
    assert.deepEqual(catalog.LOCAL_STT_MODEL_IDS,
        ['parakeet-tdt-0.6b-v2-int8', 'parakeet-tdt-0.6b-v3-int8', SENSE_VOICE_MODEL_ID,
            'whisper-base-int8', 'whisper-small-int8', 'whisper-turbo-int8', 'whisper-turbo-cuda']);
    assert.deepEqual(catalog.getSherpaOnnxModelSpec(SENSE_VOICE_MODEL_ID).requiredFiles, ['model.int8.onnx', 'tokens.txt']);

    const worker = readFileSync(join(local, 'worker-process.js'), 'utf8');
    assert.match(worker, /model: modelId === "sense-voice-zh-en-ja-ko-yue-int8"\n\s+\? \{ kind: "sense_voice", model: `\$\{modelDir\}\/model\.int8\.onnx`/);
    assert.match(worker, /kind: "nemo_transducer",\n\s+encoder: `\$\{modelDir\}\/encoder\.int8\.onnx`/);
    const workerEngine = runInNewContext(
        worker.slice(worker.indexOf('function getSttEngine('), worker.indexOf('function getSttProvider(')) + ';getSttEngine',
        {
            sttEngines: new Map(), logger: {},
            sttModelId: config => config.model,
            sttEngineKey: (config, id) => id,
            getLocalSpeechModelDir: (dir, id) => `${dir}/${id}`,
            SherpaOfflineRecognizerEngine: class { constructor(config) { this.config = config; } },
        },
    );
    for (const name of ['base', 'small', 'turbo']) {
        const id = `whisper-${name}-int8`;
        const { config } = workerEngine({ modelsDir: '/models', model: id }, 'dictation');
        assert.equal(config.model.kind, 'whisper');
        assert.equal(config.model.encoder, `/models/${id}/${name}-encoder.int8.onnx`);
        assert.equal(config.model.decoder, `/models/${id}/${name}-decoder.int8.onnx`);
        assert.equal(config.model.tokens, `/models/${id}/${name}-tokens.txt`);
        assert.equal(config.featureDim, name === 'turbo' ? 128 : 80);
        assert.equal(config.provider, 'cpu');
    }
    const gpu = workerEngine({ modelsDir: '/models', model: 'whisper-turbo-cuda' }, 'dictation').config;
    assert.equal(gpu.provider, 'cuda');
    assert.equal(gpu.featureDim, 128);
    assert.equal(gpu.model.kind, 'whisper');
    assert.equal(gpu.model.encoder, '/models/whisper-turbo-cuda/turbo-encoder.int8.onnx');

    // 네이티브 바인딩 대신 설정을 기록하는 로더를 두고 패치된 인식기 생성자를 실행한다.
    writeFileSync(join(local, 'sherpa/sherpa-onnx-node-loader.js'), 'export const seen = [];\n'
        + 'export function loadSherpaOnnxNode() { return { OfflineRecognizer: class { constructor(config) { seen.push(config); this.config = config; } } }; }\n');
    for (const name of ['model.int8.onnx', 'tokens.txt', 'encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx'])
        writeFileSync(join(root, name), '');
    const { SherpaOfflineRecognizerEngine } = await import(join(local, 'sherpa/sherpa-offline-recognizer.js'));
    const { seen } = await import(join(local, 'sherpa/sherpa-onnx-node-loader.js'));
    const logger = { child: () => ({ info() {}, warn() {} }) };
    new SherpaOfflineRecognizerEngine({ model: { kind: 'sense_voice', model: join(root, 'model.int8.onnx'), tokens: join(root, 'tokens.txt') } }, logger);
    new SherpaOfflineRecognizerEngine({ model: { kind: 'nemo_transducer', encoder: join(root, 'encoder.int8.onnx'),
        decoder: join(root, 'decoder.int8.onnx'), joiner: join(root, 'joiner.int8.onnx'), tokens: join(root, 'tokens.txt') } }, logger);
    assert.deepEqual(seen[0].modelConfig.senseVoice, { model: join(root, 'model.int8.onnx'), language: 'auto', useInverseTextNormalization: 1 });
    assert.equal(seen[0].modelConfig.transducer, undefined);
    assert.equal(seen[1].modelConfig.modelType, 'nemo_transducer');
    assert.equal(seen[1].modelConfig.transducer.joiner, join(root, 'joiner.int8.onnx'));
    for (const name of ['base', 'small', 'turbo']) {
        const spec = catalog.getSherpaOnnxModelSpec(`whisper-${name}-int8`);
        assert.deepEqual(spec.requiredFiles, [`${name}-encoder.int8.onnx`, `${name}-decoder.int8.onnx`, `${name}-tokens.txt`]);
        new SherpaOfflineRecognizerEngine({ model: { kind: 'whisper',
            encoder: join(root, 'encoder.int8.onnx'), decoder: join(root, 'decoder.int8.onnx'),
            tokens: join(root, 'tokens.txt') } }, logger);
        assert.deepEqual(seen.at(-1).modelConfig.whisper, { encoder: join(root, 'encoder.int8.onnx'),
            decoder: join(root, 'decoder.int8.onnx'), language: 'ko', task: 'transcribe', tailPaddings: -1 });
        assert.equal(seen.at(-1).modelConfig.provider, 'cpu');
        assert.equal(seen.at(-1).modelConfig.transducer, undefined);
    }
    assert.throws(() => new SherpaOfflineRecognizerEngine({ model: { kind: 'sense_voice', model: join(root, 'missing.onnx'),
        tokens: join(root, 'tokens.txt') } }, logger), /Missing SenseVoice model/);
});

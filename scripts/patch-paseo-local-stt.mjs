// 로컬 Apache-2.0 패치: Paseo 0.11.4 로컬 STT 기본 모델을 한국어·영어 자동 감지 SenseVoice로 바꾼다.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitBlob } from './patch-mixdog.mjs';

export const SENSE_VOICE_MODEL_ID = 'sense-voice-zh-en-ja-ko-yue-int8';

const senseVoiceCatalogEntry = `    "${SENSE_VOICE_MODEL_ID}": {
        kind: "stt-offline",
        archiveUrl: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2",
        extractedDir: "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17",
        requiredFiles: ["model.int8.onnx", "tokens.txt"],
        description: "SenseVoice Small (offline, Korean/English/Chinese/Japanese/Cantonese, auto-detected).",
        defaultFor: "stt",
    },
`;
const transducerModelConfig = `                transducer: {
                    encoder: config.model.encoder,
                    decoder: config.model.decoder,
                    joiner: config.model.joiner,
                },
`;
const transducerWorkerModel = '                kind: "nemo_transducer",\n'
    + '                encoder: `${modelDir}/encoder.int8.onnx`,\n'
    + '                decoder: `${modelDir}/decoder.int8.onnx`,\n'
    + '                joiner: `${modelDir}/joiner.int8.onnx`,\n'
    + '                tokens: `${modelDir}/tokens.txt`,\n';

export const LOCAL_STT_PATCHES = [
    { file: 'speech/providers/local/sherpa/model-catalog.js', blob: '93b486f50897bd7a71611a037836abcaf734e816', edits: [
        ['        description: "NVIDIA Parakeet TDT v2 (offline NeMo transducer, English).",\n        defaultFor: "stt",\n    },\n',
            '        description: "NVIDIA Parakeet TDT v2 (offline NeMo transducer, English).",\n    },\n'],
        ['    "kokoro-en-v0_19": {\n', senseVoiceCatalogEntry + '    "kokoro-en-v0_19": {\n'],
    ] },
    { file: 'speech/providers/local/sherpa/sherpa-offline-recognizer.js', blob: '4aca66e5914e6b9291475f00e5c9ac60ae8c31dc', edits: [
        ['        assertFileExists(config.model.encoder, "offline encoder");\n'
            + '        assertFileExists(config.model.decoder, "offline decoder");\n'
            + '        assertFileExists(config.model.joiner, "offline joiner");\n',
        '        if (config.model.kind === "sense_voice") {\n'
            + '            assertFileExists(config.model.model, "SenseVoice model");\n'
            + '        }\n        else {\n'
            + '            assertFileExists(config.model.encoder, "offline encoder");\n'
            + '            assertFileExists(config.model.decoder, "offline decoder");\n'
            + '            assertFileExists(config.model.joiner, "offline joiner");\n'
            + '        }\n'],
        ['            modelConfig: {\n' + transducerModelConfig
            + '                tokens: config.model.tokens,\n                modelType: "nemo_transducer",\n',
        '            modelConfig: {\n'
            + '                ...(config.model.kind === "sense_voice"\n'
            + '                    ? { senseVoice: { model: config.model.model, language: "auto", useInverseTextNormalization: 1 } }\n'
            + '                    : {\n' + transducerModelConfig.replace(/^/gm, '        ')
            + '                        modelType: "nemo_transducer",\n                    }),\n'
            + '                tokens: config.model.tokens,\n'],
    ] },
    { file: 'speech/providers/local/worker-process.js', blob: 'e7b4df48ce27ba416b1ddcd2fd8789f93c6a17eb', edits: [
        ['        model: {\n' + transducerWorkerModel.replace(/^ {4}/gm, '') + '        },\n',
            `        model: modelId === "${SENSE_VOICE_MODEL_ID}"\n`
            + '            ? { kind: "sense_voice", model: `${modelDir}/model.int8.onnx`, tokens: `${modelDir}/tokens.txt` }\n'
            + '            : {\n' + transducerWorkerModel + '            },\n'],
    ] },
];

// 원본·완성된 패치만 받으며 파일별 정확한 blob과 유일한 앵커를 검증한다.
export function patchedLocalSttSource(source, spec) {
    let original = source;
    for (const [before, after] of [...spec.edits].reverse()) original = original.replace(after, before);
    if (gitBlob(original) !== spec.blob) throw new Error(`Paseo local-STT source hash mismatch: ${spec.file}`);
    let result = original;
    for (const [before, after] of spec.edits) {
        if (result.split(before).length !== 2) throw new Error(`Paseo local-STT anchor mismatch: ${spec.file}`);
        result = result.replace(before, after);
    }
    if (source !== original && source !== result) throw new Error(`Partial Paseo local-STT patch: ${spec.file}`);
    return result;
}

// 대상 세 파일을 모두 검증한 뒤에만 기록한다.
export function patchPaseoLocalStt(root, { check = false } = {}) {
    if (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version !== '0.11.4')
        throw new Error('Paseo local STT patch requires 0.11.4');
    const base = resolve(root, 'dist/server/server');
    const changes = LOCAL_STT_PATCHES.map((spec) => {
        const path = resolve(base, spec.file), before = readFileSync(path, 'utf8');
        return { path, before, after: patchedLocalSttSource(before, spec) };
    });
    if (check && changes.some(({ before, after }) => before !== after))
        throw new Error('Paseo local-STT patch is missing');
    if (!check) for (const { path, before, after } of changes) if (before !== after) writeFileSync(path, after);
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
    try {
        patchPaseoLocalStt(resolve(dirname(self), '../tools/node_modules/@getpaseo/server'), {
            check: process.argv.includes('--check'),
        });
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

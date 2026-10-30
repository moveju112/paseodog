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

const previousPatches = [
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

const whisperCatalog = ['base', 'small', 'turbo'].map(name => `    "whisper-${name}-int8": {
        kind: "stt-offline",
        archiveUrl: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-${name}.tar.bz2",
        extractedDir: "sherpa-onnx-whisper-${name}",
        requiredFiles: ["${name}-encoder.int8.onnx", "${name}-decoder.int8.onnx", "${name}-tokens.txt"],
        description: "Whisper ${name} (multilingual including Korean, CPU int8).",
    },
`).join('');
const whisperEdits = [
    [['    "kokoro-en-v0_19": {\n', whisperCatalog + '    "kokoro-en-v0_19": {\n']],
    [
        ['            assertFileExists(config.model.joiner, "offline joiner");',
            '            if (config.model.kind === "nemo_transducer") assertFileExists(config.model.joiner, "offline joiner");'],
        ['                    : {\n' + transducerModelConfig.replace(/^/gm, '        '),
            '                    : config.model.kind === "whisper"\n'
            + '                        ? { whisper: { encoder: config.model.encoder, decoder: config.model.decoder, language: "ko", task: "transcribe", tailPaddings: -1 } }\n'
            + '                        : {\n' + transducerModelConfig.replace(/^/gm, '        ')],
    ],
    [
        ['    const modelDir = getLocalSpeechModelDir(config.modelsDir, modelId);',
            '    const modelDir = getLocalSpeechModelDir(config.modelsDir, modelId);\n'
            + '    const whisper = { "whisper-base-int8": "base", "whisper-small-int8": "small", "whisper-turbo-int8": "turbo" }[modelId];'],
        ['            : {\n' + transducerWorkerModel,
            '            : whisper\n'
            + '                ? { kind: "whisper", encoder: `${modelDir}/${whisper}-encoder.int8.onnx`, decoder: `${modelDir}/${whisper}-decoder.int8.onnx`, tokens: `${modelDir}/${whisper}-tokens.txt` }\n'
            + '                : {\n' + transducerWorkerModel],
        ['        numThreads: 2,\n', '        featureDim: whisper === "turbo" ? 128 : 80,\n        numThreads: 2,\n'],
    ],
];
const cpuPatches = previousPatches.map((spec, index) => ({
    ...spec, previousEdits: spec.edits, edits: [...spec.edits, ...whisperEdits[index]],
}));

const gpuCatalog = `    "whisper-turbo-cuda": {
        kind: "stt-offline",
        archiveUrl: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-turbo.tar.bz2",
        extractedDir: "sherpa-onnx-whisper-turbo",
        requiredFiles: ["turbo-encoder.int8.onnx", "turbo-decoder.int8.onnx", "turbo-tokens.txt"],
        description: "Whisper Large-v3 Turbo (multilingual including Korean, NVIDIA CUDA).",
    },
`;
const gpuEdits = [
    [['    "kokoro-en-v0_19": {\n', gpuCatalog + '    "kokoro-en-v0_19": {\n']],
    [],
    [
        ['"whisper-turbo-int8": "turbo" }[modelId]', '"whisper-turbo-int8": "turbo", "whisper-turbo-cuda": "turbo" }[modelId]'],
        ['        featureDim: whisper === "turbo" ? 128 : 80,\n',
            '        featureDim: whisper === "turbo" ? 128 : 80,\n        provider: modelId === "whisper-turbo-cuda" ? "cuda" : "cpu",\n'],
    ],
];
const gpuResolution = `    if (env.PASEODOG_SPEECH_GPU === "1") {
        if (platform !== "linux" || arch !== "x64" || !path.isAbsolute(env.PASEO_HOME ?? ""))
            throw new Error("GPU speech requires a dedicated Linux x64 home");
        const root = path.join(env.PASEO_HOME, "speech-gpu", "sherpa-1.12.28-cuda12");
        const receipt = JSON.parse(readFileSync(path.join(root, "ready.json"), "utf8"));
        if (receipt.schema !== 1 || receipt.runtime !== "sherpa-1.12.28-cuda12")
            throw new Error("Verified GPU speech runtime required");
        return { key: "LD_LIBRARY_PATH", libDir: path.join(root, "node_modules", "sherpa-onnx-linux-x64"),
            packageName: "sherpa-onnx-linux-x64", modulePath: path.join(root, "node_modules", "sherpa-onnx-node") };
    }
`;
const legacyGpuPatches = [
    ...cpuPatches.map((spec, index) => ({
        ...spec, cpuEdits: spec.edits, edits: [...spec.edits, ...gpuEdits[index]],
    })),
    { file: 'speech/providers/local/worker-client.js', blob: 'bc943a2acbce1a56cf516647a4819198920ddab3',
        previousEdits: [], edits: [
            ['function forkLocalSpeechWorker() {\n    const env = { ...process.env };\n',
                'function forkLocalSpeechWorker(config) {\n    const env = { ...process.env };\n'
                + '    delete env.PASEODOG_SPEECH_GPU;\n'
                + '    if (config.dictationSttModel === "whisper-turbo-cuda" || config.voiceSttModel === "whisper-turbo-cuda") env.PASEODOG_SPEECH_GPU = "1";\n'],
            ['this.forkWorker = options.forkWorker ?? forkLocalSpeechWorker;',
                'this.forkWorker = options.forkWorker ?? (() => forkLocalSpeechWorker(options.config));'],
        ] },
    { file: 'speech/providers/local/sherpa/sherpa-runtime-env.js', blob: 'f2310bb0b49e0bcd3b91edb0f0b55907337affe6',
        previousEdits: [], edits: [
            ['import { createRequire } from "node:module";', 'import { createRequire } from "node:module";\nimport { readFileSync } from "node:fs";'],
            ['export function resolveSherpaLoaderEnv(platform = process.platform, arch = process.arch) {\n',
                'export function resolveSherpaLoaderEnv(platform = process.platform, arch = process.arch, env = process.env) {\n' + gpuResolution],
            ['const resolved = resolveSherpaLoaderEnv(platform, arch);', 'const resolved = resolveSherpaLoaderEnv(platform, arch, env);'],
        ] },
    { file: 'speech/providers/local/sherpa/sherpa-onnx-node-loader.js', blob: 'ecad9b8b09aa635b7b3c7f199f563e9885bac3e4',
        previousEdits: [], edits: [
            ['    const require = createRequire(import.meta.url);\n    const attempts = [];\n',
                '    const require = createRequire(import.meta.url);\n    const attempts = [];\n'
                + '    if (process.env.PASEODOG_SPEECH_GPU === "1") {\n'
                + '        const gpu = resolveSherpaLoaderEnv();\n'
                + '        if (!gpu?.modulePath) throw new Error("Verified GPU speech runtime required");\n'
                + '        cached = require(gpu.modulePath);\n        return cached;\n    }\n'],
        ] },
];

const komixEdits = {
    'speech/providers/local/sherpa/model-catalog.js': [[
        '    "kokoro-en-v0_19": {\n',
        `    "whisper-medium-komix-v2-cuda": {
        kind: "stt-offline",
        archiveUrl: "local:whisper-medium-komix-v2",
        extractedDir: "sherpa-onnx-whisper-medium-komix-v2",
        requiredFiles: ["medium-encoder.int8.onnx", "medium-decoder.int8.onnx", "medium-tokens.txt"],
        description: "Whisper Medium KoMix-v2 (Korean, NVIDIA CUDA; locally converted installation).",
    },
    "kokoro-en-v0_19": {
`,
    ]],
    'speech/providers/local/worker-process.js': [
        ['"whisper-turbo-cuda": "turbo" }[modelId]', '"whisper-turbo-cuda": "turbo", "whisper-medium-komix-v2-cuda": "medium" }[modelId]'],
        ['provider: modelId === "whisper-turbo-cuda" ? "cuda" : "cpu",',
            'provider: (modelId === "whisper-turbo-cuda" || modelId === "whisper-medium-komix-v2-cuda") ? "cuda" : "cpu",'],
    ],
    'speech/providers/local/worker-client.js': [[
        'config.dictationSttModel === "whisper-turbo-cuda" || config.voiceSttModel === "whisper-turbo-cuda"',
        '["whisper-turbo-cuda", "whisper-medium-komix-v2-cuda"].some(model => config.dictationSttModel === model || config.voiceSttModel === model)',
    ]],
};
export const LOCAL_STT_PATCHES = [
    ...legacyGpuPatches.map(spec => ({
        ...spec, gpuEdits: spec.edits, edits: [...spec.edits, ...(komixEdits[spec.file] ?? [])],
    })),
    { file: 'speech/providers/local/sherpa/model-downloader.js', blob: 'ac6fe68aca4eb61bcda6e9111a01bf2ebbbccab5',
        previousEdits: [], edits: [[
            '    logger.info({ modelsDir: options.modelsDir }, "Starting model download");',
            '    if (spec.archiveUrl.startsWith("local:")) throw new Error("KoMix-v2 requires a verified local model installation");\n'
                + '    logger.info({ modelsDir: options.modelsDir }, "Starting model download");',
        ]] },
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
    let previous = original;
    for (const [before, after] of spec.previousEdits) previous = previous.replace(before, after);
    let cpu = original;
    for (const [before, after] of spec.cpuEdits ?? []) cpu = cpu.replace(before, after);
    let gpu = original;
    for (const [before, after] of spec.gpuEdits ?? []) gpu = gpu.replace(before, after);
    if (source !== original && source !== previous && source !== cpu && source !== gpu && source !== result)
        throw new Error(`Partial Paseo local-STT patch: ${spec.file}`);
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

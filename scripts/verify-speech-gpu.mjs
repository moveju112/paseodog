import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { GPU_RUNTIME_NAME, runtimeFingerprint } from './prepare-speech-gpu.mjs';

// 별도 프로세스에서 CUDA를 검증한다. 실패 시 증거를 만들거나 CPU로 전환하지 않는다.
export async function verifySpeechGpu(candidate, modelDir, wavePath) {
    const require = createRequire(import.meta.url);
    const sherpa = require(join(candidate, 'node_modules/sherpa-onnx-node'));
    const started = performance.now();
    const recognizer = new sherpa.OfflineRecognizer({
        featConfig: { sampleRate: 16000, featureDim: 128 },
        modelConfig: {
            whisper: {
                encoder: join(modelDir, 'turbo-encoder.int8.onnx'),
                decoder: join(modelDir, 'turbo-decoder.int8.onnx'),
                language: 'ko', task: 'transcribe', tailPaddings: -1,
            },
            tokens: join(modelDir, 'turbo-tokens.txt'),
            provider: 'cuda', numThreads: 2, debug: 0,
        },
    });
    const loadedMs = Math.round(performance.now() - started);
    const wave = sherpa.readWave(wavePath);
    const stream = recognizer.createStream();
    stream.acceptWaveform({ samples: wave.samples, sampleRate: wave.sampleRate });
    const inferenceStart = performance.now();
    recognizer.decode(stream);
    const inferenceMs = Math.round(performance.now() - inferenceStart);
    const result = recognizer.getResult(stream);
    if (!result.text?.trim()) throw new Error('GPU inference returned no transcript');
    const rows = execFileSync('nvidia-smi', ['--query-compute-apps=pid,used_memory', '--format=csv,noheader,nounits'],
        { encoding: 'utf8', timeout: 10000 }).trim().split('\n');
    const own = rows.map(row => row.split(',').map(value => Number(value.trim())))
        .find(([pid]) => pid === process.pid);
    if (!own || !(own[1] > 0)) throw new Error('CUDA inference GPU allocation was not observed');
    const receipt = {
        schema: 1, runtime: GPU_RUNTIME_NAME, provider: 'cuda',
        gpuMemoryMiB: own[1], loadedMs, inferenceMs,
        audioSeconds: wave.samples.length / wave.sampleRate, transcriptCharacters: result.text.length,
        fingerprint: await runtimeFingerprint(candidate),
    };
    await writeFile(join(candidate, 'verified.json'), JSON.stringify(receipt) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify(receipt));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const { values } = parseArgs({ options: {
            candidate: { type: 'string' }, model: { type: 'string' }, wave: { type: 'string' },
        } });
        await verifySpeechGpu(values.candidate, values.model, values.wave);
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}

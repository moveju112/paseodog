import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { scratchRoot } from '../scripts/paths.mjs';
import { GPU_RUNTIME_NAME, runtimeFingerprint, installSpeechGpu, verifyArchive } from '../scripts/prepare-speech-gpu.mjs';
import { handleSpeechSettings, gpuSpeechReady } from '../plugin/server/speech-settings.mjs';
import { LOCAL_STT_PATCHES, patchedLocalSttSource } from '../scripts/patch-paseo-local-stt.mjs';

function temporary(t) {
    const root = mkdtempSync(path.join(scratchRoot, 'speech-gpu-test-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    return root;
}

function ready(home) {
    const root = path.join(home, 'speech-gpu', GPU_RUNTIME_NAME);
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, 'ready.json'), JSON.stringify({ schema: 1, runtime: GPU_RUNTIME_NAME }));
    return root;
}

function onLinuxArchitecture(arch, run) {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    const architecture = Object.getOwnPropertyDescriptor(process, 'arch');
    try {
        Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
        Object.defineProperty(process, 'arch', { ...architecture, value: arch });
        return run();
    } finally {
        Object.defineProperty(process, 'platform', platform);
        Object.defineProperty(process, 'arch', architecture);
    }
}

function patched(file) {
    const spec = LOCAL_STT_PATCHES.find(item => item.file.endsWith('/' + file));
    return patchedLocalSttSource(readFileSync(new URL(
        '../tools/node_modules/@getpaseo/server/dist/server/server/' + spec.file, import.meta.url), 'utf8'), spec);
}

test('GPU selection is local-only and appears only after a verified installation', t => {
    const home = temporary(t), env = { PASEO_HOME: home };
    writeFileSync(path.join(home, 'config.json'), JSON.stringify({ agents: { providers: { paseodog: {} } } }));
    let snapshot = handleSpeechSettings({ action: 'read' }, env);
    assert.equal(snapshot.models.some(model => model.id === 'whisper-turbo-cuda'), false);
    assert.throws(() => handleSpeechSettings({
        action: 'write', model: 'whisper-turbo-cuda', revision: snapshot.revision,
    }, env), /Unsupported/);
    ready(home);
    assert.equal(gpuSpeechReady(home, 'win32', 'x64'), false);
    assert.equal(gpuSpeechReady(home, 'linux', 'arm64'), false);
    onLinuxArchitecture('arm64', () => {
        snapshot = handleSpeechSettings({ action: 'read' }, env);
        assert.equal(snapshot.models.some(model => model.id === 'whisper-turbo-cuda'), false);
        assert.throws(() => handleSpeechSettings({
            action: 'write', model: 'whisper-turbo-cuda', revision: snapshot.revision,
        }, env), /Unsupported/);
    });
    onLinuxArchitecture('x64', () => {
        snapshot = handleSpeechSettings({ action: 'read' }, env);
        assert.match(snapshot.models.at(-1).warning, /CPU나 유료 API로 자동 전환하지/);
        handleSpeechSettings({ action: 'write', model: 'whisper-turbo-cuda', revision: snapshot.revision }, env);
    });
    const saved = JSON.parse(readFileSync(path.join(home, 'config.json')));
    for (const feature of ['dictation', 'voiceMode']) {
        assert.deepEqual(saved.features[feature].stt, { provider: 'local', model: 'whisper-turbo-cuda', language: 'ko' });
    }
});

test('GPU worker uses isolated verified libraries and refuses a missing runtime without CPU fallback', t => {
    const home = temporary(t);
    const source = patched('sherpa-runtime-env.js').replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '')
        .replaceAll('import.meta.url', '"file:///fixture.js"');
    const envModule = runInNewContext(source + '\n;({applySherpaLoaderEnv,resolveSherpaLoaderEnv})', {
        path, readFileSync, process: { platform: 'linux', arch: 'x64', env: {} },
        createRequire: () => ({ resolve: () => '/cpu/package.json' }),
    });
    const env = { PASEO_HOME: home, PASEODOG_SPEECH_GPU: '1', LD_LIBRARY_PATH: '/existing' };
    assert.throws(() => envModule.applySherpaLoaderEnv(env), /ENOENT/);
    const root = ready(home);
    const resolved = envModule.resolveSherpaLoaderEnv('linux', 'x64', env);
    assert.equal(resolved.modulePath, path.join(root, 'node_modules/sherpa-onnx-node'));
    assert.equal(envModule.applySherpaLoaderEnv(env).changed, true);
    assert.equal(env.LD_LIBRARY_PATH, path.join(root, 'node_modules/sherpa-onnx-linux-x64') + ':/existing');
    assert.equal(envModule.applySherpaLoaderEnv(env).changed, false);
    assert.throws(() => envModule.applySherpaLoaderEnv(env, 'win32', 'x64'), /Linux x64/);

    let requests = [];
    const loader = patched('sherpa-onnx-node-loader.js').replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '')
        .replaceAll('import.meta.url', '"file:///fixture.js"');
    const context = {
        path, existsSync, process: { platform: 'linux', arch: 'x64', env, versions: {} },
        createRequire: () => target => { requests.push(target); throw new Error('GPU unavailable'); },
        resolveSherpaLoaderEnv: () => resolved,
    };
    const load = runInNewContext(loader + '\n;loadSherpaOnnxNode', context);
    assert.throws(() => load(), /GPU unavailable/);
    assert.deepEqual(requests, [resolved.modulePath]);

    const worker = patched('worker-client.js');
    const start = worker.indexOf('function forkLocalSpeechWorker(');
    const body = worker.slice(start, worker.indexOf('\nfunction isResponse(', start));
    let captured;
    const fork = runInNewContext(body + ';forkLocalSpeechWorker', {
        process: { env: { PASEO_HOME: home, PASEODOG_SPEECH_GPU: '1' } },
        applySherpaLoaderEnv: value => envModule.applySherpaLoaderEnv(value),
        fork: (_file, _args, options) => { captured = options.env; return {}; },
        fileURLToPath: () => '/worker.js', resolveWorkerUrl: () => null, resolveWorkerExecArgv: () => [],
    });
    fork({ dictationSttModel: 'whisper-turbo-int8', voiceSttModel: 'sense-voice-zh-en-ja-ko-yue-int8' });
    assert.equal(captured.PASEODOG_SPEECH_GPU, undefined);
    assert.equal(captured.LD_LIBRARY_PATH, '/cpu');
    fork({ dictationSttModel: 'whisper-turbo-cuda', voiceSttModel: 'whisper-turbo-cuda' });
    assert.equal(captured.PASEODOG_SPEECH_GPU, '1');
    assert.equal(captured.LD_LIBRARY_PATH, resolved.libDir);
});

test('GPU installer verifies archive bytes, inference receipt and destination without replacing existing files', async t => {
    const root = temporary(t), candidate = path.join(root, 'candidate'), home = path.join(root, 'home');
    mkdirSync(path.join(candidate, 'node_modules'), { recursive: true });
    mkdirSync(home);
    writeFileSync(path.join(home, 'config.json'), JSON.stringify({ agents: { providers: { paseodog: {} } } }));
    const file = path.join(candidate, 'node_modules/addon');
    writeFileSync(file, 'abc');
    const spec = { file: 'test', algorithm: 'sha256', encoding: 'hex',
        hash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' };
    await verifyArchive(file, spec);
    await assert.rejects(verifyArchive(file, { ...spec, hash: '0'.repeat(64) }), /checksum/);
    await assert.rejects(installSpeechGpu(candidate, home), /ENOENT/);
    const receipt = { runtime: GPU_RUNTIME_NAME, provider: 'cuda', gpuMemoryMiB: 1,
        fingerprint: await runtimeFingerprint(candidate) };
    writeFileSync(path.join(candidate, 'verified.json'), JSON.stringify(receipt));
    writeFileSync(file, 'changed');
    await assert.rejects(installSpeechGpu(candidate, home), /runtime changed/);
    writeFileSync(file, 'abc');
    await installSpeechGpu(candidate, home);
    assert.equal(gpuSpeechReady(home, 'linux', 'x64'), true);
    assert.equal(gpuSpeechReady(home, 'linux', 'arm64'), false);
    assert.equal(gpuSpeechReady(home), process.platform === 'linux' && process.arch === 'x64');
    await assert.rejects(installSpeechGpu(candidate, home), /EEXIST/);
    assert.equal(readFileSync(path.join(home, 'speech-gpu', GPU_RUNTIME_NAME, 'node_modules/addon'), 'utf8'), 'abc');
});

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, copyFile, readdir, writeFile, rename, cp } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const GPU_RUNTIME_NAME = 'sherpa-1.12.28-cuda12';
export const GPU_ARCHIVES = [
    {
        file: 'sherpa-gpu.tar.bz2',
        url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.28/sherpa-onnx-v1.12.28-cuda-12.x-cudnn-9.x-linux-x64-gpu.tar.bz2',
        algorithm: 'sha256', encoding: 'hex',
        hash: '9e816c408fced966dc1f2127050769dfb4a35f45f55e1099a051906e3f0c90d3',
    },
    {
        file: 'sherpa-node.tgz',
        url: 'https://registry.npmjs.org/sherpa-onnx-node/-/sherpa-onnx-node-1.12.28.tgz',
        algorithm: 'sha512', encoding: 'base64',
        hash: 'EHSB3EG6hKyXaTNh6GU/bwh6i3dncCH6ZCU2mScNzkxRbVStZ7QmNj0Oo4E9XrGGo9jX9pKg9MPHEPyjdK+ApA==',
    },
    {
        file: 'sherpa-native.tgz',
        url: 'https://registry.npmjs.org/sherpa-onnx-linux-x64/-/sherpa-onnx-linux-x64-1.12.28.tgz',
        algorithm: 'sha512', encoding: 'base64',
        hash: '+7ZwpAqQYz5fjNQ13F9+sR11zKo6+HhOa1OvT+F4g4PjmoCS1o3YYQqT4JZuLeNRWAY6kKn4IXGWLx93K+OV7A==',
    },
    {
        file: 'cudnn.whl',
        url: 'https://files.pythonhosted.org/packages/9f/fd/713452cd72343f682b1c7b9321e23829f00b842ceaedcda96e742ea0b0b3/nvidia_cudnn_cu12-9.1.0.70-py3-none-manylinux2014_x86_64.whl',
        algorithm: 'sha256', encoding: 'hex',
        hash: '165764f44ef8c61fcdfdfdbe769d687e06374059fbb388b6c89ecb0e28793a6f',
    },
];

export async function verifyArchive(path, spec) {
    const hash = createHash(spec.algorithm);
    for await (const bytes of createReadStream(path)) hash.update(bytes);
    if (hash.digest(spec.encoding) !== spec.hash) throw new Error(`GPU archive checksum mismatch: ${spec.file}`);
}

export async function runtimeFingerprint(root) {
    const hash = createHash('sha256');
    async function visit(relative) {
        for (const entry of (await readdir(join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
            const name = join(relative, entry.name);
            if (entry.isDirectory()) await visit(name);
            else if (entry.isFile()) {
                hash.update(name + '\0');
                for await (const bytes of createReadStream(join(root, name))) hash.update(bytes);
            } else throw new Error('GPU runtime must not contain links');
        }
    }
    await visit('node_modules');
    return hash.digest('hex');
}

function run(command, args, options = {}) {
    const result = spawnSync(command, args, { stdio: 'inherit', ...options });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}

// 기존 node_modules·시스템 CUDA·실행 중 데몬을 수정하지 않고 새 디렉터리만 구성한다.
export async function prepareSpeechGpu(output, cache) {
    if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('GPU speech requires Linux x64');
    if (!isAbsolute(output) || !isAbsolute(cache)) throw new Error('Absolute output and cache paths required');
    await mkdir(output, { mode: 0o700 });
    await mkdir(cache, { recursive: true, mode: 0o700 });
    for (const spec of GPU_ARCHIVES) {
        const target = join(cache, spec.file);
        try { await verifyArchive(target, spec); }
        catch (error) {
            if (error.code !== 'ENOENT') throw error;
            console.log(`Downloading ${spec.file}`);
            const response = await fetch(spec.url, { signal: AbortSignal.timeout(300000) });
            if (!response.ok || !response.body) throw new Error(`GPU download failed: ${spec.file} HTTP ${response.status}`);
            const temporary = target + `.${process.pid}.tmp`;
            await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
            await verifyArchive(temporary, spec);
            await rename(temporary, target);
        }
    }
    const modules = join(output, 'node_modules');
    const wrapper = join(modules, 'sherpa-onnx-node');
    const native = join(modules, 'sherpa-onnx-linux-x64');
    await mkdir(wrapper, { recursive: true });
    await mkdir(native);
    run('tar', ['xf', join(cache, 'sherpa-node.tgz'), '-C', wrapper, '--strip-components=1']);
    // CPU의 공유 라이브러리는 가져오지 않는다. 검증된 GPU 배포본과 동일 버전의 addon만 결합한다.
    run('tar', ['xf', join(cache, 'sherpa-native.tgz'), '-C', native, '--strip-components=1',
        'package/sherpa-onnx.node', 'package/index.js', 'package/package.json']);
    const gpu = join(output, 'upstream');
    await mkdir(gpu);
    run('tar', ['xf', join(cache, 'sherpa-gpu.tar.bz2'), '-C', gpu, '--strip-components=1']);
    for (const file of await readdir(join(gpu, 'lib'))) await copyFile(join(gpu, 'lib', file), join(native, file));
    run('python3', ['-c', [
        'import sys, zipfile, pathlib',
        'with zipfile.ZipFile(sys.argv[1]) as z:',
        ' for name in z.namelist():',
        '  if name.startswith("nvidia/cudnn/lib/") and not name.endswith("/"):',
        '   pathlib.Path(sys.argv[2], pathlib.PurePosixPath(name).name).write_bytes(z.read(name))',
    ].join('\n'), join(cache, 'cudnn.whl'), native]);
    const libraries = spawnSync('ldd', [join(native, 'libonnxruntime_providers_cuda.so')], {
        encoding: 'utf8', env: { ...process.env, LD_LIBRARY_PATH: native },
    });
    if (libraries.status !== 0 || libraries.stdout.includes('not found'))
        throw new Error('Required CUDA 12 libraries are missing');
    await writeFile(join(output, 'prepared.json'), JSON.stringify({
        schema: 1, runtime: GPU_RUNTIME_NAME, archives: GPU_ARCHIVES.map(({ file, hash }) => ({ file, hash })),
    }) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(`Prepared GPU runtime: ${output}`);
}

// 실제 CUDA 추론 확인을 마친 후보만 새 설치 경로에 복사한다. 기존 설치는 덮어쓰지 않는다.
export async function installSpeechGpu(candidate, home) {
    if (!isAbsolute(candidate) || !isAbsolute(home)) throw new Error('Absolute candidate and home paths required');
    const receipt = JSON.parse(await readFile(join(candidate, 'verified.json'), 'utf8'));
    if (receipt.runtime !== GPU_RUNTIME_NAME || receipt.provider !== 'cuda' || !(receipt.gpuMemoryMiB > 0))
        throw new Error('Verified CUDA inference receipt required');
    if (receipt.fingerprint !== await runtimeFingerprint(candidate)) throw new Error('Verified GPU runtime changed');
    const config = JSON.parse(await readFile(join(home, 'config.json'), 'utf8'));
    if (!config.agents?.providers?.paseodog) throw new Error('Dedicated PaseoDog home required');
    const parent = join(home, 'speech-gpu');
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const target = join(parent, GPU_RUNTIME_NAME);
    await mkdir(target, { mode: 0o700 });
    for (const entry of await readdir(candidate)) {
        if (entry === 'upstream') continue;
        await cp(join(candidate, entry), join(target, entry), { recursive: true, force: false, errorOnExist: true });
    }
    if (receipt.fingerprint !== await runtimeFingerprint(target)) throw new Error('Installed GPU runtime verification failed');
    await writeFile(join(target, 'ready.json'), JSON.stringify({ schema: 1, runtime: GPU_RUNTIME_NAME }) + '\n',
        { flag: 'wx', mode: 0o600 });
    console.log(`Installed verified GPU runtime: ${target}; daemon unchanged`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const { values } = parseArgs({ options: {
            output: { type: 'string' }, cache: { type: 'string' }, install: { type: 'string' }, home: { type: 'string' },
        } });
        if (values.install) await installSpeechGpu(values.install, values.home);
        else await prepareSpeechGpu(values.output, values.cache);
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}

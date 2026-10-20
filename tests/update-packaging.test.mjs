import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { foreignRuntimePackages } = require('../android/packages/desktop/scripts/prune-foreign-runtime.cjs');

test('desktop packaging excludes only foreign Sherpa runtimes, preserving app resources and the target runtime', () => {
    const names = ['sherpa-onnx-linux-x64', 'sherpa-onnx-win-x64', 'sherpa-onnx-node', 'esbuild', 'assets'];
    assert.deepEqual(foreignRuntimePackages(names, 'win32', 'x64'), ['sherpa-onnx-linux-x64']);
    assert.deepEqual(foreignRuntimePackages(names, 'linux', 'x64'), ['sherpa-onnx-win-x64']);
    assert.throws(() => foreignRuntimePackages(names, 'unknown', 'x64'));
});

test('Android split configuration is idempotent and retains the compatibility APK', () => {
    const { addApkSplits } = require('../android/packages/app/plugins/with-android-apk-splits.js');
    const output = addApkSplits('android {\n}\n');
    assert.equal(addApkSplits(output), output);
    assert.match(output, /universalApk true/);
    assert.match(output, /reactNativeArchitectures/);
    assert.throws(() => addApkSplits('unreviewed'));
});

test('Android prebuild defaults reactNativeArchitectures to the S25 ABI', () => {
    const { setReactNativeArchitectures } = require('../android/packages/app/plugins/with-android-architectures.js');
    const template = [
        { type: 'comment', value: ' ./gradlew <task> -PreactNativeArchitectures=x86_64' },
        { type: 'property', key: 'reactNativeArchitectures', value: 'armeabi-v7a,arm64-v8a,x86,x86_64' },
    ];
    const output = setReactNativeArchitectures(template);
    assert.deepEqual(output.filter((row) => row.key === 'reactNativeArchitectures'), [
        { type: 'property', key: 'reactNativeArchitectures', value: 'arm64-v8a' },
    ]);
    assert.deepEqual(setReactNativeArchitectures([]), [
        { type: 'property', key: 'reactNativeArchitectures', value: 'arm64-v8a' },
    ]);
});

test('APK metadata derives sizes, hashes and ABIs from archives and rejects incomplete releases', () => {
    const result = spawnSync('python3', ['-c', `
import runpy, tempfile, zipfile, hashlib, subprocess, json
from pathlib import Path
manifest = runpy.run_path('scripts/android-update-manifest.py')['manifest']
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    abis = ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64']
    files = []
    for abi in abis + ['universal']:
        file = root / (abi + '.apk')
        with zipfile.ZipFile(file, 'w') as archive:
            for target in abis if abi == 'universal' else [abi]:
                archive.writestr('lib/' + target + '/libtest.so', b'test')
        files.append(file)
    value = manifest(42, 'test', 'test-42', files)
    assert len(value['artifacts']) == 4
    assert value['size'] == files[-1].stat().st_size
    assert value['sha256'] == hashlib.sha256(files[-1].read_bytes()).hexdigest()
    assert value['url'].endswith('/test-42/universal.apk')
    assert {row['abi'] for row in value['artifacts']} == set(abis)
    for index in range(len(files)):
        try:
            manifest(42, 'test', 'test-42', files[:index] + files[index + 1:])
        except ValueError:
            pass
        else:
            raise AssertionError('incomplete release accepted')
    for rejected in [[files[0]], files + [files[0]]]:
        try:
            manifest(42, 'test', 'test-42', rejected)
        except ValueError:
            pass
        else:
            raise AssertionError('incomplete or duplicate release accepted')

    value = manifest(42, 'test', 'test-42', [files[0]], target_abi='arm64-v8a')
    artifact = value['artifacts'][0]
    assert len(value['artifacts']) == 1
    assert artifact == {
        'abi': 'arm64-v8a',
        'url': 'https://github.com/moveju112/paseodog/releases/download/test-42/arm64-v8a.apk',
        'sha256': hashlib.sha256(files[0].read_bytes()).hexdigest(),
        'size': files[0].stat().st_size,
    }
    assert value == {'versionCode': 42, 'versionName': 'test',
                     **{key: artifact[key] for key in ['url', 'sha256', 'size']},
                     'artifacts': [artifact]}
    # 파일명이 아닌 실제 라이브러리 ABI와 명시된 단일 APK만 허용한다.
    disguised = root / 'disguised-arm64-v8a.apk'
    disguised.write_bytes(files[2].read_bytes())
    for rejected in [[], [files[1]], [files[2]], [files[3]], [files[-1]],
                     [disguised], [files[0], files[0]], [files[0], files[-1]], files]:
        try:
            manifest(42, 'test', 'test-42', rejected, target_abi='arm64-v8a')
        except ValueError:
            pass
        else:
            raise AssertionError('invalid targeted release accepted')
    output = root / 'update.json'
    command = ['python3', 'scripts/android-update-manifest.py', '--version-code', '42',
               '--version-name', 'test', '--tag', 'test-42', '--output', str(output),
               '--target-abi', 'arm64-v8a', str(files[0])]
    subprocess.run(command, check=True, capture_output=True)
    assert json.loads(output.read_text()) == value
    for target in ['x86', 'universal']:
        rejected = subprocess.run(
            [item if item != 'arm64-v8a' else target for item in command],
            capture_output=True)
        assert rejected.returncode != 0
`], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
});

import assert from 'node:assert/strict';
import { globSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
import { patchedExpoActivityResult } from '../scripts/patch-expo-activity-result.mjs';
import { EXPO_ACTIVITY_RESULT_FILE, withoutExpoActivityResult } from '../patches/expo-activity-result.mjs';

// Android 빌드의 Maven 캐시에서 고정 Kotlin 컴파일러와 명시된 런타임만 사용한다.
function jar(group, artifact, version) {
    const root = join(process.env.GRADLE_USER_HOME ?? join(homedir(), '.gradle'), 'caches/modules-2/files-2.1');
    const paths = [...globSync(`${group}/${artifact}/${version}/*/${artifact}-${version}.jar`, { cwd: root })];
    assert.equal(paths.length, 1, `Required Kotlin test dependency missing: ${group}:${artifact}:${version}`);
    return join(root, paths[0]);
}

const dependencies = [
    ['org.jetbrains.kotlin', 'kotlin-compiler-embeddable', '2.1.0'],
    ['org.jetbrains.kotlin', 'kotlin-stdlib', '2.1.0'],
    ['org.jetbrains.kotlin', 'kotlin-script-runtime', '2.1.0'],
    ['org.jetbrains.kotlin', 'kotlin-reflect', '1.6.10'],
    ['org.jetbrains.kotlin', 'kotlin-daemon-embeddable', '2.1.0'],
    ['org.jetbrains.intellij.deps', 'trove4j', '1.0.20200330'],
    ['org.jetbrains.kotlinx', 'kotlinx-coroutines-core-jvm', '1.6.4'],
    ['org.jetbrains', 'annotations', '13.0'],
].map((entry) => jar(...entry));
const classpath = dependencies.join(delimiter);
const original = withoutExpoActivityResult(readFileSync(new URL(
    `../android/node_modules/expo-modules-core/${EXPO_ACTIVITY_RESULT_FILE}`, import.meta.url), 'utf8'));
const harness = readFileSync(new URL('./fixtures/expo-activity-result-harness.kt', import.meta.url), 'utf8');
const temporary = mkdtempSync(join(tmpdir(), 'paseodog-activity-jvm-'));
try {
    for (const [label, source] of [['before', original], ['after', patchedExpoActivityResult(original)]]) {
        const fields = source.slice(source.indexOf('  private var hostWasDestroyed'), source.indexOf('\n\n', source.indexOf('  private var hostWasDestroyed')));
        const resume = source.slice(source.indexOf('  internal fun onHostResume()'), source.indexOf('  internal fun onHostPause()'));
        assert.ok(fields && resume);
        const file = join(temporary, 'Harness.kt');
        const output = join(temporary, `${label}.jar`);
        writeFileSync(file, harness.replace('  // FIELDS', fields).replace('  // RESUME', resume));
        const compile = spawnSync('java', ['-cp', classpath, 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler',
            '-no-stdlib', '-no-reflect', '-classpath', classpath, '-d', output, file], { encoding: 'utf8', timeout: 60000 });
        assert.equal(compile.status, 0, compile.stderr);
        const run = spawnSync('java', ['-cp', [output, dependencies[1]].join(delimiter), 'HarnessKt'],
            { encoding: 'utf8', timeout: 10000 });
        if (label === 'before') {
            assert.notEqual(run.status, 0);
            assert.match(run.stderr, /Configuration relaunch did not register the new Activity/);
            console.log('Original Expo code reproduces configuration relaunch failure');
        } else {
            assert.equal(run.status, 0, run.stderr);
            process.stdout.write(run.stdout);
        }
    }
} finally {
    rmSync(temporary, { recursive: true, force: true });
}

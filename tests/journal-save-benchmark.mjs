import assert from 'node:assert/strict';
import { scratchPath } from '../scripts/paths.mjs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { copyFile, cp, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const script = fileURLToPath(import.meta.url);
const project = fileURLToPath(new URL('../', import.meta.url));
const execute = promisify(execFile);
const { values } = parseArgs({ options: {
    worker: { type: 'boolean' }, root: { type: 'string' }, baseline: { type: 'string' },
    journals: { type: 'string' }, corpus: { type: 'string' }, clock: { type: 'string' },
    trials: { type: 'string', default: '4' },
} });

function percentile(numbers, fraction) {
    const sorted = [...numbers].sort((a, b) => a - b);
    return sorted[Math.ceil(sorted.length * fraction) - 1];
}

async function corpusDigest(root, files) {
    const digest = createHash('sha256');
    for (const file of files) {
        digest.update(file);
        digest.update(await readFile(join(root, file)));
    }
    return digest.digest('hex');
}

async function runWorker() {
    const setupStarted = performance.now();
    const { JournalStore } = await import(pathToFileURL(join(values.root, 'plugin/server/journal.mjs')));
    const output = await mkdtemp(scratchPath('paseodog-journal-save-run-'));
    try {
        // 기존 파일을 덮어쓰는 실제 저장 경로를 사용하되 운영 데이터는 절대 수정하지 않는다.
        await cp(values.corpus, output, { recursive: true });
        const input = new JournalStore(values.corpus);
        const store = new JournalStore(output);
        const files = (await readdir(values.corpus)).sort();
        const clock = Number(values.clock);
        assert.ok(Number.isSafeInteger(clock));
        Date.now = () => clock;
        const initializationMs = performance.now() - setupStarted;
        const measurements = [];
        const digest = createHash('sha256');
        let inputPreparationMs = 0, validationMs = 0;
        const workloadStarted = process.cpuUsage();
        for (const file of files) {
            const preparing = performance.now();
            const record = input.load(file.slice(0, -5));
            inputPreparationMs += performance.now() - preparing;
            const cpuStarted = process.cpuUsage();
            const started = performance.now();
            store.save(record);
            const wallMs = performance.now() - started;
            const cpu = process.cpuUsage(cpuStarted);
            measurements.push({ wallMs, cpuMs: (cpu.user + cpu.system) / 1000 });
            const validating = performance.now();
            digest.update(file);
            digest.update(await readFile(join(output, file)));
            validationMs += performance.now() - validating;
        }
        const workloadCpu = process.cpuUsage(workloadStarted);
        return {
            initializationMs, inputPreparationMs, validationMs, saves: files.length,
            workloadCpuMs: (workloadCpu.user + workloadCpu.system) / 1000,
            wallTotalMs: measurements.reduce((sum, row) => sum + row.wallMs, 0),
            wallP50Ms: percentile(measurements.map((row) => row.wallMs), 0.5),
            wallP95Ms: percentile(measurements.map((row) => row.wallMs), 0.95),
            cpuTotalMs: measurements.reduce((sum, row) => sum + row.cpuMs, 0),
            peakRssMiB: process.resourceUsage().maxRSS / 1024,
            rssEndMiB: process.memoryUsage().rss / 1024 ** 2,
            outputHash: digest.digest('hex'),
        };
    } finally { await rm(output, { recursive: true, force: true }); }
}

async function runComparison() {
    assert.ok(values.baseline && values.journals, '--baseline and --journals are required');
    const trials = Number(values.trials);
    assert.ok(Number.isInteger(trials) && trials >= 2);
    const journals = resolve(values.journals);
    const baseline = resolve(values.baseline);
    const setupStarted = performance.now();
    const snapshot = await mkdtemp(scratchPath('paseodog-journal-save-corpus-'));
    try {
        const files = (await readdir(journals, { withFileTypes: true }))
            .filter((entry) => entry.isFile() && /^[a-zA-Z0-9_-]+\.json$/.test(entry.name))
            .map((entry) => entry.name).sort();
        assert.ok(files.length > 0);
        let bytes = 0;
        for (const file of files) {
            await copyFile(join(journals, file), join(snapshot, file));
            bytes += (await stat(join(snapshot, file))).size;
        }
        const inputHash = await corpusDigest(snapshot, files);
        const setupMs = performance.now() - setupStarted;
        const clock = Date.now();
        const runs = { baseline: [], candidate: [] };
        let expected;
        for (let trial = 0; trial < trials; trial++) {
            const order = trial % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
            for (const variant of order) {
                const { stdout } = await execute(process.execPath, [script, '--worker',
                    '--root', variant === 'baseline' ? baseline : project,
                    '--corpus', snapshot, '--clock', String(clock)],
                { timeout: 180000, maxBuffer: 1024 * 1024 });
                const result = JSON.parse(stdout);
                assert.equal(result.saves, files.length);
                if (expected === undefined) expected = result.outputHash;
                assert.equal(result.outputHash, expected, 'Saved journal bytes differ from the baseline');
                delete result.outputHash;
                runs[variant].push(result);
            }
        }
        assert.equal(await corpusDigest(snapshot, files), inputHash, 'Benchmark changed its input corpus');
        const median = (variant, key) => percentile(runs[variant].map((run) => run[key]), 0.5);
        const summary = Object.fromEntries(['baseline', 'candidate'].map((variant) => [variant,
            Object.fromEntries(['initializationMs', 'inputPreparationMs', 'validationMs', 'wallTotalMs',
                'wallP50Ms', 'wallP95Ms', 'cpuTotalMs', 'workloadCpuMs', 'peakRssMiB', 'rssEndMiB']
                .map((key) => [key, median(variant, key)]))]));
        console.log(JSON.stringify({
            setupMs, journalCount: files.length, journalMiB: bytes / 1024 ** 2, trials,
            writesPerVariant: files.length * trials, byteIdentical: true, corpusUnchanged: true,
            durability: 'unchanged atomic rename and file/directory fsync',
            summary, runs,
        }, null, 2));
    } finally { await rm(snapshot, { recursive: true, force: true }); }
}

try {
    if (values.worker) console.log(JSON.stringify(await runWorker()));
    else {
        const { withTestLock } = await import('../scripts/test.mjs');
        await withTestLock(runComparison);
    }
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}

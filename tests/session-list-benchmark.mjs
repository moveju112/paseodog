import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';

// 실제 저널은 비공개 임시 복사본으로만 측정하고 내용 대신 응답 해시와 자원 지표를 출력한다.
const script = fileURLToPath(import.meta.url);
const project = fileURLToPath(new URL('../', import.meta.url));
const execute = promisify(execFile);
const { values } = parseArgs({ options: {
    worker: { type: 'boolean' }, root: { type: 'string' }, baseline: { type: 'string' },
    journals: { type: 'string' }, iterations: { type: 'string', default: '20' },
    trials: { type: 'string', default: '4' },
} });
const iterations = Number(values.iterations);
assert.ok(Number.isInteger(iterations) && iterations >= 5);

function percentile(numbers, fraction) {
    const sorted = [...numbers].sort((a, b) => a - b);
    return sorted[Math.ceil(sorted.length * fraction) - 1];
}

async function runWorker() {
    const setupStarted = performance.now();
    const { JournalStore } = await import(pathToFileURL(join(values.root, 'plugin/server/journal.mjs')));
    const { createProviderConnection } = await import(pathToFileURL(join(values.root, 'plugin/server/connection.mjs')));
    const store = new JournalStore(values.journals);
    const connection = createProviderConnection({ store, engineFactory: {
        create() { throw new Error('Session-list benchmark must not create an engine'); },
    } });
    let sequence = 0;
    const pending = new Map();
    connection.onEvent((event) => {
        const complete = pending.get(event.requestId);
        if (complete) { pending.delete(event.requestId); complete(event); }
    });
    async function measure(options) {
        const started = performance.now();
        const pulse = new Promise((done) => setTimeout(() => done(performance.now() - started), 0));
        const cpuStarted = process.cpuUsage();
        const requestId = String(++sequence);
        const response = new Promise((done) => pending.set(requestId, done));
        await connection.send({ type: 'sessions', requestId, ...options });
        const event = await response;
        assert.equal(event.type, 'sessions');
        const encoded = JSON.stringify(event.sessions);
        const wallMs = performance.now() - started;
        const cpu = process.cpuUsage(cpuStarted);
        const eventLoopDelayMs = await pulse;
        return { wallMs, cpuMs: (cpu.user + cpu.system) / 1000, eventLoopDelayMs,
            outputHash: createHash('sha256').update(encoded).digest('hex'), sessions: event.sessions };
    }
    const setupMs = performance.now() - setupStarted;
    const rssStartMiB = process.memoryUsage().rss / 1024 ** 2;
    try {
        const cold = await measure({});
        assert.ok(cold.sessions.length > 0, 'Benchmark needs a non-empty journal corpus');
        const first = cold.sessions[0];
        const queries = [{}, { limit: 1 }, { limit: 100 }, { cwd: first.cwd }, { query: first.title.slice(0, 8) }];
        const warm = [];
        for (let index = 0; index < iterations; index++) {
            const result = await measure(queries[index % queries.length]);
            const { sessions, ...metrics } = result;
            warm.push(metrics);
        }
        const { sessions, ...coldMetrics } = cold;
        return { setupMs, rssStartMiB, cold: coldMetrics,
            warm: {
                wallP50Ms: percentile(warm.map((row) => row.wallMs), 0.5),
                wallP95Ms: percentile(warm.map((row) => row.wallMs), 0.95),
                cpuTotalMs: warm.reduce((sum, row) => sum + row.cpuMs, 0),
                eventLoopDelayP95Ms: percentile(warm.map((row) => row.eventLoopDelayMs), 0.95),
                outputHashes: warm.map((row) => row.outputHash),
            },
            peakRssMiB: process.resourceUsage().maxRSS / 1024,
            rssEndMiB: process.memoryUsage().rss / 1024 ** 2 };
    } finally { await connection.close(); }
}

async function corpusDigest(root, files) {
    const digest = createHash('sha256');
    for (const file of files) {
        digest.update(file);
        digest.update(await readFile(join(root, file)));
    }
    return digest.digest('hex');
}

async function runComparison() {
    assert.ok(values.baseline && values.journals, '--baseline and --journals are required');
    const trials = Number(values.trials);
    assert.ok(Number.isInteger(trials) && trials >= 2);
    const baseline = resolve(values.baseline);
    const journals = resolve(values.journals);
    const setupStarted = performance.now();
    const snapshot = await mkdtemp('/data/tmp/ubuntu/paseodog-list-corpus-');
    try {
        const files = (await readdir(journals, { withFileTypes: true }))
            .filter((entry) => entry.isFile() && /^[a-zA-Z0-9_-]+\.json$/.test(entry.name))
            .map((entry) => entry.name).sort();
        let bytes = 0;
        for (const file of files) {
            await copyFile(join(journals, file), join(snapshot, file));
            bytes += (await stat(join(snapshot, file))).size;
        }
        const digest = await corpusDigest(snapshot, files);
        const setupMs = performance.now() - setupStarted;
        const runs = { baseline: [], candidate: [] };
        let expected;
        for (let trial = 0; trial < trials; trial++) {
            const order = trial % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
            for (const variant of order) {
                const { stdout } = await execute(process.execPath, [script, '--worker',
                    '--root', variant === 'baseline' ? baseline : project,
                    '--journals', snapshot, '--iterations', String(iterations)],
                { timeout: 120000, maxBuffer: 1024 * 1024 });
                const result = JSON.parse(stdout);
                const hashes = [result.cold.outputHash, ...result.warm.outputHashes];
                if (!expected) expected = hashes;
                assert.deepEqual(hashes, expected, 'Baseline and candidate session responses differ');
                delete result.cold.outputHash;
                delete result.warm.outputHashes;
                runs[variant].push(result);
            }
        }
        assert.equal(await corpusDigest(snapshot, files), digest, 'Benchmark changed its journal corpus');
        const median = (variant, select) => percentile(runs[variant].map(select), 0.5);
        const summary = Object.fromEntries(['baseline', 'candidate'].map((variant) => [variant, {
            setupMs: median(variant, (row) => row.setupMs),
            coldWallMs: median(variant, (row) => row.cold.wallMs),
            coldCpuMs: median(variant, (row) => row.cold.cpuMs),
            warmWallP50Ms: median(variant, (row) => row.warm.wallP50Ms),
            warmWallP95Ms: median(variant, (row) => row.warm.wallP95Ms),
            warmCpuPerRequestMs: median(variant, (row) => row.warm.cpuTotalMs / iterations),
            warmEventLoopDelayP95Ms: median(variant, (row) => row.warm.eventLoopDelayP95Ms),
            peakRssMiB: median(variant, (row) => row.peakRssMiB),
            rssEndMiB: median(variant, (row) => row.rssEndMiB),
        }]));
        console.log(JSON.stringify({ setupMs, journalCount: files.length, journalMiB: bytes / 1024 ** 2,
            trials, iterations, queryVariants: 5, responsesIdentical: true, corpusUnchanged: true,
            coldMeaning: 'first request in a fresh process; filesystem cache is warm',
            summary, runs }, null, 2));
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

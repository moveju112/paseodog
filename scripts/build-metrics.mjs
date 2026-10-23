import { appendFile } from 'node:fs/promises';

export async function measureBuildStep(name, run, file = process.env.PASEODOG_RELEASE_METRICS) {
    const started = performance.now();
    const cpu = process.cpuUsage();
    let status = 'failed';
    try {
        const value = await run();
        status = 'complete';
        return value;
    } finally {
        const used = process.cpuUsage(cpu);
        const row = { name, status, elapsedMs: Math.round(performance.now() - started),
            cpuMs: Math.round((used.user + used.system) / 1000), rssBytes: process.memoryUsage().rss };
        console.log('[build-metrics] ' + JSON.stringify(row));
        if (file) await appendFile(file, JSON.stringify(row) + '\n', { mode: 0o600 });
    }
}

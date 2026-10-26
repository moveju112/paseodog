#!/usr/bin/env node
// 다른 모듈을 불러오기 전에 부모를 기록해 시작 중 데몬 종료도 감지한다.
const parentAtStart = process.ppid;
import { VERSION } from '../../plugin/server/util.mjs';
if (process.argv.includes('--version')) { console.log(VERSION); process.exit(0); }
if (process.argv.includes('--check')) {
    const { patch } = await import('../../scripts/patch-mixdog.mjs');
    const { supportedNode } = await import('../../scripts/paths.mjs');
    const { fileURLToPath } = await import('node:url');
    if (!supportedNode()) { console.error('Unsupported Node version'); process.exit(1); }
    try {
        const result = patch(fileURLToPath(new URL('../node_modules/mixdog', import.meta.url)), { check: true });
        console.log(JSON.stringify({ version: VERSION, native: result }));
    } catch (error) { console.error(error.message); process.exit(1); }
    process.exit(0);
}
if (process.argv.includes('--controls-stdio')) {
    const wire = { write: process.stdout.write.bind(process.stdout) };
    process.stdout.write = process.stderr.write.bind(process.stderr);
    console.log = console.error;
    const { serveControlsStdio } = await import('../src/controls.mjs');
    const server = serveControlsStdio({ input: process.stdin, output: wire, onExit: () => process.exit(0) });
    const { watchParent, ownerFromEnv } = await import('../src/parent-watch.mjs');
    watchParent(() => server.stop(), { initial: parentAtStart, owner: ownerFromEnv() });
    process.on('SIGINT', () => void server.stop());
    process.on('SIGTERM', () => void server.stop());
    process.on('uncaughtException', () => void server.stop());
    process.on('unhandledRejection', () => void server.stop());
} else if (process.argv.includes('--controls')) {
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = process.stderr.write.bind(process.stderr);
    console.log = console.error;
    try {
        const { runControls } = await import('../src/controls.mjs');
        const result = await runControls(JSON.parse(process.argv[process.argv.indexOf('--controls') + 1] || '{}'));
        write(`${JSON.stringify(result)}\n`);
        process.exit(0);
    } catch {
        write(`${JSON.stringify({ error: 'Engine settings failed; inspect local engine diagnostics' })}\n`);
        process.exit(1);
    }
} else {
if (!process.argv.includes('--stdio')) { console.error('Use paseo/paseodog to launch this worker; --stdio required.'); process.exit(2); }
// Capture the wire before redirecting third-party console/stdout diagnostics.
// Mixdog must not corrupt the JSONL channel with startup logs.
const wire = { write: process.stdout.write.bind(process.stdout) };
process.stdout.write = process.stderr.write.bind(process.stderr);
console.log = console.error;
const { serveWorker } = await import('../src/worker.mjs');
const server = serveWorker({ input: process.stdin, output: wire, onExit: () => process.exit(0) });
const { watchParent, ownerFromEnv } = await import('../src/parent-watch.mjs');
watchParent((reason) => server.stop(reason), { initial: parentAtStart, owner: ownerFromEnv() });
process.on('SIGINT', () => void server.stop('sigint'));
process.on('SIGTERM', () => void server.stop('sigterm'));
    process.on('uncaughtException', (e) => { console.error(e.message); void server.stop('uncaught exception'); });
    process.on('unhandledRejection', (e) => { console.error(String(e)); void server.stop('unhandled rejection'); });
}

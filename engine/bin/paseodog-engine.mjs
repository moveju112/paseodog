#!/usr/bin/env node
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
if (!process.argv.includes('--stdio')) { console.error('Use paseo/paseodog to launch this worker; --stdio required.'); process.exit(2); }
// Capture the wire before redirecting third-party console/stdout diagnostics.
// Mixdog must not corrupt the JSONL channel with startup logs.
const wire = { write: process.stdout.write.bind(process.stdout) };
process.stdout.write = process.stderr.write.bind(process.stderr);
console.log = console.error;
const { serveWorker } = await import('../src/worker.mjs');
const server = serveWorker({ input: process.stdin, output: wire, onExit: () => process.exit(0) });
process.on('SIGINT', () => void server.stop('sigint'));
process.on('SIGTERM', () => void server.stop('sigterm'));
process.on('uncaughtException', (e) => { console.error(e.message); void server.stop('uncaught exception'); });
process.on('unhandledRejection', (e) => { console.error(String(e)); void server.stop('unhandled rejection'); });

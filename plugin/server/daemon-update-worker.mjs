import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeDaemonUpdate } from './daemon-update.mjs';

async function main() {
    if (process.argv.length !== 4 || process.argv[2] !== '--execute' || !isAbsolute(process.argv[3]))
        throw new Error('Expected --execute <absolute dedicated update directory>');
    await executeDaemonUpdate(process.argv[3]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(() => {
        console.error('Daemon update failed; inspect the local service and persisted receipt');
        process.exitCode = 1;
    });
}

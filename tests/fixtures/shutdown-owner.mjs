import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createProviderConnection } from '../../plugin/server/connection.mjs';
import { processEngineFactory } from '../../plugin/server/process-engine.mjs';
import { MemoryJournalStore } from '../../plugin/server/journal.mjs';

const logPath = process.argv[2];
const directory = dirname(logPath);
const record = event => appendFileSync(logPath, JSON.stringify(event) + '\n');
const factory = processEngineFactory({
    launch: {
        command: process.execPath,
        args: [fileURLToPath(new URL('./worker-fixture.mjs', import.meta.url))],
        env: { ...process.env, PASEODOG_HOME: directory, PASEO_HOME: join(directory, 'paseo'),
            MIXDOG_HOME: join(directory, 'mixdog'), PASEODOG_STATE_DIR: join(directory, 'sessions') },
    },
    spawnProcess: spawn, terminateProcess: child => child.kill('SIGKILL'),
    timeoutMs: 2500, stopMs: 2000,
});
const connection = createProviderConnection({ store: new MemoryJournalStore(), engineFactory: factory, stopMs: 4000 });
connection.onEvent(record);
process.once('SIGTERM', async () => {
    record({ type: 'owner.stop' });
    try {
        await connection.close();
        record({ type: 'owner.stopped' });
        process.exit(0);
    } catch {
        record({ type: 'owner.failed' });
        process.exit(1);
    }
});
await connection.send({
    type: 'session.open', requestId: 'open', sessionId: 'systemd-test', history: 'skip',
    config: { cwd: directory, env: {}, mcpServers: {}, settings: {}, persist: true },
});

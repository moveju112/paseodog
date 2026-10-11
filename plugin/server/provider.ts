import { negotiateProviderCapabilities, type ProviderRegistration, type ProviderConnection } from '@getpaseo/plugin/server/provider';
import { spawnProcess, execCommand, terminateProcess } from '@getpaseo/plugin/server';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createProviderConnection, CAPABILITIES } from './connection.mjs';
import { processEngineFactory } from './process-engine.mjs';
import { JournalStore } from './journal.mjs';

export function createMixdogProvider(): ProviderRegistration {
    return {
        id: 'paseodog', label: 'PaseoDog', command: ['paseodog-engine'],
        description: 'Mixdog coding engine with durable Linux sessions and explicit tool approvals',
        async status({ launch }) {
            if (!launch) return { available: false, diagnostic: 'Install PaseoDog engine and configure its absolute executable path' };
            try {
                const result = await execCommand(launch.command, [...launch.args, '--check'], { env: launch.env, timeout: 5000 });
                if (!result.stdout.includes('1.0.0-rc.1')) return { available: false, diagnostic: 'PaseoDog engine version mismatch' };
                return { available: true };
            } catch { return { available: false, diagnostic: 'Engine unavailable; run paseodog doctor' }; }
        },
        async connect(request) {
            if (!request.versions.includes(1)) throw new Error('Paseo provider protocol v1 required');
            const capabilities = negotiateProviderCapabilities(request.capabilities, CAPABILITIES);
            const env = request.launch?.env || {};
            const root = env.PASEODOG_STATE_DIR || join(homedir(), '.local', 'state', 'paseodog', 'sessions');
            return createProviderConnection({ capabilities, env, store: new JournalStore(root),
                engineFactory: processEngineFactory({ launch: request.launch, spawnProcess, terminateProcess }),
            }) as ProviderConnection;
        },
    };
}

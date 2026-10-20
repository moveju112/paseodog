import { negotiateProviderCapabilities, type ProviderRegistration, type ProviderConnection } from '@getpaseo/plugin/server/provider';
import { spawnProcess, execCommand, terminateProcess } from '@getpaseo/plugin/server';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createProviderConnection, CAPABILITIES } from './connection.mjs';
import { processEngineFactory } from './process-engine.mjs';
import { JournalStore } from './journal.mjs';
import { VERSION } from './util.mjs';

export function createMixdogProvider(controls?: {
    bind(launch: unknown): void;
    read(request?: unknown): Promise<any>;
    register(connection: any): () => void;
}): ProviderRegistration {
    return {
        id: 'paseodog', label: 'PaseoDog', command: ['paseodog-engine'],
        description: 'Mixdog coding engine with durable Linux sessions and explicit tool approvals',
        async getCatalogCacheKey({ launch }) {
            if (!controls) return undefined;
            controls.bind(launch);
            const snapshot = await controls.read();
            return JSON.stringify({ route: snapshot.route, models: snapshot.models });
        },
        async status({ launch }) {
            controls?.bind(launch);
            if (!launch) return { available: false, diagnostic: 'Install PaseoDog engine and configure its absolute executable path' };
            try {
                const result = await execCommand(launch.command, [...launch.args, '--check'], { env: launch.env, timeout: 5000 });
                if (JSON.parse(result.stdout).version !== VERSION) return { available: false, diagnostic: 'PaseoDog engine version mismatch' };
                return { available: true };
            } catch { return { available: false, diagnostic: 'Engine unavailable; run paseodog doctor' }; }
        },
        async connect(request) {
            controls?.bind(request.launch);
            if (!request.versions.includes(1)) throw new Error('Paseo provider protocol v1 required');
            const capabilities = negotiateProviderCapabilities(request.capabilities, CAPABILITIES);
            const env = request.launch?.env || {};
            const root = env.PASEODOG_STATE_DIR || join(homedir(), '.local', 'state', 'paseodog', 'sessions');
            const connection = createProviderConnection({ capabilities: [...capabilities], env, store: new JournalStore(root),
                loadCatalog: controls ? () => controls.read() : undefined,
                engineFactory: processEngineFactory({ launch: request.launch, spawnProcess, terminateProcess }),
            });
            const unregister = controls?.register(connection);
            const close = connection.close.bind(connection);
            connection.close = async () => { try { await close(); } finally { unregister?.(); } };
            return connection as ProviderConnection;
        },
    };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { COMPOSER_FILE, patchedComposerSource } from '../scripts/patch-paseo-composer.mjs';
import { RELAY_PASSWORD_PATCHES, patchedRelayPasswordSource } from '../scripts/patch-paseo-relay-password.mjs';
import { withSessionRecovery, withoutSessionRecovery } from '../patches/paseo-session-recovery.mjs';

const packages = new URL('../tools/node_modules/@getpaseo/', import.meta.url);
const bundle = withoutSessionRecovery(readFileSync(new URL(`server/${COMPOSER_FILE}`, packages), 'utf8'));
const readPatched = (file) => {
    const spec = RELAY_PASSWORD_PATCHES.find((entry) => entry.file === file);
    return patchedRelayPasswordSource(readFileSync(new URL(`${spec.package}/${file}`, packages), 'utf8'), spec);
};

function method(source, name, next) {
    const start = source.search(new RegExp(`\\b${name}\\(\\)\\s*\\{`));
    assert.ok(start >= 0);
    const end = start + source.slice(start).search(new RegExp(`\\b${next}\\s*\\(`));
    assert.ok(end > start);
    return source.slice(start, end).replace(/private\s*$/, '');
}

function recoveryClient(source) {
    const methods = method(source, 'verifyConnection', 'getConnectionState')
        + method(source, 'scheduleNextLivenessHeartbeat', 'observe');
    const Client = new Function(`const LIVENESS_HEARTBEAT_TIMEOUT_MS=15000,LIVENESS_HEARTBEAT_INTERVAL_MS=10000;
        return class { ${methods} }`)();
    const client = new Client();
    Object.assign(client, {
        transport: {}, connectionState: { status: 'connected' }, connectionVerification: null,
        consecutiveLivenessFailures: 1, livenessHeartbeatTimer: null,
        stopLivenessHeartbeat() { clearTimeout(this.livenessHeartbeatTimer); this.livenessHeartbeatTimer = null; },
        rejectPingProbe() { this.probeCancelled = true; },
        ping({ timeoutMs }) {
            this.probes = (this.probes ?? 0) + 1;
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('probe timeout')), timeoutMs);
                this.answer = () => { clearTimeout(timer); resolve(); };
            });
        },
        disposeTransport() { this.transport = null; this.closed = true; },
        scheduleReconnect() { this.connectionState = { status: 'disconnected' }; },
        ensureConnected() { this.reconnecting = true; },
        livenessPing() { this.heartbeatResumed = true; return Promise.resolve(1); },
    });
    return client;
}

const native = stripTypeScriptTypes(readFileSync(
    new URL('../android/packages/client/src/daemon-client.ts', import.meta.url), 'utf8'), { mode: 'transform' });
const sources = [
    ['native', native],
    ['installed SDK', readPatched('dist/daemon-client.js')],
    ['web', withSessionRecovery(bundle)],
];
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

for (const [platform, source] of sources) {
    test(`${platform}: a slow healthy foreground response keeps its socket and restarts heartbeats`, async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const client = recoveryClient(source);
        const socket = client.transport;
        client.verifyConnection();
        client.verifyConnection();
        assert.equal(client.probes, 1);
        assert.equal(client.probeCancelled, true);
        assert.equal(client.consecutiveLivenessFailures, 0);
        client.scheduleNextLivenessHeartbeat();
        assert.equal(client.livenessHeartbeatTimer, null);
        t.mock.timers.tick(5500);
        assert.equal(client.closed, undefined);
        client.answer();
        await flush();
        assert.equal(client.transport, socket);
        t.mock.timers.tick(10_000);
        await flush();
        assert.equal(client.heartbeatResumed, true);
    });

    test(`${platform}: a silent socket is replaced at 15 seconds, not retained for 30 minutes`, async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const client = recoveryClient(source);
        client.verifyConnection();
        t.mock.timers.tick(14_999);
        await flush();
        assert.equal(client.closed, undefined);
        t.mock.timers.tick(1);
        await flush();
        assert.equal(client.closed, true);
        assert.equal(client.reconnecting, true);
    });
}

test('the daemon source and installed patch retain detached sessions for exactly 30 minutes', () => {
    for (const source of [
        readFileSync(new URL('../android/packages/server/src/server/websocket-server.ts', import.meta.url), 'utf8'),
        readPatched('dist/server/server/websocket-server.js'),
    ]) {
        const expression = source.match(/const EXTERNAL_SESSION_DISCONNECT_GRACE_MS = ([^;]+);/)[1];
        assert.equal(new Function(`return ${expression}`)(), 1_800_000);
    }
});

test('web recovery is reversible, idempotent and remains inside the full blob gate', () => {
    const patched = withSessionRecovery(bundle);
    assert.equal(withSessionRecovery(patched), patched);
    assert.equal(withoutSessionRecovery(patched), bundle);
    assert.throws(() => withoutSessionRecovery(patched.replace('timeoutMs:15e3}).catch', 'timeoutMs:14e3}).catch')), /Partial/);
    const full = patchedComposerSource(bundle);
    assert.equal(patchedComposerSource(full), full);
    assert.ok(full.includes('this.rejectPingProbe(new Error("Connection verification started"))'));
    assert.throws(() => patchedComposerSource(`${full}\n// unexpected bytes`), /hash mismatch/);
});

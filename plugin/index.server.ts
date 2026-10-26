import type { PluginServerContext } from '@getpaseo/plugin/server';
import { createMixdogProvider } from './server/provider.js';
import { execCommand, spawnProcess, terminateProcess } from '@getpaseo/plugin/server';
import { createEngineControls } from './server/controls.mjs';
import { engineControls, engineStatus, engineAuth, engineMetrics, nativeConfigView, engineSession, engineResources, engineTitle } from './shared/controls.js';
import { createClaudeUsageSource, createCodexUsageSource } from './server/usage.js';
import { readNativeConfig } from './server/native-config.mjs';
import { clientErrors } from './shared/client-errors.js';
import { createClientErrorCollector } from './server/client-errors.mjs';
import { daemonRelease } from './shared/controls.js';
import { DAEMON_RELEASE } from './server/util.mjs';
import { agentMessagePolicy } from './shared/message-policy.js';
// 전용 엔진의 설정과 현재 세션 상태를 Paseo 플러그인 RPC에 연결한다.
export default function contribute(server: PluginServerContext) {
    server.handle(daemonRelease, () => DAEMON_RELEASE);
    const controls = createEngineControls({ execCommand, spawnProcess, terminateProcess });
    server.handle(agentMessagePolicy, ({ action, ...request }) =>
        controls.read({ ...request, action: 'messagePolicy', operation: action }));
    const clientErrorCollector = createClientErrorCollector();
    server.handle(clientErrors, (request) => clientErrorCollector.handle(request));
    server.registerUsageSource(createClaudeUsageSource(controls));
    server.registerUsageSource(createCodexUsageSource(controls));
    server.handle(engineTitle, (request) => controls.read({ ...request, action: 'title' }));
    server.handle(engineAuth, (request) => controls.auth(request));
    server.handle(engineSession, (request) => controls.sessionAction(request));
    server.handle(engineResources, (request) => controls.read({ action: 'resources', ...request }));
    server.handle(engineStatus, async () => ({ sessions: await controls.sessions(), observedAt: Date.now() }));
    server.handle(engineMetrics, (request) => controls.metrics(request));
    server.handle(nativeConfigView, (request) => readNativeConfig(request));
    server.handle(engineControls, async (request) => {
        const snapshot = await controls.read(request);
        const mutation = Boolean(request?.action && request.action !== 'read');
        return {
            ...snapshot,
            sessions: mutation ? controls.peekSessions() : await controls.sessions(),
        };
    });
    server.registerProvider(createMixdogProvider(controls));
    return () => { controls.close(); void clientErrorCollector.close(); };
}

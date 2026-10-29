import type { PluginServerContext } from '@getpaseo/plugin/server';
import { createMixdogProvider } from './server/provider.js';
import { execCommand, spawnProcess, terminateProcess } from '@getpaseo/plugin/server';
import { createEngineControls } from './server/controls.mjs';
import { engineControls, engineStatus, engineAuth, engineMetrics, nativeConfigView, engineSession, engineResources, engineTitle } from './shared/controls.js';
import { createClaudeUsageSource, createCodexUsageSource } from './server/usage.js';
import { readNativeConfig } from './server/native-config.mjs';
import { clientErrors } from './shared/client-errors.js';
import { createClientErrorCollector } from './server/client-errors.mjs';
import { daemonRelease, daemonUpdate } from './shared/controls.js';
import { DAEMON_RELEASE } from './server/util.mjs';
import { createDaemonUpdater } from './server/daemon-update.mjs';
import { agentMessagePolicy } from './shared/message-policy.js';
import { scheduleTurnRecovery } from './server/turn-recovery.mjs';
import { scheduleDeliveryReports } from './server/delivery-notifications.mjs';
import { createBackgroundResults } from './server/background-results.mjs';
import { backgroundResults } from './shared/background-results.js';
import { join } from 'node:path';
import { speechSettings } from './shared/speech-settings.js';
import { handleSpeechSettings } from './server/speech-settings.mjs';
// 전용 엔진의 설정과 현재 세션 상태를 Paseo 플러그인 RPC에 연결한다.
export default function contribute(server: PluginServerContext) {
    server.handle(speechSettings, request => handleSpeechSettings(request));
    server.handle(daemonRelease, () => DAEMON_RELEASE);
    const updater = createDaemonUpdater({ versionCode: DAEMON_RELEASE.versionCode });
    server.handle(daemonUpdate, request => request.action === 'status' ? updater.status() : updater.request(request));
    const controls = createEngineControls({ execCommand, spawnProcess, terminateProcess });
    const resultService = process.env.PASEODOG_STATE_DIR && process.env.PASEO_HOME && process.env.MIXDOG_HOME
        ? createBackgroundResults({ stateRoot: process.env.PASEODOG_STATE_DIR, paseoHome: process.env.PASEO_HOME,
            dataRoot: process.env.MIXDOG_DATA_DIR || join(process.env.MIXDOG_HOME, 'data'), controls }) : null;
    server.handle(backgroundResults, request => {
        if (!resultService) throw new Error('Dedicated background result service is unavailable');
        return resultService.request(request);
    });
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
    // 데몬 재시작으로 중단된 턴은 시작 후 한 번만 이어가기 지시를 보낸다.
    const stopRecovery = scheduleTurnRecovery();
    const stopDeliveryReports = scheduleDeliveryReports();
    const stopResults = resultService?.start();
    return () => { stopResults?.(); stopRecovery(); stopDeliveryReports(); controls.close(); void clientErrorCollector.close(); };
}

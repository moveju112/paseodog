import type { PluginServerContext } from '@getpaseo/plugin/server';
import { createMixdogProvider } from './server/provider.js';
import { execCommand, spawnProcess, terminateProcess } from '@getpaseo/plugin/server';
import { createEngineControls } from './server/controls.mjs';
import { engineControls, engineStatus, engineAuth } from './shared/controls.js';
// 전용 엔진의 설정과 현재 세션 상태를 Paseo 플러그인 RPC에 연결한다.
export default function contribute(server: PluginServerContext) {
    const controls = createEngineControls({ execCommand, spawnProcess, terminateProcess });
    server.handle(engineAuth, (request) => controls.auth(request));
    server.handle(engineStatus, async () => ({ sessions: await controls.sessions(), observedAt: Date.now() }));
    server.handle(engineControls, async (request) => {
        const snapshot = await controls.read(request);
        const mutation = Boolean(request?.action && request.action !== 'read');
        return {
            ...snapshot,
            sessions: mutation ? controls.peekSessions() : await controls.sessions(),
        };
    });
    server.registerProvider(createMixdogProvider(controls));
    return () => controls.close();
}

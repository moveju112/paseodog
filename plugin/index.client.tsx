import type { PluginClientContext } from '@getpaseo/plugin/client';
import { LiveStatus } from './client/live-status.js';
import { AnalysisFooter } from './client/analysis-footer.js';
import { NativeConfigView } from './client/native-config.js';
import { SessionTools } from './client/session-tools.js';

// 설정은 앱의 기본 호스트 설정에서만 제공한다. 플러그인은 진단·세션 도구만 등록한다.
export default function contribute(client: PluginClientContext) {
    const cleanups = [
        client.addWorkspacePanel({ id: 'mixdog-session-tools', title: '세션 도구', icon: 'Bot',
            context: 'agent', Component: SessionTools }),
        client.addScreen({ id: 'paseodog-native-config', title: '원본 스킬·훅 보기',
            Component: NativeConfigView }),
        client.addScreen({ id: 'mixdog-live', title: 'PaseoDog 실행 현황', Component: LiveStatus }),
        client.addWorkspacePanel({ id: 'mixdog-live', title: 'PaseoDog 실행 현황', icon: 'Activity',
            context: 'agent', Component: LiveStatus }),
        client.addSidebarFooterItem({
            id: 'paseodog-analysis', title: 'AI 사용량·에이전트 분석', Component: AnalysisFooter,
        }),
    ];
    return () => { for (const cleanup of cleanups) void cleanup(); };
}

import React, { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { ScrollView } from '@getpaseo/plugin/client/react-native';
import { useRpc, type PluginSurfaceProps } from '@getpaseo/plugin/client';
import { engineStatus } from '../shared/controls.js';
import { createLiveMonitor } from './live-monitor.mjs';
import { UsageMonitor } from './usage-monitor.js';

type Job = { id: string; sessionId?: string; agent: string; tag?: string; status: string;
    provider: string; model: string; effort?: string; stage?: string; waitingApproval?: boolean;
    startedAt?: string; finishedAt?: string };
type Session = { id: string; state: string; provider?: string; model?: string; effort?: string;
    autoEffort?: boolean; effectiveEffort?: string | null; effectiveEffortAt?: number | null;
    workflow?: { id: string; name: string }; orchestration?: string; approvalCount?: number;
    context?: Record<string, number>; compaction?: { auto: boolean }; jobs?: Job[] };
type Status = { sessions: Session[]; observedAt: number };

const labels: Record<string, string> = {
    running: '실행 중', completed: '완료', failed: '실패', canceled: '취소됨', cancelled: '취소됨',
    idle: '대기', queued: '실행 대기', opening: '시작 중', unavailable: '상태 확인 불가',
    'waiting-approval': '승인 대기', spawning: '에이전트 시작 중',
};
// 설정 화면과 같은 이름으로 오케스트레이션 모드를 표시한다.
const orchestrationLabels: Record<string, string> = { none: '단독 실행', swarm: '에이전트 협업' };

// 화면을 보고 있을 때만 호스트 실행 상태를 자동 갱신한다.
function SessionStatus({ theme }: PluginSurfaceProps) {
    const invoke = useRpc(engineStatus);
    const latestInvoke = useRef(invoke);
    latestInvoke.current = invoke;
    const [status, setStatus] = useState<Status | null>(null);
    const [error, setError] = useState('');
    useEffect(() => {
        const monitor = createLiveMonitor({
            read: () => latestInvoke.current({}),
            onValue: (value: unknown) => { setStatus(value as Status); setError(''); },
            onError: () => setError('연결이 끊겼거나 조회에 실패했습니다. 자동으로 다시 확인합니다.'),
        });
        monitor.setActive(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
        const subscription = AppState.addEventListener('change', (state) => monitor.setActive(state === 'active'));
        return () => { monitor.stop(); subscription.remove(); };
    }, []);
    const text = { color: theme.colors.foreground, fontSize: 15 };
    // 승인 대기를 강조하고 실패·연결 끊김을 완료 상태와 구분한다.
    function statusColor(state: string) {
        if (state === 'failed' || state === 'unavailable') return theme.colors.statusDanger;
        if (state === 'waiting-approval') return theme.colors.statusWarning;
        if (state === 'completed') return theme.colors.statusSuccess;
        return theme.colors.accent;
    }
    return <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Text style={{ ...text, fontSize: 22 }}>PaseoDog 실행 현황</Text>
        <Text style={text}>이 호스트의 모든 PaseoDog 세션 · 약 2초마다 자동 갱신</Text>
        {error ? <Text accessibilityLiveRegion="polite" style={{ ...text, color: theme.colors.statusDanger }}>{error}{status ? ' 아래는 마지막으로 확인한 상태입니다.' : ''}</Text> : null}
        {!status && !error && <Text style={text}>실행 상태를 불러오는 중…</Text>}
        {status && <Text style={{ ...text, color: theme.colors.foregroundMuted }}>
            마지막 확인: {new Date(status.observedAt).toLocaleTimeString()}
        </Text>}
        {status?.sessions.length === 0 && <Text style={text}>열린 PaseoDog 세션이 없습니다. 에이전트 생성 시 PaseoDog 공급자를 선택하세요.</Text>}
        {status?.sessions.map((session, index) => <View key={session.id || `unavailable-${index}`} style={{
            backgroundColor: theme.colors.surface1, borderColor: theme.colors.border, borderWidth: 1,
            borderRadius: 12, padding: 16, gap: 10 }}>
            <Text selectable style={{ ...text, fontSize: 17 }}>{session.workflow?.name || session.workflow?.id || '워크플로 확인 대기'}</Text>
            <Text style={{ ...text, color: statusColor(session.state) }}>{labels[session.state] || session.state}
                {session.approvalCount ? ` · 승인 ${session.approvalCount}건 대기` : ''}</Text>
            <Text style={text}>Main · {session.provider || '—'} / {session.model || '—'} · {session.effort || '기본 추론'}</Text>
            <Text style={text}>추론 설정: {session.autoEffort ? 'Auto' : session.effort || '기본'}
                {' · 최근 요청 effort: '}{session.effectiveEffort || '미기록'}</Text>
            <Text style={text}>오케스트레이션: {orchestrationLabels[session.orchestration || ''] || session.orchestration || '확인 대기'}</Text>
            <Text style={text}>자동 압축: {session.compaction?.auto === undefined ? '확인 대기' : session.compaction.auto ? '켜짐' : '꺼짐'}
                {session.context?.usedTokens !== undefined ? ` · 사용 컨텍스트 ${Math.round(session.context.usedTokens).toLocaleString()} 토큰` : ''}</Text>
            {!!session.approvalCount && <Text style={text}>도구 허용·거절은 해당 채팅의 승인 카드에서 선택하세요.</Text>}
            {!session.jobs?.length && <Text style={{ ...text, color: theme.colors.foregroundMuted }}>
                {session.state === 'unavailable' ? '하위 에이전트 작업 상태 확인 불가' : '하위 에이전트 작업 없음'}</Text>}
            {session.jobs?.map((job) => {
                const state = job.waitingApproval ? 'waiting-approval' : job.status;
                return <View key={job.id} style={{ borderLeftWidth: 3, borderLeftColor: statusColor(state), paddingLeft: 12, gap: 6 }}>
                    <Text style={{ ...text, fontWeight: '600' }}>{job.agent || 'Agent'}{job.tag ? ` · ${job.tag}` : ''}</Text>
                    <Text style={{ ...text, color: statusColor(state) }}>{labels[state] || state}{job.stage && job.stage !== job.status && job.stage !== state
                        ? ` · ${labels[job.stage] || job.stage}` : ''}</Text>
                    <Text style={text}>{job.provider || '—'} / {job.model || '—'} · {job.effort || '기본 추론'}</Text>
                    <Text selectable style={{ ...text, color: theme.colors.foregroundMuted }}>{job.id}</Text>
                </View>;
            })}
            <Text selectable style={{ ...text, color: theme.colors.foregroundMuted }}>{session.id}</Text>
        </View>)}
    </ScrollView>;
}

// 같은 모니터링 진입점에서 실행 현황과 사용량 통계를 전환한다.
export function LiveStatus(props: PluginSurfaceProps & { initialTab?: 'sessions' | 'usage' }) {
    const [tab, setTab] = useState(props.initialTab || 'sessions');
    const colors = props.theme.colors;
    return <View style={{ flex: 1 }}>
        <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 4, paddingHorizontal: 12,
            borderBottomWidth: 1, borderBottomColor: colors.border }}>
            {(['sessions', 'usage'] as const).map((id) => {
                const selected = tab === id;
                return <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected }}
                    onPress={() => setTab(id)} style={{ paddingHorizontal: 14, paddingVertical: 10, marginBottom: -1,
                        borderBottomWidth: 2, borderBottomColor: selected ? colors.accent : 'transparent' }}>
                    <Text style={{ fontSize: 14, fontWeight: selected ? '600' : '400',
                        color: selected ? colors.foreground : colors.foregroundMuted }}>
                        {id === 'sessions' ? '에이전트 실행 현황' : '토큰·OAuth 사용량'}</Text>
                </Pressable>;
            })}
        </View>
        {tab === 'sessions' ? <SessionStatus {...props} /> : <UsageMonitor {...props} />}
    </View>;
}

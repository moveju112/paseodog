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
    const muted = { color: theme.colors.foregroundMuted, fontSize: 12 };
    return <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={muted}>
            {status ? `세션 ${status.sessions.length}개 · ` : ''}2초마다 자동 갱신
            {status ? ` · 마지막 확인 ${new Date(status.observedAt).toLocaleTimeString()}` : ''}
        </Text>
        {error ? <Text accessibilityLiveRegion="polite" style={{ ...text, fontSize: 13, color: theme.colors.statusDanger }}>{error}{status ? ' 아래는 마지막으로 확인한 상태입니다.' : ''}</Text> : null}
        {!status && !error && <Text style={muted}>실행 상태를 불러오는 중…</Text>}
        {status?.sessions.length === 0 && <Text style={muted}>열린 PaseoDog 세션이 없습니다. 에이전트 생성 시 PaseoDog 공급자를 선택하세요.</Text>}
        {status?.sessions.map((session, index) => <View key={session.id || `unavailable-${index}`} style={{
            backgroundColor: theme.colors.surface1, borderColor: theme.colors.border, borderWidth: 1,
            borderRadius: 12, padding: 14, gap: 10 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Text selectable numberOfLines={1} style={{ ...text, fontWeight: '600', flexShrink: 1 }}>
                    {session.workflow?.name || session.workflow?.id || '워크플로 확인 대기'}</Text>
                <StatusBadge theme={theme} color={statusColor(session.state)}
                    label={`${labels[session.state] || session.state}${session.approvalCount ? ` · 승인 ${session.approvalCount}건` : ''}`} />
            </View>
            <View style={{ gap: 4 }}>
                <Field theme={theme} label="모델" value={`${session.provider || '—'} / ${session.model || '—'}`} />
                <Field theme={theme} label="추론" value={`${session.autoEffort ? 'Auto' : session.effort || '기본'} · 최근 요청 ${session.effectiveEffort || '미기록'}`} />
                <Field theme={theme} label="모드" value={orchestrationLabels[session.orchestration || ''] || session.orchestration || '확인 대기'} />
                <Field theme={theme} label="컨텍스트" value={`자동 압축 ${session.compaction?.auto === undefined ? '확인 대기' : session.compaction.auto ? '켜짐' : '꺼짐'}${session.context?.usedTokens !== undefined ? ` · ${Math.round(session.context.usedTokens).toLocaleString()} 토큰 사용` : ''}`} />
            </View>
            {!!session.approvalCount && <Text style={{ ...muted, color: theme.colors.statusWarning }}>도구 허용·거절은 해당 채팅의 승인 카드에서 선택하세요.</Text>}
            <View style={{ gap: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
                <Text style={{ ...muted, fontWeight: '600' }}>하위 에이전트 {session.jobs?.length || 0}</Text>
                {!session.jobs?.length && <Text style={muted}>
                    {session.state === 'unavailable' ? '작업 상태 확인 불가' : '작업 없음'}</Text>}
                {session.jobs?.map((job) => {
                    const state = job.waitingApproval ? 'waiting-approval' : job.status;
                    return <View key={job.id} style={{ borderLeftWidth: 3, borderLeftColor: statusColor(state), paddingLeft: 10, gap: 2 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                            <Text numberOfLines={1} style={{ ...text, fontSize: 14, fontWeight: '600', flexShrink: 1 }}>
                                {job.agent || 'Agent'}{job.tag ? ` · ${job.tag}` : ''}</Text>
                            <Text style={{ fontSize: 12, color: statusColor(state) }}>{labels[state] || state}{job.stage && job.stage !== job.status && job.stage !== state
                                ? ` · ${labels[job.stage] || job.stage}` : ''}</Text>
                        </View>
                        <Text style={muted}>{job.provider || '—'} / {job.model || '—'} · {job.effort || '기본 추론'}</Text>
                        <Text selectable style={{ ...muted, fontSize: 11 }}>{job.id}</Text>
                    </View>;
                })}
            </View>
            <Text selectable style={{ ...muted, fontSize: 11 }}>{session.id}</Text>
        </View>)}
    </ScrollView>;
}

// 상태 배지 (색 점 -> 상태 라벨)
function StatusBadge({ theme, color, label }: { theme: PluginSurfaceProps['theme']; color: string; label: string }) {
    return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 3,
        borderRadius: 999, backgroundColor: theme.colors.surface2 }}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
        <Text style={{ fontSize: 12, color }}>{label}</Text>
    </View>;
}

// 라벨·값 한 줄 (고정 폭 라벨 -> 값)
function Field({ theme, label, value }: { theme: PluginSurfaceProps['theme']; label: string; value: string }) {
    return <View style={{ flexDirection: 'row', gap: 8 }}>
        <Text style={{ width: 64, color: theme.colors.foregroundMuted, fontSize: 13 }}>{label}</Text>
        <Text selectable style={{ flex: 1, color: theme.colors.foreground, fontSize: 13 }}>{value}</Text>
    </View>;
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
                        {id === 'sessions' ? '에이전트 실행' : '사용량·한도'}</Text>
                </Pressable>;
            })}
        </View>
        {tab === 'sessions' ? <SessionStatus {...props} /> : <UsageMonitor {...props} />}
    </View>;
}

import React, { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { ScrollView } from '@getpaseo/plugin/client/react-native';
import { useRpc, type PluginClientContext, type PluginSurfaceProps } from '@getpaseo/plugin/client';
import { engineControls } from './shared/controls.js';
import { LiveStatus } from './client/live-status.js';

type Route = { provider: string; model: string; effort?: string; autoEffort: boolean; fast: boolean };
type WorkflowItem = { id: string; name: string; description?: string; source?: string; editable?: boolean; active: boolean };
type WorkflowPack = { id: string; name: string; description?: string; body: string; source?: string; editable?: boolean };
type Snapshot = {
    route: Route;
    models: { id: string; provider: string; label: string;
        effortOptions: { id: string; label: string }[]; fastCapable: boolean }[];
    compaction: { auto: boolean; onModelChange?: boolean; mainBufferPercent?: number };
    autoClear?: { enabled: boolean; idleMs?: number; minContextPercent?: number };
    workflows: WorkflowItem[];
    workflowPack?: WorkflowPack | null;
    orchestration: string;
    agents: { id: string; label: string; description?: string; disabled: boolean; route: Route }[];
    sessions: { id: string; running?: boolean; state?: string; model?: string;
        compaction?: { auto: boolean }; context?: Record<string, number>;
        jobs?: { id: string; agent: string; status: string }[] }[];
};

const ORCHESTRATION_DESC: Record<string, string> = {
    none: '단독 실행 — 서브에이전트 위임 없이 메인 모델이 직접 처리 (토큰 최소)',
    focused: '집중 위임 — 꼭 필요한 단일 서브에이전트만 선별 호출',
    balanced: '균형 오케스트레이션 — 복잡도에 맞춰 탐색·구현·검증 분담 (권장)',
    swarm: '스웜 병렬 — 다중 서브에이전트 동시 병렬 투입 (속도·품질 극대화)',
};

// 클릭 즉시 로컬 스냅샷에 낙관적 반영하여 체감 지연을 제거한다 (요청 -> 로컬 반영)
function applyOptimistic(prev: Snapshot | null, input: Record<string, any>): Snapshot | null {
    if (!prev) return prev;
    if (input.action === 'orchestration' && typeof input.mode === 'string') {
        return { ...prev, orchestration: input.mode };
    }
    if (input.action === 'workflow' && typeof input.workflow === 'string') {
        return {
            ...prev,
            workflows: prev.workflows.map((w) => ({ ...w, active: w.id === input.workflow })),
        };
    }
    if (input.action === 'compaction') {
        return {
            ...prev,
            compaction: {
                ...prev.compaction,
                ...(typeof input.enabled === 'boolean' ? { auto: input.enabled } : {}),
                ...(typeof input.onModelChange === 'boolean' ? { onModelChange: input.onModelChange } : {}),
                ...(typeof input.mainBufferPercent === 'number' ? { mainBufferPercent: input.mainBufferPercent } : {}),
            },
        };
    }
    if (input.action === 'autoClear') {
        const cur = prev.autoClear || { enabled: false, idleMs: 3600000, minContextPercent: 15 };
        return {
            ...prev,
            autoClear: {
                ...cur,
                ...(typeof input.enabled === 'boolean' ? { enabled: input.enabled } : {}),
                ...(typeof input.idleMs === 'number' ? { idleMs: input.idleMs } : {}),
                ...(typeof input.minContextPercent === 'number' ? { minContextPercent: input.minContextPercent } : {}),
            },
        };
    }
    if (input.action === 'main' && input.route) {
        return { ...prev, route: { ...prev.route, ...input.route } };
    }
    if (input.action === 'agent' && input.agent && input.route) {
        return {
            ...prev,
            agents: prev.agents.map((a) => a.id === input.agent
                ? {
                    ...a,
                    disabled: typeof input.route.disabled === 'boolean' ? input.route.disabled : a.disabled,
                    route: { ...a.route, ...input.route },
                }
                : a),
        };
    }
    return prev;
}

// 호스트별 엔진 설정을 조회하고 사용자가 선택한 항목만 저장한다.
function EngineSettings({ theme }: PluginSurfaceProps) {
    const invoke = useRpc(engineControls);
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [target, setTarget] = useState('main');
    const [query, setQuery] = useState('');
    const [showModels, setShowModels] = useState(false);
    const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null);
    const [workflowBody, setWorkflowBody] = useState('');
    const [creatingWorkflow, setCreatingWorkflow] = useState(false);
    const [newWorkflowName, setNewWorkflowName] = useState('');
    const [newWorkflowDesc, setNewWorkflowDesc] = useState('');
    const colors = theme.colors;

    // 실패 시 이전 표시를 보존하고 저장 완료로 오인하지 않도록 오류를 표시한다.
    async function request(input: Parameters<typeof invoke>[0]) {
        const previous = snapshot;
        if (input.action !== 'read') {
            setSnapshot((cur) => applyOptimistic(cur, input as Record<string, any>));
        } else {
            setBusy(true);
        }
        setMessage('');
        try {
            const next = await invoke(input) as Snapshot;
            setSnapshot(next);
            if (next.workflowPack && (input.action === 'workflowPack' || input.action === 'workflowSave' || input.action === 'workflowCreate')) {
                setEditingWorkflowId(next.workflowPack.id);
                setWorkflowBody(next.workflowPack.body || '');
            }
            setMessage(input.action === 'read' ? '엔진에서 조회했습니다.' : '즉시 반영되었습니다.');
        } catch (error) {
            if (previous && input.action !== 'read') setSnapshot(previous);
            setMessage(error instanceof Error ? error.message : String(error));
        } finally { setBusy(false); }
    }
    useEffect(() => { void request({ action: 'read' }); }, []);

    // 현재 모델 또는 선택한 하위 에이전트의 네이티브 설정만 수정한다.
    function routeChange(route: Parameters<typeof invoke>[0]['route']) {
        void request({ action: target === 'main' ? 'main' : 'agent',
            ...(target === 'main' ? {} : { agent: target }), route });
    }
    const selectedAgent = snapshot?.agents.find((agent) => agent.id === target);
    const route = target === 'main' ? snapshot?.route : selectedAgent?.route;
    const model = snapshot?.models.find((item) => item.id === route?.model && item.provider === route?.provider);
    const matches = snapshot?.models.filter((item) =>
        `${item.label} ${item.provider} ${item.id}`.toLowerCase().includes(query.toLowerCase())) || [];
    const activeWorkflow = snapshot?.workflows.find((w) => w.active) || snapshot?.workflows[0];
    const text = { color: colors.foreground, fontSize: 15 };

    // 충분한 터치 영역과 선택 상태를 갖춘 공통 설정 버튼
    function button(label: string, press: () => void, selected = false) {
        return <Pressable key={label} disabled={busy} accessibilityRole="button"
            accessibilityState={{ disabled: busy, selected }} onPress={press}
            style={{ padding: 12, minHeight: 48, borderWidth: 1, borderRadius: 8,
                borderColor: colors.foreground, marginVertical: 4, opacity: busy ? 0.5 : 1 }}>
            <Text style={text}>{selected ? '✓ ' : ''}{label}</Text>
        </Pressable>;
    }

    return <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={{ ...text, fontSize: 22 }}>Mixdog 엔진 · 워크플로 & 토큰 절감</Text>
        <Text style={text}>PaseoDog 전용 엔진 컨트롤 센터입니다. 변경 사항은 열린 세션과 새 세션에 즉시 반영됩니다.</Text>
        {button(busy ? '처리 중…' : '목록·실행 상태 새로고침', () => void request({ action: 'read', refresh: true }))}
        <Text accessibilityLiveRegion="polite" style={text}>{message}</Text>
        {snapshot && <>
            <Text style={{ ...text, fontSize: 18 }}>자동 오케스트레이터</Text>
            {(['none', 'focused', 'balanced', 'swarm'] as const).map((mode) => button(mode,
                () => void request({ action: 'orchestration', mode }), snapshot.orchestration === mode))}
            <Text style={text}>{ORCHESTRATION_DESC[snapshot.orchestration] || ''}</Text>

            <Text style={{ ...text, fontSize: 18 }}>워크플로 (WORKFLOW.md)</Text>
            {snapshot.workflows.map((workflow) => button(workflow.name,
                () => void request({ action: 'workflow', workflow: workflow.id }), workflow.active))}
            {activeWorkflow && button(
                editingWorkflowId === activeWorkflow.id ? '워크플로 편집기 닫기' : `현재 워크플로(${activeWorkflow.name}) 내용 보기·편집`,
                () => {
                    if (editingWorkflowId === activeWorkflow.id) {
                        setEditingWorkflowId(null);
                    } else {
                        void request({ action: 'workflowPack', workflow: activeWorkflow.id });
                    }
                },
            )}
            {editingWorkflowId && <>
                <TextInput accessibilityLabel="워크플로 본문" multiline value={workflowBody} onChangeText={setWorkflowBody}
                    style={{ ...text, minHeight: 160, padding: 10, borderWidth: 1, borderColor: colors.foreground }} />
                {button('워크플로 저장 및 즉시 적용', () => void request({
                    action: 'workflowSave', workflow: editingWorkflowId, body: workflowBody, activate: true,
                }))}
                {editingWorkflowId !== 'default' && button('이 커스텀 워크플로 삭제', () => {
                    const delId = editingWorkflowId;
                    setEditingWorkflowId(null);
                    void request({ action: 'workflowDelete', workflow: delId });
                })}
            </>}
            {button(creatingWorkflow ? '새 워크플로 만들기 취소' : '새 커스텀 워크플로 추가',
                () => setCreatingWorkflow(!creatingWorkflow))}
            {creatingWorkflow && <>
                <TextInput accessibilityLabel="새 워크플로 이름" placeholder="워크플로 이름 (예: Fast TDD)"
                    placeholderTextColor={colors.foreground} value={newWorkflowName} onChangeText={setNewWorkflowName}
                    style={{ ...text, minHeight: 44, padding: 10, borderWidth: 1, borderColor: colors.foreground }} />
                <TextInput accessibilityLabel="새 워크플로 설명" placeholder="간단한 설명"
                    placeholderTextColor={colors.foreground} value={newWorkflowDesc} onChangeText={setNewWorkflowDesc}
                    style={{ ...text, minHeight: 44, padding: 10, borderWidth: 1, borderColor: colors.foreground }} />
                {button('새 워크플로 생성', () => {
                    if (!newWorkflowName.trim()) return;
                    setCreatingWorkflow(false);
                    const name = newWorkflowName.trim();
                    const description = newWorkflowDesc.trim();
                    setNewWorkflowName('');
                    setNewWorkflowDesc('');
                    void request({ action: 'workflowCreate', name, description, activate: true });
                })}
            </>}

            <Text style={{ ...text, fontSize: 18 }}>토큰 절감 & 컨텍스트 최적화</Text>
            {button(`자동 추론 조절: ${route?.autoEffort ? '켜짐' : '꺼짐'}`,
                () => routeChange({ autoEffort: !route?.autoEffort }))}
            {button(`자동 압축: ${snapshot.compaction.auto ? '켜짐' : '꺼짐'}`,
                () => void request({ action: 'compaction', enabled: !snapshot.compaction.auto }))}
            {button(`모델 변경 시 자동 압축: ${snapshot.compaction.onModelChange ? '켜짐' : '꺼짐'}`,
                () => void request({ action: 'compaction', onModelChange: !snapshot.compaction.onModelChange }))}
            {([0.15, 0.2, 0.3] as const).map((pct) => button(`컨텍스트 버퍼 ${Math.round(pct * 100)}%`,
                () => void request({ action: 'compaction', mainBufferPercent: pct }),
                Math.abs((snapshot.compaction.mainBufferPercent ?? 0.2) - pct) < 0.02))}
            {button(`유휴 컨텍스트 자동 정리: ${snapshot.autoClear?.enabled ? '켜짐' : '꺼짐'}`,
                () => void request({ action: 'autoClear', enabled: !snapshot.autoClear?.enabled }))}
            <Text style={text}>기존 대화의 수동 압축은 채팅에서 /compact를 사용하세요.</Text>

            <Text style={{ ...text, fontSize: 18 }}>모델·서브에이전트 라우팅</Text>
            {button('Main', () => setTarget('main'), target === 'main')}
            {snapshot.agents.map((agent) => button(`${agent.label} · ${agent.disabled ? '꺼짐' : '켜짐'}`,
                () => setTarget(agent.id), target === agent.id))}
            <Text style={text}>{route?.provider || 'Main 상속'} / {route?.model || 'Main 상속'}</Text>
            {selectedAgent && <>
                {button(selectedAgent.disabled ? '에이전트 켜기' : '에이전트 끄기',
                    () => routeChange({ disabled: !selectedAgent.disabled }))}
                {button('모델을 Main에서 상속', () => routeChange({ provider: '' }))}
            </>}
            {button('모델 선택', () => setShowModels(!showModels))}
            {showModels && <>
                <TextInput accessibilityLabel="모델 검색" placeholder="모델·공급자 검색"
                    placeholderTextColor={colors.foreground} value={query} onChangeText={setQuery}
                    style={{ ...text, minHeight: 48, padding: 10, borderWidth: 1, borderColor: colors.foreground }} />
                {matches.slice(0, 30).map((item) => button(`${item.label} · ${item.provider}`,
                    () => { setShowModels(false); routeChange({ provider: item.provider, model: item.id }); },
                    item.id === route?.model && item.provider === route?.provider))}
                {matches.length > 30 && <Text style={text}>검색어로 범위를 좁혀주세요. 총 {matches.length}개</Text>}
            </>}
            {model?.effortOptions.map((option) => button(`추론: ${option.label}`,
                () => routeChange({ effort: option.id }), route?.effort === option.id))}
            {model?.fastCapable && button(`Fast: ${route?.fast ? '켜짐' : '꺼짐'}`,
                () => routeChange({ fast: !route?.fast }))}

            <Text style={{ ...text, fontSize: 18 }}>현재 연결된 엔진 세션</Text>
            {!snapshot.sessions.length && <Text style={text}>이 플러그인이 소유한 열린 세션이 없습니다.</Text>}
            {snapshot.sessions.map((session) => <View key={session.id} style={{ gap: 6 }}>
                <Text selectable style={text}>{session.id} · {session.state || (session.running ? '실행 중' : '대기')}
                    {'\n'}{session.model || ''} · 자동 압축 {session.compaction?.auto === undefined ? '확인 불가' : session.compaction.auto ? '켜짐' : '꺼짐'}</Text>
                {Object.entries(session.context || {}).map(([key, value]) =>
                    <Text key={key} style={text}>{key}: {Math.round(value)}</Text>)}
                {session.jobs?.map((job, index) => <Text key={job.id || index} style={text}>
                    {job.agent || job.id} · {job.status}</Text>)}
            </View>)}
        </>}
    </ScrollView>;
}

// Paseo 기본 플러그인 설정 화면을 사용해 원본 앱 수정 없이 엔진 UI를 제공한다.
export default function contribute(client: PluginClientContext) {
    const cleanups = [
        client.addSettingsScreen({ id: 'mixdog-engine', title: 'Mixdog 엔진', icon: 'Bot', Component: EngineSettings }),
        client.addScreen({ id: 'mixdog-live', title: 'Mixdog 실행 현황', Component: LiveStatus }),
        client.addWorkspacePanel({ id: 'mixdog-live', title: 'Mixdog 실행 현황', icon: 'Activity',
            context: 'agent', Component: LiveStatus }),
        client.addSidebarFooterItem({
            id: 'mixdog-live', title: 'Mixdog 실행 현황',
            Component: ({ theme, openScreen }) => <Pressable accessibilityRole="button"
                onPress={() => openScreen({ screenId: 'mixdog-live' })}
                style={{ padding: 12, minHeight: 48 }}>
                <Text style={{ color: theme.colors.foreground }}>Mixdog 실행 현황</Text>
            </Pressable>,
        }),
    ];
    return () => { for (const cleanup of cleanups) void cleanup(); };
}

import React, { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { Modal, ScrollView } from '@getpaseo/plugin/client/react-native';
import { useRpc, type PluginClientContext, type PluginSurfaceProps } from '@getpaseo/plugin/client';
import { engineAuth, engineControls } from './shared/controls.js';
import { LiveStatus } from './client/live-status.js';
import { AnalysisFooter } from './client/analysis-footer.js';
import { NativeConfigView } from './client/native-config.js';
import { SessionTools } from './client/session-tools.js';
import { ResourceSettings } from './client/resource-settings.js';

type Route = { provider: string; model: string; effort?: string; autoEffort: boolean; fast: boolean; contextPercent?: number | null };
type AuthProvider = 'anthropic-oauth' | 'openai-oauth';
type AuthFlow = { id: string; url: string; userCode: string | null; acceptsCode: boolean };
type AgentDefinition = { id: string; name: string; description?: string; body: string; custom?: boolean; userOverride?: boolean };
type WorkflowItem = { id: string; name: string; description?: string; source?: string; editable?: boolean; active: boolean };
type WorkflowPack = { id: string; name: string; description?: string; body: string; source?: string; editable?: boolean };
type Snapshot = {
    route: Route;
    models: { id: string; provider: string; label: string;
        effortOptions: { id: string; label: string }[]; fastCapable: boolean }[];
    compaction: {
        auto: boolean;
        onModelChange?: boolean;
        mainBufferPercent?: number;
        mainBufferTokens?: number | null;
        summaryModel?: string | null;
        memoryTimeoutMs?: number;
    };
    autoClear?: { enabled: boolean; idleMs?: number; minContextPercent?: number };
    workflows: WorkflowItem[];
    workflowPack?: WorkflowPack | null;
    orchestration: string;
    agents: { id: string; label: string; description?: string; disabled: boolean; custom?: boolean; userOverride?: boolean; route: Route }[];
    sessions: { id: string; running?: boolean; state?: string; model?: string;
        compaction?: { auto: boolean }; context?: Record<string, number>;
        jobs?: { id: string; agent: string; status: string }[] }[];
    agentDefinition?: AgentDefinition | null;
    instructionFiles?: string;
    recap?: boolean;
    toolModules?: {
        webSearch?: boolean;
        memory?: { enabled: boolean; installed?: boolean };
    };
    outputStyle?: string;
    outputStyles?: { id: string; label: string }[];
    profile?: { title?: string | null; language?: string | null; experienceLevel?: string | null };
    aiSessionTitles?: boolean;
    worktree?: { newTaskDefault?: 'branch' | 'direct' | 'ask' | 'worktree'; branchPrefix?: string; autoCleanup?: boolean };
};
type Section = 'account' | 'workflow' | 'tokens' | 'instructions' | 'agents';

// 호스트 설정 목록에 개별 항목으로 등록할 엔진 설정 섹션
const SETTINGS_SECTIONS: { id: string; title: string; section: Section; intro: string }[] = [
    { id: 'mixdog-account', title: '구독 계정', section: 'account',
        intro: '이 호스트의 전용 엔진 프로필에 구독 계정을 연결합니다. 채팅 모델 선택은 채팅 화면에서 합니다.' },
    { id: 'mixdog-workflow', title: '워크플로', section: 'workflow',
        intro: '자동 오케스트레이션과 WORKFLOW.md 워크플로를 고릅니다. 열린 세션과 새 세션에 즉시 반영됩니다.' },
    { id: 'mixdog-tokens', title: '토큰 절감', section: 'tokens',
        intro: '압축·컨텍스트 정리로 토큰 사용량을 줄입니다. 자동 추론은 입력창의 추론 수준 목록에서 고릅니다.' },
    { id: 'mixdog-instructions', title: '지침 파일 로딩', section: 'instructions',
        intro: '전역·프로젝트 지침 파일을 모델 컨텍스트에 불러올지 정합니다.' },
    { id: 'mixdog-agents', title: '에이전트', section: 'agents',
        intro: '서브에이전트 사용 여부·전용 모델·추론 설정과 원본 정의를 확인합니다.' },
];

const AUTH_PROVIDERS: { id: AuthProvider; label: string }[] = [
    { id: 'anthropic-oauth', label: 'Claude 구독 (Anthropic)' },
    { id: 'openai-oauth', label: 'ChatGPT 구독 (OpenAI)' },
];
const AUTH_STATES: Record<string, string> = {
    idle: '진행 중인 로그인 없음', pending: '로그인 대기 중', completing: '로그인 확인 중',
    completed: '로그인 완료', failed: '로그인 실패. 새 로그인으로 다시 시도해 주세요.',
};

const ORCHESTRATION_DESC: Record<string, string> = {
    none: '단독 실행 — 서브에이전트 위임 없이 메인 모델이 직접 처리 (토큰 최소)',
    swarm: '에이전트 협업 — 사용자가 켠 에이전트만 병렬 위임에 사용',
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
                ...(input.mainBufferTokens !== undefined ? { mainBufferTokens: input.mainBufferTokens } : {}),
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
    if (input.action === 'instructionFiles') {
        if (typeof input.instructionMode === 'string') {
            return { ...prev, instructionFiles: input.instructionMode };
        }
        if (typeof input.enabled === 'boolean') {
            return { ...prev, instructionFiles: input.enabled ? 'all' : 'off' };
        }
    }
    if (input.action === 'features') {
        const prevModules = prev.toolModules || {};
        return {
            ...prev,
            ...(typeof input.recap === 'boolean' ? { recap: input.recap } : {}),
            toolModules: {
                ...prevModules,
                ...(typeof input.webSearch === 'boolean' ? { webSearch: input.webSearch } : {}),
                ...(typeof input.memoryTools === 'boolean'
                    ? { memory: { ...(prevModules.memory || { enabled: true }), enabled: input.memoryTools } }
                    : {}),
            },
        };
    }
    if (input.action === 'preferences') {
        return {
            ...prev,
            ...(typeof input.outputStyle === 'string' ? { outputStyle: input.outputStyle } : {}),
            ...(typeof input.aiSessionTitles === 'boolean' ? { aiSessionTitles: input.aiSessionTitles } : {}),
            ...(input.profile ? { profile: { ...(prev.profile || {}), ...input.profile } } : {}),
            ...(input.worktree ? { worktree: { ...(prev.worktree || {}), ...input.worktree } } : {}),
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

// 호스트별 엔진 설정을 조회하고 사용자가 선택한 항목만 저장한다 (섹션별로 해당 컨트롤만 표시).
function EngineSettings({ theme, section }: PluginSurfaceProps & { section: Section }) {
    const invoke = useRpc(engineControls);
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [target, setTarget] = useState('');
    const [query, setQuery] = useState('');
    const [showModels, setShowModels] = useState(false);
    const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null);
    const [workflowBody, setWorkflowBody] = useState('');
    const [creatingWorkflow, setCreatingWorkflow] = useState(false);
    const [newWorkflowName, setNewWorkflowName] = useState('');
    const [newWorkflowDesc, setNewWorkflowDesc] = useState('');
    const [agentDefinition, setAgentDefinition] = useState<AgentDefinition | null>(null);
    const [editingAgent, setEditingAgent] = useState(false);
    const [agentEditBody, setAgentEditBody] = useState('');
    const invokeAuth = useRpc(engineAuth);
    const [authOpen, setAuthOpen] = useState(false);
    const [authProvider, setAuthProvider] = useState<AuthProvider>('anthropic-oauth');
    const [authFlow, setAuthFlow] = useState<AuthFlow | null>(null);
    const [authCode, setAuthCode] = useState('');
    const [authBusy, setAuthBusy] = useState(false);
    const [authMessage, setAuthMessage] = useState('');
    const authGeneration = useRef(0);
    const colors = theme.colors;

    // 실패 시 이전 표시를 보존하고 저장 완료로 오인하지 않도록 오류를 표시한다.
    // 저장 중에도 컨트롤을 잠가 연속 클릭의 실패 메시지가 뒤 요청의 성공 메시지에 가려지지 않게 한다.
    async function request(input: Parameters<typeof invoke>[0]) {
        const previous = snapshot;
        const readOnly = input.action === 'read' || input.action === 'agentDefinition';
        if (!readOnly) setSnapshot((cur) => applyOptimistic(cur, input as Record<string, any>));
        setBusy(true);
        setMessage('');
        try {
            const next = await invoke(input) as Snapshot;
            setSnapshot(next);
            if (next.workflowPack && (input.action === 'workflowPack' || input.action === 'workflowSave' || input.action === 'workflowCreate')) {
                setEditingWorkflowId(next.workflowPack.id);
                setWorkflowBody(next.workflowPack.body || '');
            }
            if (input.action === 'agentDefinition') {
                setAgentDefinition(next.agentDefinition ?? null);
                if (next.agentDefinition?.body) setAgentEditBody(next.agentDefinition.body);
            }
            setMessage(readOnly ? '엔진에서 조회했습니다.'
                : input.action === 'instructionFiles' ? '저장했습니다. 새 세션부터 적용됩니다.' : '즉시 반영되었습니다.');
        } catch (error) {
            if (previous && !readOnly) setSnapshot(previous);
            setMessage(error instanceof Error ? error.message : String(error));
        } finally { setBusy(false); }
    }
    useEffect(() => { if (section !== 'account') void request({ action: 'read' }); }, []);

    // 계정 로그인 RPC 호출 (요청 -> 결과 반영, 모달이 닫힌 뒤 도착한 시작 응답은 서버에서 취소)
    async function authRequest(input: Parameters<typeof invokeAuth>[0], apply: (result: any) => void) {
        const generation = authGeneration.current;
        setAuthBusy(true);
        setAuthMessage('');
        try {
            const result = await invokeAuth(input) as any;
            if (generation !== authGeneration.current) {
                if (input.action === 'start' && typeof result?.id === 'string') {
                    void invokeAuth({ action: 'cancel', provider: input.provider, id: result.id }).catch((error) =>
                        setMessage(`로그인 취소 확인 실패: ${error instanceof Error ? error.message : String(error)}`));
                }
                return;
            }
            apply(result);
        } catch (error) {
            if (generation === authGeneration.current) setAuthMessage(error instanceof Error ? error.message : String(error));
        } finally {
            if (generation === authGeneration.current) setAuthBusy(false);
        }
    }

    // 연결 상태 확인 (상태 조회 -> 끝난 로그인 흐름 정리)
    function checkAuthStatus() {
        void authRequest({ action: 'status', provider: authProvider }, (result) => {
            if (result?.state !== 'pending' && result?.state !== 'completing') {
                setAuthFlow(null);
                setAuthCode('');
            }
            setAuthMessage(`${result?.connected ? '연결된 계정 있음' : '연결된 계정 없음'} · ${AUTH_STATES[result?.state] || result?.state || ''}`);
        });
    }

    // 로그인 시작 (서버 OAuth 흐름 생성 -> 로그인 주소·코드 입력 표시)
    function startAuth() {
        setAuthCode('');
        void authRequest({ action: 'start', provider: authProvider }, (result) => {
            setAuthFlow({ id: result.id, url: result.url, userCode: result.userCode || null, acceptsCode: result.acceptsCode === true });
            setAuthMessage('브라우저에서 로그인을 진행하세요.');
        });
    }

    // 인증 코드 제출 (입력값 즉시 폐기 -> 완료 결과 표시, 흐름은 재사용하지 않음)
    function submitAuthCode() {
        const code = authCode.trim();
        if (!authFlow || !code || authBusy) return;
        const flow = authFlow;
        setAuthCode('');
        setAuthFlow(null);
        void authRequest({ action: 'complete', provider: authProvider, id: flow.id, code }, (result) => {
            setAuthMessage(AUTH_STATES[result?.state] || String(result?.state || ''));
        });
    }

    // 진행 중인 로그인 취소 (입력값 폐기 -> 서버 흐름 취소)
    function cancelAuth() {
        if (!authFlow) return;
        const flow = authFlow;
        setAuthCode('');
        setAuthFlow(null);
        void authRequest({ action: 'cancel', provider: authProvider, id: flow.id },
            () => setAuthMessage('로그인을 취소했습니다.'));
    }

    // 로그인 모달 닫기 (뒤로가기 포함, 진행 중 로그인 취소 -> 입력값·응답 폐기)
    function closeAuth() {
        const flow = authFlow;
        authGeneration.current += 1;
        setAuthOpen(false);
        setAuthFlow(null);
        setAuthCode('');
        setAuthBusy(false);
        setAuthMessage('');
        if (flow) {
            void invokeAuth({ action: 'cancel', provider: authProvider, id: flow.id }).catch((error) =>
                setMessage(`로그인 취소 확인 실패: ${error instanceof Error ? error.message : String(error)}`));
        }
    }

    // 로그인 주소 열기 (실패 시 주소 복사 안내)
    function openAuthUrl() {
        if (!authFlow) return;
        Linking.openURL(authFlow.url).catch(() => setAuthMessage('브라우저를 열지 못했습니다. 아래 주소를 복사해 열어 주세요.'));
    }

    // 선택한 하위 에이전트의 네이티브 설정만 수정한다 (Main 모델은 채팅에서 선택).
    function routeChange(route: Parameters<typeof invoke>[0]['route']) {
        if (!target) return;
        void request({ action: 'agent', agent: target, route });
    }
    const selectedAgent = snapshot?.agents.find((agent) => agent.id === target);
    const route = selectedAgent?.route;
    const model = snapshot?.models.find((item) => item.id === route?.model && item.provider === route?.provider);
    const mainModel = snapshot?.models.find((item) => item.id === snapshot.route.model && item.provider === snapshot.route.provider);
    const instructionFilesOn = !!snapshot?.instructionFiles && snapshot.instructionFiles !== 'off';
    const intro = SETTINGS_SECTIONS.find((item) => item.section === section)?.intro || '';
    const matches = snapshot?.models.filter((item) =>
        `${item.label} ${item.provider} ${item.id}`.toLowerCase().includes(query.toLowerCase())) || [];
    const activeWorkflow = snapshot?.workflows.find((w) => w.active);
    const text = { color: colors.foreground, fontSize: 15 };

    // 충분한 터치 영역과 선택 상태를 갖춘 공통 설정 버튼
    function button(label: string, press: () => void, selected = false, disabled = busy) {
        return <Pressable key={label} disabled={disabled} accessibilityRole="button"
            accessibilityState={{ disabled, selected }} onPress={press}
            style={{ padding: 12, minHeight: 48, borderWidth: 1, borderRadius: 8,
                borderColor: colors.foreground, marginVertical: 4, opacity: disabled ? 0.5 : 1 }}>
            <Text style={text}>{selected ? '✓ ' : ''}{label}</Text>
        </Pressable>;
    }

    return <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={text}>{intro}</Text>
        {section === 'account'
            ? button('구독 계정 로그인', () => setAuthOpen(true), false, false)
            : button(busy ? '처리 중…' : '새로고침', () => void request({ action: 'read', refresh: true }))}
        <Text accessibilityLiveRegion="polite" style={text}>{message}</Text>
        {section === 'account' && <Modal title="구독 계정 로그인" open={authOpen}
            onOpenChange={(open) => { if (!open) closeAuth(); }}>
            <Modal.Content>
                {authOpen && <View style={{ gap: 12 }}>
                    <Text accessibilityRole="header" style={{ ...text, fontSize: 20 }}>구독 계정 로그인</Text>
                    <Text style={text}>계정 정보는 이 호스트의 전용 엔진 프로필에만 저장됩니다.</Text>
                    {AUTH_PROVIDERS.map((item) => button(item.label, () => { setAuthProvider(item.id); setAuthMessage(''); },
                        authProvider === item.id, authBusy || !!authFlow))}
                    {button('연결 상태 확인', checkAuthStatus, false, authBusy)}
                    {!authFlow && button('로그인 시작', startAuth, false, authBusy)}
                    {authFlow && <>
                        {button('브라우저에서 로그인 페이지 열기', openAuthUrl, false, false)}
                        <Text selectable style={{ ...text, color: colors.foregroundMuted }}>{authFlow.url}</Text>
                        {authFlow.userCode && <Text selectable style={{ ...text, fontSize: 20 }}>기기 코드: {authFlow.userCode}</Text>}
                        {authFlow.acceptsCode ? <>
                            <TextInput accessibilityLabel="인증 코드" placeholder="로그인 후 표시된 인증 코드"
                                placeholderTextColor={colors.foregroundMuted} value={authCode} onChangeText={setAuthCode}
                                secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off"
                                maxLength={8192} returnKeyType="done" onSubmitEditing={submitAuthCode}
                                style={{ ...text, minHeight: 48, padding: 10, borderWidth: 1, borderColor: colors.foreground }} />
                            {button('코드 제출', submitAuthCode, false, authBusy || !authCode.trim())}
                        </> : <Text style={text}>브라우저에서 로그인을 마친 뒤 연결 상태 확인을 누르세요.</Text>}
                        {button('진행 중인 로그인 취소', cancelAuth, false, authBusy)}
                    </>}
                    {authBusy && <Text style={text}>처리 중…</Text>}
                    <Text accessibilityLiveRegion="polite" style={text}>{authMessage}</Text>
                    {button(authFlow ? '로그인 취소 후 닫기' : '닫기', closeAuth, false, false)}
                </View>}
            </Modal.Content>
        </Modal>}
        {snapshot && section === 'workflow' && <>
            <Text style={{ ...text, fontSize: 18 }}>자동 오케스트레이터</Text>
            <Text style={text}>이 호스트 전체에 적용돼요. 열린 세션은 다음 요청부터 반영하며 도구 승인 설정은 바꾸지 않아요.</Text>
            {(['none', 'swarm'] as const).map((mode) => button(mode === 'none' ? '단독 실행' : '에이전트 협업',
                () => void request({ action: 'orchestration', mode }), snapshot.orchestration === mode))}
            <Text style={text}>{ORCHESTRATION_DESC[snapshot.orchestration] || ''}</Text>

            <Text style={{ ...text, fontSize: 18 }}>워크플로 (WORKFLOW.md)</Text>
            <Text style={text}>사용 안 함을 선택하면 WORKFLOW.md를 읽거나 지침에 추가하지 않아요. 기본 지침 파일 설정은 유지돼요.</Text>
            {snapshot.workflows.map((workflow) => button(workflow.name,
                () => void request({ action: 'workflow', workflow: workflow.id }), workflow.active))}
            {activeWorkflow && activeWorkflow.id !== 'none' && button(
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
                <Text style={text}>본문을 비워 저장하면 이 워크플로의 지침을 추가하지 않아요.</Text>
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
            <Text style={{ ...text, fontSize: 18 }}>출력 스타일 & 작업 환경</Text>
            <Text style={{ ...text, fontSize: 18 }}>개발 숙련도 프로필</Text>
            <Text style={text}>설명 수준을 사용자 숙련도에 맞춰요. 자동은 숙련도 지침을 추가하지 않아요.</Text>
            {([['', '자동'], ['beginner', '입문자'], ['vibe-coder', '바이브 코더'], ['junior', '주니어'],
                ['senior', '시니어'], ['expert', '전문가']] as const).map(([experienceLevel, label]) =>
                button(label, () => void request({ action: 'preferences', profile: { experienceLevel } }),
                    (snapshot.profile?.experienceLevel || '') === experienceLevel))}
            {(['default', 'concise', 'explanatory'] as const).map((styleId) => button(
                `출력 스타일: ${styleId}`,
                () => void request({ action: 'preferences', outputStyle: styleId }),
                (snapshot.outputStyle || 'default') === styleId,
            ))}
            {button(`AI 세션 제목 자동 생성: ${(snapshot.aiSessionTitles ?? true) ? '켜짐' : '꺼짐'}`,
                () => void request({ action: 'preferences', aiSessionTitles: !(snapshot.aiSessionTitles ?? true) }))}
            {button(`새 작업 Worktree 격리: ${(snapshot.worktree?.newTaskDefault || 'branch') === 'worktree' ? '켜짐' : '꺼짐'}`,
                () => void request({
                    action: 'preferences',
                    worktree: { newTaskDefault: (snapshot.worktree?.newTaskDefault || 'branch') === 'worktree' ? 'branch' : 'worktree' },
                }))}
        </>}
        {snapshot && section === 'tokens' && <>
            {mainModel?.fastCapable && button(`Fast 응답: ${snapshot.route.fast ? '켜짐' : '꺼짐'}`,
                () => void request({ action: 'main', route: { fast: !snapshot.route.fast } }))}
            {([100, 85, 70, 50] as const).map((pct) => button(`컨텍스트 한도 ${pct}%`,
                () => void request({ action: 'main', route: { contextPercent: pct } }),
                (snapshot.route.contextPercent ?? 100) === pct))}
            {button(`자동 압축: ${snapshot.compaction.auto ? '켜짐' : '꺼짐'}`,
                () => void request({ action: 'compaction', enabled: !snapshot.compaction.auto }))}
            {button(`모델 변경 시 자동 압축: ${snapshot.compaction.onModelChange ? '켜짐' : '꺼짐'}`,
                () => void request({ action: 'compaction', onModelChange: !snapshot.compaction.onModelChange }))}
            {([0.15, 0.2, 0.3] as const).map((pct) => button(`컨텍스트 버퍼 ${Math.round(pct * 100)}%`,
                () => void request({ action: 'compaction', mainBufferPercent: pct }),
                Math.abs((snapshot.compaction.mainBufferPercent ?? 0.2) - pct) < 0.02))}
            {button(`세션 복귀 요약 (Recap): ${(snapshot.recap ?? true) ? '켜짐' : '꺼짐'}`,
                () => void request({ action: 'features', recap: !(snapshot.recap ?? true) }))}
            {button(`유휴 컨텍스트 자동 정리: ${snapshot.autoClear?.enabled ? '켜짐' : '꺼짐'}`,
                () => void request({ action: 'autoClear', enabled: !snapshot.autoClear?.enabled }))}
            {button('유휴 정리 기본값 복원',
                () => void request({ action: 'autoClear', reset: true }))}
            <Text style={text}>기존 대화의 수동 압축은 채팅에서 /compact를 사용하세요.</Text>
        </>}
        {snapshot && section === 'instructions' && <>
            {button(`지침 파일 로딩: ${instructionFilesOn ? '켜짐' : '꺼짐'}`,
                () => void request({ action: 'instructionFiles', enabled: !instructionFilesOn }), instructionFilesOn)}
            {(['all', 'agents', 'claude', 'off'] as const).map((m) => button(
                `지침 범위: ${m}`,
                () => void request({ action: 'instructionFiles', instructionMode: m }),
                snapshot.instructionFiles === m,
            ))}
            <Text style={text}>켜면 전역 ~/.codex/AGENTS.md, ~/.claude/CLAUDE.md와 프로젝트 AGENTS.md·CLAUDE.md를 불러옵니다.</Text>
            <Text style={text}>변경 사항은 새 세션부터 적용됩니다.</Text>
            {instructionFilesOn && snapshot.instructionFiles !== 'all' && <Text style={{ ...text, color: colors.foregroundMuted }}>
                현재 일부 파일만 불러오는 설정({snapshot.instructionFiles})입니다. 끄거나 다시 켜면 전체 로딩으로 바뀝니다.</Text>}
            <Text style={{ ...text, fontSize: 18 }}>내장 도구 모듈</Text>
            {button(`웹 검색 도구: ${(snapshot.toolModules?.webSearch ?? true) ? '켜짐' : '꺼짐'}`,
                () => void request({ action: 'features', webSearch: !(snapshot.toolModules?.webSearch ?? true) }))}
            {button(`장기 메모리 도구: ${(snapshot.toolModules?.memory?.enabled ?? true) ? '켜짐' : '꺼짐'}`,
                () => void request({ action: 'features', memoryTools: !(snapshot.toolModules?.memory?.enabled ?? true) }))}
        </>}
        {snapshot && section === 'agents' && <>
            {snapshot.agents.map((agent) => button(`${agent.label} · ${agent.disabled ? '꺼짐' : '켜짐'}`,
                () => { setTarget(agent.id); setEditingAgent(false); }, target === agent.id))}
            {!snapshot.agents.length && <Text style={text}>설정할 서브에이전트가 없습니다.</Text>}
            {selectedAgent && <>
                <Text style={text}>{route?.provider || 'Main 상속'} / {route?.model || 'Main 상속'}</Text>
                {button(selectedAgent.disabled ? '에이전트 켜기' : '에이전트 끄기',
                    () => routeChange({ disabled: !selectedAgent.disabled }))}
                {button('모델을 Main에서 상속', () => routeChange({ provider: '' }))}
                {agentDefinition?.id === selectedAgent.id
                    ? button('원본 에이전트 정의 닫기', () => setAgentDefinition(null))
                    : button('원본 에이전트 정의 보기 (읽기 전용)',
                        () => void request({ action: 'agentDefinition', agent: selectedAgent.id }))}
                {agentDefinition?.id === selectedAgent.id && !editingAgent && <View style={{ gap: 6, padding: 10, borderWidth: 1,
                    borderRadius: 8, borderColor: colors.foregroundMuted }}>
                    <Text style={{ ...text, fontWeight: '600' }}>{agentDefinition.name || agentDefinition.id}
                        {agentDefinition.custom ? ' · 커스텀' : ' · 기본 제공'}{agentDefinition.userOverride ? ' · 사용자 재정의' : ''}</Text>
                    {!!agentDefinition.description && <Text style={text}>{agentDefinition.description}</Text>}
                    <Text accessibilityLabel="원본 에이전트 정의" selectable
                        style={{ ...text, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>{agentDefinition.body}</Text>
                </View>}
                {button(editingAgent ? '에이전트 정의 편집 닫기' : '에이전트 정의 편집', () => {
                    if (!editingAgent) void request({ action: 'agentDefinition', agent: selectedAgent.id });
                    setEditingAgent(!editingAgent);
                })}
                {editingAgent && <>
                    <TextInput accessibilityLabel="에이전트 정의 본문" multiline value={agentEditBody} onChangeText={setAgentEditBody}
                        style={{ ...text, minHeight: 140, padding: 10, borderWidth: 1, borderColor: colors.foreground }} />
                    {button('에이전트 정의 저장', () => {
                        setEditingAgent(false);
                        void request({ action: 'agentSave', agent: selectedAgent.id, name: selectedAgent.label, body: agentEditBody });
                    }, false, busy || !route?.provider || !route?.model)}
                </>}
                {button(`에이전트 자동 추론 조절: ${route?.autoEffort ? '켜짐' : '꺼짐'}`,
                    () => routeChange({ autoEffort: !route?.autoEffort }))}
                {button('에이전트 모델 선택', () => setShowModels(!showModels))}
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
            </>}
        </>}
    </ScrollView>;
}

// 섹션별 설정 화면 컴포넌트 생성 (호스트 설정 항목 -> 해당 섹션만 표시)
function sectionScreen(section: Section) {
    return function SectionSettings(props: PluginSurfaceProps) {
        return <EngineSettings {...props} section={section} />;
    };
}

// Paseo 기본 플러그인 설정 화면을 사용해 원본 앱 수정 없이 엔진 UI를 제공한다.
export default function contribute(client: PluginClientContext) {
    const cleanups = [
        client.addSettingsScreen({ id: 'mixdog-session-tools', title: '세션 계승·복구·모델', icon: 'Bot', Component: SessionTools }),
        client.addSettingsScreen({ id: 'mixdog-resources', title: 'MCP·스킬·플러그인', icon: 'Bot', Component: ResourceSettings }),
        client.addWorkspacePanel({ id: 'mixdog-session-tools', title: '세션 도구', icon: 'Bot',
            context: 'agent', Component: SessionTools }),
        ...SETTINGS_SECTIONS.map((item) => client.addSettingsScreen({
            id: item.id, title: item.title, icon: 'Bot', Component: sectionScreen(item.section) })),
        client.addSettingsScreen({ id: 'paseodog-native-config', title: '원본 스킬·훅 보기', icon: 'Bot',
            Component: NativeConfigView }),
        client.addSettingsScreen({ id: 'mixdog-status', title: '실행 현황', icon: 'Activity', Component: LiveStatus }),
        client.addScreen({ id: 'mixdog-live', title: 'PaseoDog 실행 현황', Component: LiveStatus }),
        client.addWorkspacePanel({ id: 'mixdog-live', title: 'PaseoDog 실행 현황', icon: 'Activity',
            context: 'agent', Component: LiveStatus }),
        client.addSidebarFooterItem({
            id: 'paseodog-analysis', title: 'AI 사용량·에이전트 분석', Component: AnalysisFooter,
        }),
    ];
    return () => { for (const cleanup of cleanups) void cleanup(); };
}

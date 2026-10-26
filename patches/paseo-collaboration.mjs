import { createHash } from 'node:crypto';
import { createFastControl, getFastControl } from '../android/packages/app/src/utils/paseodog-fast-control.mjs';
import { createFastControl as previousFastControl, fastToggle as previousFastToggle } from './paseo-fast-v5.mjs';
// 호스트별 실제 RPC 상태를 공유하고 실패한 저장 요청은 재전송하지 않는다.
export function createCollaborationState(client) {
    let snapshot = { mode: null, busy: false, error: '' };
    const listeners = new Set();
    // 상태 변경을 같은 호스트의 모든 입력창에 전달한다.
    function publish(update) {
        snapshot = { ...snapshot, ...update };
        for (const listener of listeners) listener();
    }
    // 읽기와 명시적 저장을 직렬화하고 불확실한 결과는 사용자 확인으로 남긴다.
    async function request(input) {
        if (snapshot.busy) return;
        publish({ busy: true, error: '' });
        try {
            const value = await client.invokePluginRpc('paseodog-provider', 'engine-controls', input);
            if (!['none', 'swarm'].includes(value?.orchestration)) throw new Error('Unsupported orchestration snapshot');
            publish({ mode: value.orchestration });
        } catch {
            publish({ mode: null, error: '협업 설정 결과를 확인할 수 없어요. 눌러서 새로고침하세요. 저장 요청은 자동 재전송하지 않아요.' });
        } finally {
            publish({ busy: false });
        }
    }
    return {
        getSnapshot: () => snapshot,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        refresh: () => request({ action: 'read' }),
        setEnabled: (enabled) => request({ action: 'orchestration', mode: enabled ? 'swarm' : 'none' }),
    };
}

// 이전 설치본(v1·v2)의 직접 스위치. 정확한 이전 문자열을 재생성해 제거하는 용도로만 남기며 바꾸지 않는다.
export function collaborationToggle({ client, provider, React, jsx, Pressable, Text, style, textStyle }) {
    const state = React.useMemo(() => {
        if (!client) return null;
        let state = collaborationHosts.get(client);
        if (!state) {
            state = createCollaborationState(client);
            collaborationHosts.set(client, state);
        }
        return state;
    }, [client]);
    const snapshot = React.useSyncExternalStore(state?.subscribe || emptySubscribe, state?.getSnapshot || emptySnapshot);
    React.useEffect(() => {
        if (!state || provider !== 'paseodog') return;
        void state.refresh();
        // 앱으로 돌아왔을 때 설정 화면이나 다른 클라이언트가 바꾼 호스트 상태를 다시 읽는다.
        const refresh = () => { void state.refresh(); };
        globalThis.addEventListener?.('focus', refresh);
        return () => globalThis.removeEventListener?.('focus', refresh);
    }, [state, provider]);
    if (!state || provider !== 'paseodog') return null;
    const enabled = snapshot.mode === 'swarm';
    const hint = snapshot.error || '이 호스트 전체 · 열린 세션은 다음 요청부터 적용 · 도구 승인 설정은 유지';
    return jsx(Pressable, {
        accessibilityRole: 'switch',
        accessibilityLabel: '협업 (호스트 전체)',
        accessibilityHint: hint,
        accessibilityState: { checked: enabled, disabled: snapshot.busy || !snapshot.mode && !snapshot.error },
        disabled: snapshot.busy || !snapshot.mode && !snapshot.error,
        title: hint,
        testID: 'paseodog-collaboration-toggle',
        style,
        onPress: () => {
            if (!snapshot.mode) void state.refresh();
            else void state.setEnabled(!enabled);
        },
        children: jsx(Text, {
            style: textStyle,
            children: snapshot.error ? '협업 확인 필요' : snapshot.mode ? `협업 ${enabled ? '켜짐' : '꺼짐'} (호스트)` : '협업 확인 중',
        }),
    });
}

// OCHE: 기존 컨트롤과 같은 트리거·Combobox로 메뉴를 열고, 메뉴 안의 스위치로만 호스트 전체 협업을 켜고 끈다.
// 권한 모드·에이전트 활성화·세션 기록은 건드리지 않는다.
export function collaborationMenu({ client, provider, React, jsx, jsxs, View, Text, Trigger, Combobox, ComboboxItem, Icon, useTheme }) {
    const state = React.useMemo(() => {
        if (!client) return null;
        let state = collaborationHosts.get(client);
        if (!state) {
            state = createCollaborationState(client);
            collaborationHosts.set(client, state);
        }
        return state;
    }, [client]);
    const snapshot = React.useSyncExternalStore(state?.subscribe || emptySubscribe, state?.getSnapshot || emptySnapshot);
    const [open, setOpen] = React.useState(false);
    const anchorRef = React.useRef(null);
    const { theme } = useTheme();
    React.useEffect(() => {
        if (!state || provider !== 'paseodog') return;
        void state.refresh();
        // 앱으로 돌아왔을 때 설정 화면이나 다른 클라이언트가 바꾼 호스트 상태를 다시 읽는다.
        const refresh = () => { void state.refresh(); };
        globalThis.addEventListener?.('focus', refresh);
        return () => globalThis.removeEventListener?.('focus', refresh);
    }, [state, provider]);
    if (!state || provider !== 'paseodog') return null;
    const enabled = snapshot.mode === 'swarm';
    const status = snapshot.error ? '확인 필요' : snapshot.busy ? '저장 중' : !snapshot.mode ? '확인 중'
        : enabled ? '켜짐 · 에이전트 협업' : '꺼짐 · 단독 실행';
    const scope = '이 호스트 전체에 적용 · 열린 세션은 다음 요청부터 · 도구 승인 설정은 그대로';
    // 결과를 모를 때는 저장하지 않고 다시 읽기만 하며, 저장 중에는 추가 요청을 보내지 않는다.
    const toggle = () => {
        if (snapshot.busy) return;
        if (!snapshot.mode) void state.refresh();
        else void state.setEnabled(!enabled);
    };
    const switchTrack = jsx(View, {
        style: { width: 32, height: 18, borderRadius: 9, padding: 2, justifyContent: 'center',
            alignItems: enabled ? 'flex-end' : 'flex-start', opacity: snapshot.busy || !snapshot.mode ? 0.5 : 1,
            backgroundColor: enabled ? theme.colors.foreground : theme.colors.border },
        children: jsx(View, { style: { width: 14, height: 14, borderRadius: 7, backgroundColor: theme.colors.surface0 } }),
    });
    return jsxs(React.Fragment, { children: [
        jsx(Trigger, {
            ref: anchorRef, icon: Icon, surface: 'toolbar', label: 'OCHE', showToolbarLabel: true, showCaret: true, open,
            onPress: () => setOpen(!open), accessibilityLabel: `OCHE 오케스트레이션: ${status}`, testID: 'paseodog-oche-trigger',
        }),
        jsx(Combobox, {
            options: [{ id: 'swarm', label: '에이전트 협업' }], value: enabled ? 'swarm' : '', searchable: false,
            title: 'OCHE', open, onOpenChange: setOpen, anchorRef, keepOpenOnSelect: true,
            desktopPlacement: 'top-start', desktopMinWidth: 280, onSelect: toggle,
            header: jsx(View, { style: { paddingHorizontal: 12, paddingVertical: 8 }, children: jsx(Text, {
                style: { color: theme.colors.foregroundMuted, fontSize: 12 }, children: snapshot.error || scope }) }),
            renderOption: ({ option, active, onPress }) => jsx(ComboboxItem, {
                label: option.label, description: status, selected: enabled, active, disabled: snapshot.busy,
                trailingSlot: switchTrack, onPress,
                accessibilityLabel: `에이전트 협업 스위치 (호스트 전체): ${status}`, testID: 'paseodog-oche-switch',
            }),
        }),
    ] });
}

const collaborationHosts = new WeakMap();
const emptyState = { mode: null, busy: false, error: '' };
// 연결이 없는 렌더는 구독 없이 고정 상태를 사용한다.
function emptySubscribe() { return () => {}; }
// 연결 전 상태를 안정된 참조로 반환한다.
function emptySnapshot() { return emptyState; }

export const COLLABORATION_ANCHOR = ',Co});function xe(e){return e.id}';
export const COLLABORATION_RENDER = ',(0,J.jsxs)(J.Fragment,{children:[Co,(0,J.jsx)(PaseodogCollaboration,{client:b,provider:h.provider},n)]})});function xe(e){return e.id}';
// 새 에이전트 입력창(DraftAgentControls)은 RPC 클라이언트를 받지 않으므로 선택된 호스트로 찾아 붙인다.
export const COLLABORATION_DRAFT_ANCHOR = ',o[50]=ae):ae=o[50];return ae};';
export const COLLABORATION_DRAFT_RENDER = ',o[50]=ae):ae=o[50];return (0,J.jsxs)(J.Fragment,{children:[ae,(0,J.jsx)(PaseodogDraftCollaboration,{serverId:L,provider:n},L)]})};';
export const COLLABORATION_SOURCE_ANCHOR = 'const Q=[];function X(e)';
const COLLABORATION_STATE = `const collaborationHosts=new WeakMap();
const emptyState={mode:null,busy:false,error:""};
${emptySubscribe.toString()}
${emptySnapshot.toString()}
${createCollaborationState.toString()}
`;
const DRAFT_WRAPPER = `// 새 에이전트 입력창: 기존 세션 입력창과 같은 세션 저장소에서 선택된 호스트의 RPC 클라이언트를 읽는다.
function PaseodogDraftCollaboration({serverId,provider}){const client=(0,O.useSessionStore)(e=>serverId?e.sessions[serverId]?.client??null:null);return (0,J.jsx)(PaseodogCollaboration,{client,provider})}
`;
const LEGACY_CORE = COLLABORATION_STATE + `${collaborationToggle.toString()}
// 검토된 입력창 모듈의 기존 React·RPC 클라이언트·스타일을 재사용한다.
function PaseodogCollaboration(props){return (0,J.jsx)(collaborationToggle,{...props,React:s,jsx:J.jsx,Pressable:o.Pressable,Text:t.Text,style:Ae.modeBadge,textStyle:Ae.modeBadgeText})}
`;
// 이전 설치본: v1(기존 세션 직접 스위치), v2(새 에이전트 입력창 추가). 정확히 고정된 문자열일 때만 제거한다.
export const LEGACY_COLLABORATION_SOURCES = [
    { version: 1, source: LEGACY_CORE + COLLABORATION_SOURCE_ANCHOR, draft: false },
    { version: 2, source: LEGACY_CORE + DRAFT_WRAPPER + COLLABORATION_SOURCE_ANCHOR, draft: true },
];
const LEGACY_SHA256 = ['99d1c1026e936543f82fefd6914e220e8c64ee6d4a5eca222e2e0a4891dff325', '572c9fbd03d65d8cdb2ccdc4f17ce322c36b6766b045fe171d50b798a2da0566'];
LEGACY_COLLABORATION_SOURCES.forEach(({ source }, index) => {
    if (createHash('sha256').update(source).digest('hex') !== LEGACY_SHA256[index])
        throw new Error('Paseo collaboration legacy source changed; previous installs could not be removed exactly');
});
export const LEGACY_COLLABORATION_SOURCE = LEGACY_COLLABORATION_SOURCES[0].source;
const PREVIOUS_COLLABORATION_SOURCE = COLLABORATION_STATE + `${collaborationMenu.toString()}
// OCHE: 검토된 입력창 모듈의 React·기존 트리거·Combobox·lucide 아이콘·테마 훅을 그대로 쓴다.
function PaseodogCollaboration(props){return (0,J.jsx)(collaborationMenu,{...props,React:s,jsx:J.jsx,jsxs:J.jsxs,View:n.View,Text:t.Text,Trigger:K.AgentControlTrigger,Combobox:A.Combobox,ComboboxItem:A.ComboboxItem,Icon:b.Users,useTheme:f.useUnistyles})}
` + DRAFT_WRAPPER + COLLABORATION_SOURCE_ANCHOR;
const OCHE_COLLABORATION_SOURCE = PREVIOUS_COLLABORATION_SOURCE.replace(
    "icon: Icon, surface: 'toolbar'",
    `icon: (props) => jsx(View, { style: { position: 'relative' }, children: [
        jsx(Icon, { ...props, color: snapshot.error ? '#d97706' : !snapshot.mode || snapshot.busy ? theme.colors.foregroundMuted : enabled ? '#16a34a' : theme.colors.foregroundMuted }),
        jsx(Text, { style: { position: 'absolute', right: -5, top: -7, fontSize: 10, fontWeight: '700', color: snapshot.error ? '#d97706' : enabled ? '#16a34a' : theme.colors.foregroundMuted }, children: snapshot.error ? '!' : !snapshot.mode || snapshot.busy ? '?' : enabled ? '●' : '○' }),
    ] }), surface: 'toolbar'`,
);

// 이전 OCHE 바이트는 업그레이드 해제 전용으로 보존한다.
LEGACY_COLLABORATION_SOURCES.push(
    { version: 3, source: PREVIOUS_COLLABORATION_SOURCE, draft: true },
    { version: 4, source: OCHE_COLLABORATION_SOURCE, draft: true },
);

export function fastToggle({ client, provider, agentId = null, modelId = null, disabled: inputDisabled = false, React, jsx, jsxs, Text, Trigger, Icon, useTheme }) {
    const control = client && provider === 'paseodog' ? getFastControl(client, agentId, modelId) : null;
    const snapshot = React.useSyncExternalStore(control?.subscribe || emptySubscribe, control?.getSnapshot || emptySnapshot);
    const [connected, setConnected] = React.useState(client?.isConnected === true);
    const { theme } = useTheme();
    const EnabledIcon = React.useMemo(() => function FilledFastIcon(props) {
        return jsx(Icon, { ...props, fill: props.color });
    }, [Icon, jsx]);
    React.useEffect(() => {
        if (!control) return;
        const unsubscribe = client.subscribeConnectionStatus((state) => {
            setConnected(state.status === 'connected');
            if (state.status === 'connected') void control.refresh();
        });
        const refresh = () => { if (client.isConnected) void control.refresh(); };
        globalThis.addEventListener?.('focus', refresh);
        return () => { unsubscribe(); globalThis.removeEventListener?.('focus', refresh); };
    }, [control, client, modelId]);
    if (!control) return null;
    const enabled = snapshot.enabled === true;
    const disabled = inputDisabled || !connected || snapshot.busy || !snapshot.error && !snapshot.available;
    const status = snapshot.error ? '확인 필요' : snapshot.busy ? '확인 중'
        : !snapshot.available ? '지원하지 않는 모델' : enabled ? '켜짐' : '꺼짐';
    return jsxs(React.Fragment, { children: [
        jsx(Trigger, {
            icon: enabled ? EnabledIcon : Icon, iconColor: snapshot.error ? theme.colors.destructive : enabled ? theme.colors.accent : theme.colors.foregroundMuted,
            surface: 'toolbar', label: 'Fast', showToolbarLabel: false, showCaret: false, open: enabled,
            accessibilityRole: 'switch', accessibilityLabel: `Fast mode: ${status}`,
            accessibilityHint: snapshot.error || (agentId ? '이 세션의 다음 요청부터 적용 · 추가 요금이 발생할 수 있어요'
                : '새 세션의 기본값 · 추가 요금이 발생할 수 있어요'),
            accessibilityState: { checked: snapshot.error ? 'mixed' : enabled, disabled, busy: snapshot.busy },
            disabled, testID: 'paseodog-fast-toggle',
            onPress: () => { if (!disabled) void control.toggle(); },
        }),
        snapshot.error ? jsx(Text, { accessibilityLiveRegion: 'polite', style: { color: theme.colors.destructive }, children: snapshot.error }) : null,
    ] });
}

export const COLLABORATION_SOURCE = `const fastControls=new WeakMap();
const emptyState={enabled:null,available:false,busy:false,error:""};
${emptySubscribe.toString()}
${emptySnapshot.toString()}
${createFastControl.toString()}
${getFastControl.toString()}
${fastToggle.toString()}
function PaseodogFastControls(props){return (0,J.jsx)(ve,{...props,features:"paseodog"===props.provider?props.features?.filter(e=>e.id!=="fast"):props.features})}
function PaseodogCollaboration(props){return (0,J.jsx)(fastToggle,{...props,React:s,jsx:J.jsx,jsxs:J.jsxs,Text:t.Text,Trigger:K.AgentControlTrigger,Icon:b.Zap,useTheme:f.useUnistyles})}
function PaseodogDraftCollaboration({serverId,provider,modelId,disabled}){const client=(0,O.useSessionStore)(e=>serverId?e.sessions[serverId]?.client??null:null);return (0,J.jsx)(PaseodogCollaboration,{client,provider,modelId,disabled})}
${COLLABORATION_SOURCE_ANCHOR}`;
const previousFastSource = COLLABORATION_SOURCE
    .replace(createFastControl.toString(), previousFastControl.toString())
    .replace(fastToggle.toString(), previousFastToggle.toString());
export const PREVIOUS_FAST_SOURCES = [
    previousFastSource,
    previousFastSource.replace('Boolean(value.route.model?.trim()) && ', ''),
];
export const FAST_RENDER = COLLABORATION_RENDER.replace('client:b,provider:h.provider', 'client:b,provider:h.provider,agentId:t,modelId:ho,disabled:mo');
export const FAST_DRAFT_RENDER = COLLABORATION_DRAFT_RENDER.replace('serverId:L,provider:n', 'serverId:L,provider:n,modelId:h,disabled:F');
const FAST_FEATURE_ANCHOR = 'jsx:J.jsx,Controls:ve})}';
const FAST_FEATURE_RENDER = 'jsx:J.jsx,Controls:PaseodogFastControls})}';

// 현재·이전 협업 훅 전체가 정확히 하나만 있을 때만 제거해 원본 해시 검증을 유지한다.
export function withoutCollaboration(source) {
    const render = source.includes(FAST_RENDER) ? FAST_RENDER : COLLABORATION_RENDER;
    const hasRender = source.includes(render);
    const draftRender = source.includes(FAST_DRAFT_RENDER) ? FAST_DRAFT_RENDER : COLLABORATION_DRAFT_RENDER;
    const hasDraft = source.includes(draftRender);
    const found = [
        { version: 6, source: COLLABORATION_SOURCE, draft: true },
        ...PREVIOUS_FAST_SOURCES.map((source) => ({ version: 5, source, draft: true })),
        ...LEGACY_COLLABORATION_SOURCES,
    ]
        .filter((entry) => source.includes(entry.source));
    if (!found.length && !hasRender && !hasDraft) return source;
    if (found.length !== 1 || !hasRender || found[0].draft !== hasDraft) throw new Error('Partial Paseo collaboration patch');
    if (found[0].version >= 5 && (render !== FAST_RENDER || draftRender !== FAST_DRAFT_RENDER))
        throw new Error('Partial Paseo collaboration patch');
    if (found[0].version >= 5 && !source.includes(FAST_FEATURE_RENDER))
        throw new Error('Partial Paseo collaboration patch');
    return source.replace(found[0].source, COLLABORATION_SOURCE_ANCHOR)
        .replace(FAST_FEATURE_RENDER, FAST_FEATURE_ANCHOR)
        .replace(render, COLLABORATION_ANCHOR)
        .replace(draftRender, COLLABORATION_DRAFT_ANCHOR);
}

// 전체 원본 해시를 통과한 번들의 정확한 세 앵커에만 훅을 붙인다.
export function withCollaboration(source) {
    for (const anchor of [COLLABORATION_SOURCE_ANCHOR, COLLABORATION_ANCHOR, COLLABORATION_DRAFT_ANCHOR, FAST_FEATURE_ANCHOR]) {
        if (source.split(anchor).length !== 2) throw new Error('Paseo collaboration anchor mismatch');
    }
    return source.replace(COLLABORATION_SOURCE_ANCHOR, COLLABORATION_SOURCE)
        .replace(FAST_FEATURE_ANCHOR, FAST_FEATURE_RENDER)
        .replace(COLLABORATION_ANCHOR, FAST_RENDER)
        .replace(COLLABORATION_DRAFT_ANCHOR, FAST_DRAFT_RENDER);
}

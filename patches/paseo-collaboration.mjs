import { createHash } from 'node:crypto';
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
export const COLLABORATION_SOURCE = PREVIOUS_COLLABORATION_SOURCE.replace(
    "icon: Icon, surface: 'toolbar'",
    `icon: (props) => jsx(View, { style: { position: 'relative' }, children: [
        jsx(Icon, { ...props, color: snapshot.error ? '#d97706' : !snapshot.mode || snapshot.busy ? theme.colors.foregroundMuted : enabled ? '#16a34a' : theme.colors.foregroundMuted }),
        jsx(Text, { style: { position: 'absolute', right: -5, top: -7, fontSize: 10, fontWeight: '700', color: snapshot.error ? '#d97706' : enabled ? '#16a34a' : theme.colors.foregroundMuted }, children: snapshot.error ? '!' : !snapshot.mode || snapshot.busy ? '?' : enabled ? '●' : '○' }),
    ] }), surface: 'toolbar'`,
);

// 현재·이전 협업 훅 전체가 정확히 하나만 있을 때만 제거해 원본 해시 검증을 유지한다.
export function withoutCollaboration(source) {
    const hasRender = source.includes(COLLABORATION_RENDER);
    const hasDraft = source.includes(COLLABORATION_DRAFT_RENDER);
    const found = [{ version: 4, source: COLLABORATION_SOURCE, draft: true }, { version: 3, source: PREVIOUS_COLLABORATION_SOURCE, draft: true }, ...LEGACY_COLLABORATION_SOURCES]
        .filter((entry) => source.includes(entry.source));
    if (!found.length && !hasRender && !hasDraft) return source;
    if (found.length !== 1 || !hasRender || found[0].draft !== hasDraft) throw new Error('Partial Paseo collaboration patch');
    return source.replace(found[0].source, COLLABORATION_SOURCE_ANCHOR)
        .replace(COLLABORATION_RENDER, COLLABORATION_ANCHOR)
        .replace(COLLABORATION_DRAFT_RENDER, COLLABORATION_DRAFT_ANCHOR);
}

// 전체 원본 해시를 통과한 번들의 정확한 세 앵커에만 훅을 붙인다.
export function withCollaboration(source) {
    for (const anchor of [COLLABORATION_SOURCE_ANCHOR, COLLABORATION_ANCHOR, COLLABORATION_DRAFT_ANCHOR]) {
        if (source.split(anchor).length !== 2) throw new Error('Paseo collaboration anchor mismatch');
    }
    return source.replace(COLLABORATION_SOURCE_ANCHOR, COLLABORATION_SOURCE)
        .replace(COLLABORATION_ANCHOR, COLLABORATION_RENDER)
        .replace(COLLABORATION_DRAFT_ANCHOR, COLLABORATION_DRAFT_RENDER);
}

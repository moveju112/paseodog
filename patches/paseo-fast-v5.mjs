// 기존 v5 설치본을 정확히 해제하기 위한 고정 원본. 실행 경로로 사용하지 않는다.
export function createFastControl(client, agentId = null, modelId = null) {
  let snapshot = { enabled: null, available: false, busy: false, error: "" };
  const listeners = new Set();
  function publish(update) {
    snapshot = { ...snapshot, ...update };
    for (const listener of listeners) listener();
  }
  async function read() {
    if (agentId) {
      const result = await client.fetchAgent(agentId);
      if (!result?.agent) throw new Error("Session is unavailable");
      const feature = result.agent.features?.find((item) => item.id === "fast");
      publish({
        enabled: feature?.type === "toggle" ? feature.value : false,
        available: feature?.type === "toggle" && typeof feature.value === "boolean",
      });
    } else {
      const value = await client.invokePluginRpc("paseodog-provider", "engine-controls", { action: "read" });
      if (typeof value?.route?.fast !== "boolean" || !Array.isArray(value.models))
        throw new Error("Unsupported Fast snapshot");
      const model = value.models.find((item) => modelId && modelId !== "mixdog-default"
        ? `${item.provider}/${item.id}` === modelId
        : item.provider === value.route.provider && item.id === value.route.model);
      publish({ enabled: value.route.fast, available: Boolean(value.route.model?.trim()) && model?.fastCapable === true });
    }
  }
  // 결과가 불확실하면 다음 누름도 조회만 한다. 쓰기는 자동 재전송하지 않는다.
  async function request(toggle = false) {
    if (snapshot.busy) return;
    const write = toggle && !snapshot.error && snapshot.enabled !== null && snapshot.available;
    const enabled = !snapshot.enabled;
    publish({ busy: true, error: "" });
    try {
      if (!client.isConnected) throw new Error("Host disconnected");
      if (write) {
        if (agentId) await client.setAgentFeature(agentId, "fast", enabled);
        else await client.invokePluginRpc("paseodog-provider", "engine-controls",
          { action: "main", route: { fast: enabled } });
      }
      await read();
    } catch {
      publish({ enabled: null, error: "Fast 설정 결과를 확인할 수 없어요. 눌러서 새로고침하세요. 저장 요청은 자동 재전송하지 않아요." });
    } finally {
      publish({ busy: false });
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh: () => request(),
    toggle: () => request(true),
  };
}

export function fastToggle({ client, provider, agentId = null, modelId = null, disabled: inputDisabled = false, React, jsx, jsxs, Text, Trigger, Icon, useTheme }) {
    const control = client && provider === 'paseodog' ? getFastControl(client, agentId, modelId) : null;
    const snapshot = React.useSyncExternalStore(control?.subscribe || emptySubscribe, control?.getSnapshot || emptySnapshot);
    const [connected, setConnected] = React.useState(client?.isConnected === true);
    const { theme } = useTheme();
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
    const enabled = snapshot.enabled === true && !snapshot.error;
    const disabled = inputDisabled || !connected || snapshot.busy || !snapshot.error && !snapshot.available;
    const status = snapshot.error ? '확인 필요' : snapshot.busy ? '확인 중'
        : !snapshot.available ? '지원하지 않는 모델' : enabled ? '켜짐' : '꺼짐';
    return jsxs(React.Fragment, { children: [
        jsx(Trigger, {
            icon: Icon, iconColor: snapshot.error ? theme.colors.destructive : enabled ? theme.colors.accent : theme.colors.foregroundMuted,
            surface: 'toolbar', label: 'Fast', showToolbarLabel: false, showCaret: false, open: enabled,
            accessibilityRole: 'switch', accessibilityLabel: `Fast mode: ${status}`,
            accessibilityHint: snapshot.error || (agentId ? '이 세션의 다음 요청부터 적용 · 추가 요금이 발생할 수 있어요'
                : '새 세션의 기본값 · 추가 요금이 발생할 수 있어요'),
            accessibilityState: { checked: enabled, disabled, busy: snapshot.busy },
            disabled, testID: 'paseodog-fast-toggle',
            onPress: () => { if (!disabled) void control.toggle(); },
        }),
        snapshot.error ? jsx(Text, { accessibilityLiveRegion: 'polite', style: { color: theme.colors.destructive }, children: snapshot.error }) : null,
    ] });
}

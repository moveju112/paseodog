// 네이티브 앱과 고정 웹 번들이 같은 저장·확인 계약을 사용한다.
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
      const value = await client.invokePluginRpc("paseodog-provider", "engine-controls", {
        action: "read",
      });
      if (typeof value?.route?.fast !== "boolean" || !Array.isArray(value.models))
        throw new Error("Unsupported Fast snapshot");
      const model = value.models.find((item) =>
        modelId && modelId !== "mixdog-default"
          ? `${item.provider}/${item.id}` === modelId
          : item.provider === value.route.provider && item.id === value.route.model,
      );
      publish({
        enabled: value.route.fast,
        available: Boolean(value.route.model?.trim()) && model?.fastCapable === true,
      });
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
        else
          await client.invokePluginRpc("paseodog-provider", "engine-controls", {
            action: "main",
            route: { fast: enabled },
          });
      }
      await read();
    } catch (error) {
      const activeTurnError =
        "응답 중에는 모델·추론 수준·설정을 바꿀 수 없어요. 응답이 끝날 때까지 기다리거나 응답을 중지한 뒤 다시 선택해 주세요.";
      // 실패를 꺼짐으로 바꾸지 않는다. 마지막 확인 값은 남기고 불확실함은 별도로 표시한다.
      publish({
        error:
          error instanceof Error && error.message === activeTurnError
            ? `${activeTurnError} 다시 누르면 현재 상태만 확인해요.`
            : "Fast 설정 결과를 확인할 수 없어요. 눌러서 새로고침하세요. 저장 요청은 자동 재전송하지 않아요.",
      });
    } finally {
      publish({ busy: false });
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh: () => request(),
    toggle: () => request(true),
  };
}

const fastControls = new WeakMap();

// 호스트·세션별로 공유하되 다른 세션의 저장 상태를 섞지 않는다.
export function getFastControl(client, agentId = null, modelId = null) {
  let controls = fastControls.get(client);
  if (!controls) {
    controls = new Map();
    fastControls.set(client, controls);
  }
  const key = JSON.stringify([agentId, agentId ? null : modelId]);
  if (!controls.has(key)) controls.set(key, createFastControl(client, agentId, modelId));
  return controls.get(key);
}

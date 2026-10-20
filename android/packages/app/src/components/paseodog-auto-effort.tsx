import { useEffect, useMemo, useState } from "react";
import type { AgentFeature } from "@getpaseo/protocol/agent-types";
import { usePaseodogAutoEffortHost } from "@/hooks/use-paseodog-host-control";
import { toErrorMessage } from "@/utils/error-messages";

export const AUTO_EFFORT_ID = "paseodog:auto-effort";

interface ThinkingOption {
  id: string;
  label: string;
}

interface AutoEffortProps {
  provider: string;
  scope: "live" | "draft";
  serverId: string | null;
  agentId?: string;
  thinkingOptions?: ThinkingOption[];
  selectedThinkingOptionId?: string;
  onSelectThinkingOption?: (id: string) => void;
  features?: AgentFeature[];
}

type HostControl = ReturnType<typeof usePaseodogAutoEffortHost>;

interface LiveScope {
  client: HostControl["client"];
  agentId?: string;
  provider: string;
  scope: AutoEffortProps["scope"];
  serverId: string | null;
  busy: boolean;
  active: boolean;
}

interface LiveSave {
  key: LiveScope;
  busy: boolean;
  error: string;
}

// 현재 세션 기능 또는 호스트 모듈이 실제 지원하는 경우에만 자동 항목을 만든다.
function canUseAutoEffort(
  props: AutoEffortProps,
  host: HostControl,
  toggle: AgentFeature | undefined,
) {
  if (props.provider !== "paseodog" || !props.thinkingOptions?.length) return false;
  if (props.scope === "live") {
    return (
      toggle?.type === "toggle" &&
      typeof toggle.value === "boolean" &&
      !!props.agentId &&
      !!host.client
    );
  }
  const module = host.snapshot.value?.toolModules?.autoEffort;
  return module?.supported !== false && module?.enabled === true;
}

// 세션 또는 호스트의 확인된 상태와 저장 진행·실패를 Effort 항목에 표시한다.
function resolveAutoEffortPresentation(
  scope: AutoEffortProps["scope"],
  host: HostControl,
  toggle: AgentFeature | undefined,
  liveSave: LiveSave,
) {
  const busy = scope === "live" ? liveSave.busy : host.snapshot.busy;
  const error = scope === "live" ? liveSave.error : host.snapshot.error;
  const enabled =
    scope === "live"
      ? toggle?.value === true
      : !host.snapshot.error && host.snapshot.value?.route.autoEffort === true;
  let label = "Auto";
  if (busy) label = "자동 추론 (저장 중)";
  if (error) label = "자동 추론 (확인 필요)";
  return { busy, error, enabled, label };
}

// 자동 추론을 Effort 항목으로만 제공하고 세션과 호스트의 저장 경계를 나눈다.
export function usePaseodogAutoEffort(props: AutoEffortProps) {
  const {
    provider,
    scope,
    serverId,
    agentId,
    features,
    thinkingOptions,
    selectedThinkingOptionId,
    onSelectThinkingOption,
  } = props;
  const host = usePaseodogAutoEffortHost(serverId, provider === "paseodog" && scope === "draft");
  const liveKey = useMemo<LiveScope>(
    () => ({ client: host.client, agentId, provider, scope, serverId, busy: false, active: true }),
    [host.client, agentId, provider, scope, serverId],
  );
  useEffect(() => {
    liveKey.active = true;
    return () => {
      liveKey.active = false;
    };
  }, [liveKey]);
  const [saved, setSaved] = useState<LiveSave>({ key: liveKey, busy: false, error: "" });
  const liveSave = saved.key === liveKey ? saved : { key: liveKey, busy: false, error: "" };
  const toggle = features?.find((feature) => feature.id === "autoEffort");
  const available = canUseAutoEffort(props, host, toggle);
  const { busy, error, enabled, label } = resolveAutoEffortPresentation(
    scope,
    host,
    toggle,
    liveSave,
  );

  // 초안의 수동 선택은 Main 자동 추론 해제가 확인된 뒤에만 전달한다.
  async function selectDraft(id: string) {
    if (!host.control) return;
    if (host.snapshot.error || !host.snapshot.value) {
      await host.control.refresh();
      return;
    }
    if (id === AUTO_EFFORT_ID) {
      if (!enabled) await host.control.request({ action: "main", route: { autoEffort: true } });
      return;
    }
    if (!enabled) {
      onSelectThinkingOption?.(id);
      return;
    }
    const confirmed = await host.control.request({ action: "main", route: { autoEffort: false } });
    if (confirmed && liveKey.active) onSelectThinkingOption?.(id);
  }

  // 열린 세션은 세션 기능만 저장하고 수동 수준은 기존 경로로 보낸다.
  async function selectLive(id: string) {
    if (id !== AUTO_EFFORT_ID) {
      setSaved({ key: liveKey, busy: false, error: "" });
      onSelectThinkingOption?.(id);
      return;
    }
    if (enabled || !host.client || !agentId) return;
    liveKey.busy = true;
    setSaved({ key: liveKey, busy: true, error: "" });
    try {
      await host.client.setAgentFeature(agentId, "autoEffort", true);
      setSaved((current) =>
        current.key === liveKey ? { key: liveKey, busy: false, error: "" } : current,
      );
    } catch (failure) {
      setSaved((current) =>
        current.key === liveKey
          ? { key: liveKey, busy: false, error: toErrorMessage(failure) }
          : current,
      );
    } finally {
      liveKey.busy = false;
    }
  }

  // 진행 중인 선택을 중복 제출하지 않고 실제 저장 범위로 한 번만 보낸다.
  function select(id: string) {
    if (!available) {
      onSelectThinkingOption?.(id);
      return;
    }
    if (!host.connected || busy || liveKey.busy || host.control?.getSnapshot().busy) return;
    if (scope === "draft") void selectDraft(id);
    else void selectLive(id);
  }

  return {
    thinkingOptions: available
      ? [
          { id: AUTO_EFFORT_ID, label },
          ...(thinkingOptions ?? []).filter((option) => option.id !== AUTO_EFFORT_ID),
        ]
      : thinkingOptions,
    selectedThinkingOptionId: available && enabled ? AUTO_EFFORT_ID : selectedThinkingOptionId,
    onSelectThinkingOption: select,
    features: available ? features?.filter((feature) => feature !== toggle) : features,
    busy: available && busy,
    error: available ? error : "",
  };
}

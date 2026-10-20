import { useCallback, useEffect, useRef, useState } from "react";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import {
  invalidatePaseodogHostControls,
  subscribePaseodogHostSettings,
} from "@/hooks/use-paseodog-host-control";
import {
  engineSnapshotSchema,
  type EngineSnapshot,
  type EngineCommand,
  type RoutePatch,
} from "./ai-engine-contract";

const snapshotCache = new Map<string, EngineSnapshot>();

// 테스트나 호스트 초기화 시 스냅샷 캐시를 비운다.
export function clearAiEngineSnapshotCache(serverId?: string) {
  if (serverId) snapshotCache.delete(serverId);
  else snapshotCache.clear();
}

// 경로 변경분 중 지정된 항목만 기존 경로에 덮어쓴다 (변경분 -> 경로).
function mergeRoute(route: EngineSnapshot["route"], patch: RoutePatch): EngineSnapshot["route"] {
  const next = { ...route };
  for (const key of ["provider", "model", "effort", "fast", "autoEffort", "fallbacks"] as const) {
    if (patch[key] !== undefined) Object.assign(next, { [key]: patch[key] });
  }
  if (patch.contextPercent !== undefined) {
    if (patch.contextPercent === null || patch.contextPercent === 0) delete next.contextPercent;
    else next.contextPercent = patch.contextPercent;
  }
  if (patch.contextTokens !== undefined) {
    if (patch.contextTokens === null || patch.contextTokens === 0) delete next.contextTokens;
    else next.contextTokens = patch.contextTokens;
  }
  return next;
}

// 서버 응답 전에 스냅샷을 낙관적으로 갱신하여 UI 지연을 없앤다.
function applyOptimisticCommand(
  prev: EngineSnapshot | null,
  command: EngineCommand,
): EngineSnapshot | null {
  if (!prev) return prev;
  switch (command.action) {
    case "main":
      return { ...prev, route: mergeRoute(prev.route, command.route) };
    case "agent":
      return {
        ...prev,
        agents: prev.agents.map((item) =>
          item.id === command.agent
            ? {
                ...item,
                ...(typeof command.route.disabled === "boolean"
                  ? { disabled: command.route.disabled }
                  : {}),
                route: mergeRoute(item.route, command.route),
              }
            : item,
        ),
      };
    case "workflow":
      return {
        ...prev,
        workflows: prev.workflows.map((item) => ({
          ...item,
          active: item.id === command.workflow,
        })),
      };
    case "orchestration":
      return {
        ...prev,
        orchestration: command.mode,
      };
    case "instructionFiles":
      return {
        ...prev,
        instructionFiles:
          command.instructionMode ?? (command.enabled ? "all" : "off"),
      };
    case "compaction":
      return {
        ...prev,
        compaction: {
          ...prev.compaction,
          ...(typeof command.enabled === "boolean" ? { auto: command.enabled } : {}),
          ...(typeof command.onModelChange === "boolean"
            ? { onModelChange: command.onModelChange }
            : {}),
          ...(typeof command.mainBufferPercent === "number"
            ? {
                mainBufferPercent: command.mainBufferPercent,
                mainBufferRatio: Math.round(command.mainBufferPercent * 100),
              }
            : {}),
          ...(typeof command.mainBufferTokens === "number"
            ? { mainBufferTokens: command.mainBufferTokens }
            : {}),
          ...(typeof command.summaryModel === "string"
            ? { summaryModel: command.summaryModel }
            : {}),
          ...(typeof command.memoryTimeoutMs === "number"
            ? { memoryTimeoutMs: command.memoryTimeoutMs }
            : {}),
        },
      };
    case "autoClear":
      if (!prev.autoClear) return prev;
      return {
        ...prev,
        autoClear: {
          ...prev.autoClear,
          ...(typeof command.enabled === "boolean" ? { enabled: command.enabled } : {}),
          ...(typeof command.idleMs === "number"
            ? {
                idleMs: command.idleMs,
                idleMinutes: Math.max(1, Math.round(command.idleMs / 60000)),
              }
            : {}),
          ...(typeof command.minContextPercent === "number"
            ? { minContextPercent: command.minContextPercent }
            : {}),
        },
      };
    case "features": {
      const next = { ...prev };
      if (typeof command.recap === "boolean") next.recap = command.recap;
      if (next.toolModules) {
        const tm = { ...next.toolModules };
        if (typeof command.webSearch === "boolean") tm.webSearch = command.webSearch;
        if (typeof command.memoryTools === "boolean")
          tm.memory = { ...tm.memory, enabled: command.memoryTools };
        if (command.builtinTool && typeof command.enabled === "boolean") {
          const key = command.builtinTool as keyof typeof tm;
          if (key in tm && typeof tm[key] === "object") {
            (tm as Record<string, unknown>)[key] = {
              ...(tm[key] as object),
              enabled: command.enabled,
            };
          }
        }
        next.toolModules = tm;
      }
      if (command.webSearchRoute && next.webSearchRoute) {
        next.webSearchRoute = { ...next.webSearchRoute, ...command.webSearchRoute };
      }
      return next;
    }
    case "preferences": {
      const next = { ...prev };
      if (typeof command.outputStyle === "string") next.outputStyle = command.outputStyle;
      if (command.profile) next.profile = { ...next.profile, ...command.profile };
      if (typeof command.aiSessionTitles === "boolean")
        next.aiSessionTitles = command.aiSessionTitles;
      if (typeof command.shellCommand === "string" && next.shell)
        next.shell = { ...next.shell, command: command.shellCommand };
      if (command.worktree && next.worktree)
        next.worktree = { ...next.worktree, ...command.worktree };
      if (command.disabledSkills && next.skills) {
        const disabledSet = new Set(command.disabledSkills);
        next.skills = {
          disabled: command.disabledSkills,
          items: next.skills.items.map((s) => ({ ...s, disabled: disabledSet.has(s.name) })),
        };
      }
      return next;
    }
    default:
      return prev;
  }
}

// 설정 화면과 모델 선택창이 같은 호스트 설정을 즉시(낙관적 UI) 조회·저장하며 오래된 응답은 버린다.
export function useAiEngineSettings(serverId: string) {
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const [snapshot, setSnapshot] = useState<EngineSnapshot | null>(
    () => snapshotCache.get(serverId) ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [refreshRequested, setRefreshRequested] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const generation = useRef(0);
  const requestSeq = useRef(0);
  // 서버가 마지막으로 확인한 스냅샷 (저장 실패 시 낙관적 값을 되돌릴 기준)
  const confirmedSnapshot = useRef<EngineSnapshot | null>(snapshotCache.get(serverId) ?? null);
  // 확인값을 만든 가장 최근 요청 번호 (늦게 도착한 오래된 성공 응답이 기준을 되돌리지 않게 한다)
  const confirmedSeq = useRef(0);

  const request = useCallback(
    async (command: EngineCommand) => {
      if (!client || !connected) return false;
      const currentGen = generation.current;
      const currentReq = ++requestSeq.current;
      // 조회 전용 요청은 저장 메시지·낙관적 반영 없이 서버 응답만 사용한다.
      const isQuery =
        command.action === "read" ||
        command.action === "workflowPack" ||
        command.action === "agentDefinition";
      setBusy(true);
      if (!isQuery) {
        // 낙관적 값은 이 화면에만 반영하고, 공유 캐시는 서버 확인값만 보관한다
        setSnapshot((prev) => applyOptimisticCommand(prev, command));
      }
      setError("");
      if (!isQuery) {
        setMessage("저장 중…");
      }
      try {
        const result = await client.invokePluginRpc(
          "paseodog-provider",
          "engine-controls",
          command,
        );
        const next = engineSnapshotSchema.parse(result);
        if (currentGen !== generation.current) return false;
        if (currentReq > confirmedSeq.current) {
          confirmedSeq.current = currentReq;
          confirmedSnapshot.current = next;
          snapshotCache.set(serverId, next);
        }
        if (currentReq !== requestSeq.current) return false;
        setSnapshot(next);
        if (!isQuery) {
          setMessage(command.action.startsWith("workflow")
            ? "저장했어요. 워크플로우 지침은 다음 요청부터 반영돼요."
            : "저장했어요. 실시간으로 반영돼요.");
        }
        return true;
      } catch {
        if (currentGen !== generation.current || currentReq !== requestSeq.current) return false;
        if (!isQuery) {
          setMessage("");
          // 실패한 저장의 낙관적 값을 화면에 남기지 않는다 (마지막 확인값으로 복원)
          setSnapshot(confirmedSnapshot.current);
        }
        if (command.action === "read") {
          confirmedSeq.current = currentReq;
          confirmedSnapshot.current = null;
          snapshotCache.delete(serverId);
          setSnapshot(null);
        }
        const failures: Partial<Record<EngineCommand["action"], string>> = {
          read: "AI 엔진을 불러오지 못했어요. 연결한 호스트가 PaseoDog 서버인지 확인해 주세요.",
          agentDefinition:
            "원본 정의를 불러오지 못했어요. 서버의 AI 엔진 업데이트를 확인해 주세요.",
        };
        setError(
          failures[command.action] ??
            "저장 결과를 확인하지 못했어요. 새로고침으로 현재 설정을 확인해 주세요.",
        );
        return false;
      } finally {
        if (!isQuery) invalidatePaseodogHostControls(client);
        if (currentGen === generation.current && currentReq === requestSeq.current) {
          setBusy(false);
        }
      }
    },
    [client, connected, serverId],
  );

  // 진행 중인 응답을 모두 무효화한다 (호스트 변경·화면 해제 -> 늦은 응답 폐기).
  const invalidateResponses = useCallback(() => {
    generation.current++;
  }, []);

  useEffect(() => {
    invalidateResponses();
    requestSeq.current = 0;
    confirmedSeq.current = 0;
    const cached = snapshotCache.get(serverId) ?? null;
    confirmedSnapshot.current = cached;
    setSnapshot(cached);
    void request({ action: "read" });
    return invalidateResponses;
  }, [invalidateResponses, request, serverId]);

  // 입력창의 Main 저장 후에는 진행 중 요청을 끝낸 다음 조회만 새로 한다.
  useEffect(() => {
    if (!client) return;
    return subscribePaseodogHostSettings(client, () => setRefreshRequested(true));
  }, [client]);
  useEffect(() => {
    if (!refreshRequested || busy) return;
    setRefreshRequested(false);
    void request({ action: "read" });
  }, [busy, refreshRequested, request]);

  return { snapshot, busy, connected, error, message, request };
}

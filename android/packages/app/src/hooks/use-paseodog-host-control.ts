import { useEffect, useSyncExternalStore } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { z } from "zod";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useAppActivelyVisible } from "@/hooks/use-app-visible";
import type { EngineCommand } from "@/screens/settings/ai-engine-contract";

type ControlClient = Pick<DaemonClient, "invokePluginRpc">;

interface ControlSnapshot<T> {
  value: T | null;
  busy: boolean;
  error: string;
}

// 호스트 응답만 확정하고, 결과를 모르는 쓰기는 다시 보내지 않는다.
export function createConfirmedHostControl<T>(
  client: ControlClient,
  schema: z.ZodType<T>,
  failureMessage: string,
  onMutation?: () => void,
) {
  let snapshot: ControlSnapshot<T> = { value: null, busy: false, error: "" };
  let revision = 0;
  let refreshPending = false;
  const listeners = new Set<() => void>();
  // 같은 호스트의 모든 입력창에 확인 상태를 전달한다.
  function publish(update: Partial<ControlSnapshot<T>>) {
    snapshot = { ...snapshot, ...update };
    for (const listener of listeners) listener();
  }
  // 중복 요청을 막고 성공 응답이 확인된 경우에만 후속 선택을 허용한다.
  async function request(command: EngineCommand): Promise<boolean> {
    if (snapshot.busy) return false;
    const requestRevision = revision;
    publish({ busy: true, error: "" });
    try {
      const result = await client.invokePluginRpc("paseodog-provider", "engine-controls", command);
      const value = schema.parse(result);
      if (requestRevision !== revision) return false;
      publish({ value });
      return true;
    } catch {
      publish({ error: failureMessage });
      return false;
    } finally {
      publish({ busy: false });
      if (command.action !== "read") onMutation?.();
      if (refreshPending) {
        refreshPending = false;
        void request({ action: "read" });
      }
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    request,
    refresh: () => request({ action: "read" }),
    // 다른 설정 화면의 저장 이후 오래된 조회 응답은 버리고 조회만 다시 한다.
    invalidate() {
      revision++;
      if (snapshot.busy) refreshPending = true;
      else void request({ action: "read" });
    },
  };
}

export const autoEffortSnapshotSchema = z.object({
  route: z.object({ autoEffort: z.boolean(), model: z.string().optional() }),
  toolModules: z
    .object({
      autoEffort: z.object({ supported: z.boolean().optional(), enabled: z.boolean() }).optional(),
    })
    .optional(),
});
export const collaborationSnapshotSchema = z.object({
  orchestration: z.enum(["none", "swarm"]),
});

const autoEffortHosts = new WeakMap<ControlClient, ReturnType<typeof createAutoEffortControl>>();
const collaborationHosts = new WeakMap<
  ControlClient,
  ReturnType<typeof createCollaborationControl>
>();
const settingsListeners = new WeakMap<ControlClient, Set<() => void>>();

// 입력창의 호스트 설정 변경은 설정 화면에 조회 필요 신호만 전달한다.
function notifySettingsListeners(client: ControlClient) {
  for (const listener of settingsListeners.get(client) ?? []) listener();
}

// 설정 화면을 벗어나면 구독만 해제하고 다른 화면의 상태는 보존한다.
export function subscribePaseodogHostSettings(client: ControlClient, listener: () => void) {
  const listeners = settingsListeners.get(client) ?? new Set<() => void>();
  settingsListeners.set(client, listeners);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// 설정 화면의 저장 성공·실패 모두 확정값을 조회하며 쓰기는 재전송하지 않는다.
export function invalidatePaseodogHostControls(client: ControlClient) {
  autoEffortHosts.get(client)?.invalidate();
  collaborationHosts.get(client)?.invalidate();
}

// Main 자동 추론의 확인 결과를 호스트별로 공유한다.
export function createAutoEffortControl(client: ControlClient) {
  return createConfirmedHostControl(
    client,
    autoEffortSnapshotSchema,
    "자동 추론 설정 결과를 확인할 수 없어요. 다시 선택하면 새로고침만 해요.",
    () => notifySettingsListeners(client),
  );
}

// 협업 모드는 권한 설정과 분리된 호스트 전체 설정이다.
export function createCollaborationControl(client: ControlClient) {
  return createConfirmedHostControl(
    client,
    collaborationSnapshotSchema,
    "협업 설정 결과를 확인할 수 없어요. 눌러서 새로고침하세요. 저장 요청은 자동 재전송하지 않아요.",
    () => notifySettingsListeners(client),
  );
}

const emptySnapshot: ControlSnapshot<never> = { value: null, busy: false, error: "" };
// 연결 전에도 동일한 스냅샷 참조를 반환한다.
function getEmptySnapshot() {
  return emptySnapshot;
}
// 연결 전에는 외부 저장소를 구독하지 않는다.
function emptySubscribe() {
  return () => {};
}

// 앱 복귀·재연결에는 조회만 하고, 쓰기 실패를 자동 재전송하지 않는다.
export function usePaseodogHostControl<T>(
  serverId: string | null,
  enabled: boolean,
  hosts: WeakMap<ControlClient, ReturnType<typeof createConfirmedHostControl<T>>>,
  create: (client: ControlClient) => ReturnType<typeof createConfirmedHostControl<T>>,
) {
  const client = useHostRuntimeClient(serverId ?? "");
  const connected = useHostRuntimeIsConnected(serverId ?? "");
  const visible = useAppActivelyVisible();
  let control = null;
  if (client && serverId && enabled) {
    control = hosts.get(client) ?? create(client);
    hosts.set(client, control);
  }
  const snapshot = useSyncExternalStore(
    control?.subscribe ?? emptySubscribe,
    control?.getSnapshot ?? getEmptySnapshot,
    control?.getSnapshot ?? getEmptySnapshot,
  );
  useEffect(() => {
    if (control && connected && visible) void control.refresh();
  }, [control, connected, visible]);
  return { control, snapshot, client, connected };
}

// 새 세션에 상속할 Main 자동 추론만 조회한다.
export function usePaseodogAutoEffortHost(serverId: string | null, enabled: boolean) {
  return usePaseodogHostControl(serverId, enabled, autoEffortHosts, createAutoEffortControl);
}

// 열린 세션·초안 모두 같은 호스트 협업 상태를 사용한다.
export function usePaseodogCollaborationHost(serverId: string | null, enabled: boolean) {
  return usePaseodogHostControl(serverId, enabled, collaborationHosts, createCollaborationControl);
}

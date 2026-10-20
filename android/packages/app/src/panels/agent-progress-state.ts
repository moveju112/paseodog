import { z } from "zod";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { Agent } from "@/stores/session-store";
import type { ComposerTrackPillSegment } from "@/composer/tracks";

const jobSchema = z.object({
  id: z.string().optional(),
  agent: z.string().optional(),
  tag: z.string().optional(),
  status: z.string().optional(),
  stage: z.string().optional(),
  waitingApproval: z.boolean().optional(),
});
const statusSchema = z.object({ sessions: z.array(z.unknown()) });
const sessionStatusSchema = z.object({
  bridgeId: z.string().min(1),
  state: z.string().optional(),
  jobs: z.array(jobSchema).default([]),
});
const persistenceSchema = z.object({ data: z.object({ bridgeId: z.string().min(1) }) });
type Job = z.infer<typeof jobSchema>;
type JobState = "running" | "waiting" | "queued";

interface ProgressJob {
  id: string;
  agent: string;
  tag: string;
  state: JobState;
}

export interface AgentProgressSummary {
  running: number;
  waiting: number;
  queued: number;
  jobs: ProgressJob[];
}

export type AgentProgress = AgentProgressSummary | { failed: true };

interface ProgressSnapshot {
  rows: ReadonlyMap<string, AgentProgress | null>;
  failed: boolean;
}

type ProgressClient = Pick<DaemonClient, "invokePluginRpc">;
const emptySnapshot: ProgressSnapshot = { rows: new Map(), failed: false };
const hosts = new WeakMap<ProgressClient, ReturnType<typeof createAgentProgressState>>();

// 영속 핸들에서 현재 PaseoDog 부모의 bridgeId만 읽고 잘못된 핸들은 구독하지 않는다.
export function paseodogBridgeId(
  agent: Pick<Agent, "provider" | "persistence"> | null,
): string | null {
  if (agent?.provider !== "paseodog") return null;
  let persistence = agent.persistence?.metadata?.pluginProviderPersistence;
  const handle = agent.persistence?.sessionId;
  if (!persistence && typeof handle === "string" && handle.startsWith("plugin:")) {
    try {
      persistence = JSON.parse(handle.slice(7));
    } catch {
      return null;
    }
  }
  const result = persistenceSchema.safeParse(persistence);
  return result.success ? result.data.data.bridgeId : null;
}

// 데스크톱 패치와 같은 Mixdog 분류를 적용하되 종료·유휴 작업은 세지 않는다.
export function summarizeAgentJobs(jobs: readonly Job[]): AgentProgressSummary | null {
  const terminal = /idle|done|complete|success|closed|error|fail|cancel|killed|timeout/i;
  const active =
    /^(?:connecting|requesting|streaming|tool[-_\s]?running|running|queued|pending|starting)$/i;
  const queued = /^(?:queued|pending|starting)$/i;
  const summary: AgentProgressSummary = { running: 0, waiting: 0, queued: 0, jobs: [] };
  for (const job of jobs) {
    const values = [job.stage, job.status]
      .map((value) => (value || "").trim())
      .filter((value, index, list) => Boolean(value) && list.indexOf(value) === index);
    const status = (job.status || "").trim();
    const cancelled = values.some((value) => /cancel|killed/i.test(value));
    const lifecycle = !status || cancelled ? values : [status];
    const isTerminal = lifecycle.some((value) => terminal.test(value));
    const isActive = lifecycle.some((value) => active.test(value));
    if (!lifecycle.length || isTerminal || !isActive) continue;
    let state: JobState = "running";
    if (job.waitingApproval) state = "waiting";
    else if (lifecycle.every((value) => queued.test(value))) state = "queued";
    summary[state]++;
    summary.jobs.push({
      id: job.id || String(summary.jobs.length),
      agent: job.agent || job.tag || "Agent",
      tag: job.tag || "",
      state,
    });
  }
  return summary.jobs.length ? summary : null;
}

// 같은 호스트의 모든 부모 알약이 단일 비중첩 조회를 공유한다.
export function createAgentProgressState(client: ProgressClient) {
  let snapshot = emptySnapshot;
  let key = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let generation = 0;
  const listeners = new Set<() => void>();

  // 새 스냅샷만 활성 구독자에게 전달한다.
  function publish(next: ProgressSnapshot): void {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  // 숨김·해제 이전 응답은 버리고 완료 뒤에만 다음 읽기를 예약한다.
  async function refresh(): Promise<void> {
    if (!listeners.size || inFlight) return;
    const requestGeneration = generation;
    inFlight = true;
    try {
      const value = await client.invokePluginRpc("paseodog-provider", "engine-status", {});
      if (!listeners.size || requestGeneration !== generation) return;
      const status = statusSchema.parse(value);
      const rows = new Map<string, AgentProgress | null>();
      let failed = false;
      for (const row of status.sessions) {
        const parsed = sessionStatusSchema.safeParse(row);
        if (!parsed.success) {
          const identity = z.object({ bridgeId: z.string().min(1) }).safeParse(row);
          if (identity.success) rows.set(identity.data.bridgeId, { failed: true });
          else failed = true;
          continue;
        }
        const { bridgeId, jobs, state } = parsed.data;
        rows.set(bridgeId, state === "unavailable" || state === "failed"
          ? { failed: true } : summarizeAgentJobs(jobs));
      }
      const nextKey = JSON.stringify([failed, [...rows]]);
      if (nextKey !== key || snapshot.failed !== failed) {
        key = nextKey;
        publish({ rows, failed });
      }
    } catch {
      if (listeners.size && requestGeneration === generation && !snapshot.failed) {
        publish({ rows: new Map(), failed: true });
      }
    } finally {
      inFlight = false;
      if (listeners.size) {
        const delay = requestGeneration === generation ? 2000 : 0;
        timer = setTimeout(refresh, delay);
      }
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        generation++;
        void refresh();
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          generation++;
          clearTimeout(timer);
          key = "";
          snapshot = emptySnapshot;
        }
      };
    },
  };
}

// 클라이언트 교체 시 새 모니터를 쓰고 기존 호스트 구독끼리는 상태를 공유한다.
export function getAgentProgressState(client: ProgressClient) {
  let state = hosts.get(client);
  if (!state) {
    state = createAgentProgressState(client);
    hosts.set(client, state);
  }
  return state;
}

// 현재 부모의 요약만 반환하고 첫 조회 실패도 활동 없음과 구분한다.
export function selectAgentProgress(
  snapshot: ProgressSnapshot,
  bridgeId: string | null,
): AgentProgress | null {
  if (!bridgeId) return null;
  if (snapshot.rows.has(bridgeId)) return snapshot.rows.get(bridgeId) ?? null;
  return snapshot.failed ? { failed: true } : null;
}

// 조회 실패 또는 실제 활성 작업 수만 기존 트랙 알약의 표시 형식으로 바꾼다.
export function agentProgressSegments(progress: AgentProgress | null): ComposerTrackPillSegment[] {
  if (!progress) return [];
  if ("failed" in progress) return [{ bucket: "failed", text: "하위 작업 확인 불가" }];
  const segments: ComposerTrackPillSegment[] = [];
  if (progress.running)
    segments.push({ bucket: "running", text: `에이전트 ${progress.running} 실행` });
  if (progress.waiting)
    segments.push({ bucket: "needs_input", text: `${progress.waiting} 승인 대기` });
  if (progress.queued) segments.push({ bucket: null, text: `${progress.queued} 실행 대기` });
  return segments;
}

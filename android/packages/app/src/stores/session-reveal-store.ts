import { create } from "zustand";

/** 최근 목록 등에서 고른 세션을 화면에서 잠깐 강조할 요청 */
export interface SessionRevealRequest {
  serverId: string;
  agentId: string;
  /** 같은 세션을 다시 눌러도 새 강조로 구분한다. */
  id: number;
  at: number;
}

interface SessionRevealStore {
  request: SessionRevealRequest | null;
}

/** 요청 후 이 시간 안에 세션을 보여 주는 칸만 강조한다(이동 후 칸이 늦게 그려져도 맞춘다). */
export const SESSION_REVEAL_WINDOW_MS = 2000;

export const useSessionRevealStore = create<SessionRevealStore>(() => ({ request: null }));

let nextRevealId = 0;

// 세션 강조 요청 (서버·세션 -> 그 세션을 보여 주는 칸이 잠깐 강조 테두리를 표시)
export function requestSessionReveal(serverId: string, agentId: string): void {
  nextRevealId += 1;
  useSessionRevealStore.setState({
    request: { serverId, agentId, id: nextRevealId, at: Date.now() },
  });
}

// 이 칸이 강조할 요청인지 (요청 -> 같은 서버·세션이고 유효 시간 안이면 요청 ID)
export function matchSessionReveal(
  request: SessionRevealRequest | null,
  serverId: string,
  agentId: string | null,
  now: number,
): number | null {
  if (!request || !agentId) return null;
  if (request.serverId !== serverId || request.agentId !== agentId) return null;
  return now - request.at <= SESSION_REVEAL_WINDOW_MS ? request.id : null;
}

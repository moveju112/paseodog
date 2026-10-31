import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import {
  DEFAULT_RECENT_SESSIONS_WINDOWS,
  MAX_RECENT_SESSIONS_WINDOWS,
  normalizeRecentSessionsWindows,
  RECENT_SESSIONS_WINDOW_OPTIONS,
  type RecentSessionsWindow,
} from "@/utils/recent-sessions";

interface RecentSessionsPersistedState {
  window: RecentSessionsWindow;
  // 설정 이전에 저장된 값에는 없으므로 선택 항목으로 읽고 기본값을 쓴다.
  windows?: RecentSessionsWindow[];
  hiddenThrough?: Record<string, number>;
}

interface RecentSessionsState {
  window: RecentSessionsWindow;
  windows: RecentSessionsWindow[];
  hiddenThrough: Record<string, number>;
  hideSession: (serverId: string, agentId: string, lastUserMessageAt: number) => void;
  setWindow: (window: RecentSessionsWindow) => void;
  setWindows: (windows: readonly RecentSessionsWindow[]) => void;
}

const WindowSchema = z.enum(RECENT_SESSIONS_WINDOW_OPTIONS);

const RecentSessionsPersistedStateSchema = z.strictObject({
  window: WindowSchema,
  windows: z.array(WindowSchema).max(MAX_RECENT_SESSIONS_WINDOWS).optional(),
  hiddenThrough: z.record(z.string(), z.number().finite()).optional(),
});

export const useRecentSessionsStore = create<RecentSessionsState>()(
  persist<RecentSessionsState, [], [], RecentSessionsPersistedState>(
    (set) => ({
      window: "4h",
      windows: [...DEFAULT_RECENT_SESSIONS_WINDOWS],
      hiddenThrough: {},
      // 세션 자체는 건드리지 않고 마지막 사용자 메시지까지만 최근에서 숨긴다.
      hideSession: (serverId, agentId, lastUserMessageAt) =>
        set((state) => ({
          hiddenThrough: {
            ...state.hiddenThrough,
            [`${serverId}:${agentId}`]: lastUserMessageAt,
          },
        })),
      setWindow: (window) => set({ window }),
      setWindows: (windows) => set({ windows: normalizeRecentSessionsWindows(windows) }),
    }),
    {
      name: "sidebar-recent-sessions",
      storage: createValidatedPersistStorage(AsyncStorage, RecentSessionsPersistedStateSchema),
      partialize: (state) => ({
        window: state.window,
        windows: state.windows,
        hiddenThrough: state.hiddenThrough,
      }),
    },
  ),
);

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
}

interface RecentSessionsState {
  window: RecentSessionsWindow;
  windows: RecentSessionsWindow[];
  setWindow: (window: RecentSessionsWindow) => void;
  setWindows: (windows: readonly RecentSessionsWindow[]) => void;
}

const WindowSchema = z.enum(RECENT_SESSIONS_WINDOW_OPTIONS);

const RecentSessionsPersistedStateSchema = z.strictObject({
  window: WindowSchema,
  windows: z.array(WindowSchema).max(MAX_RECENT_SESSIONS_WINDOWS).optional(),
});

export const useRecentSessionsStore = create<RecentSessionsState>()(
  persist<RecentSessionsState, [], [], RecentSessionsPersistedState>(
    (set) => ({
      window: "4h",
      windows: [...DEFAULT_RECENT_SESSIONS_WINDOWS],
      setWindow: (window) => set({ window }),
      setWindows: (windows) => set({ windows: normalizeRecentSessionsWindows(windows) }),
    }),
    {
      name: "sidebar-recent-sessions",
      storage: createValidatedPersistStorage(AsyncStorage, RecentSessionsPersistedStateSchema),
      partialize: (state) => ({ window: state.window, windows: state.windows }),
    },
  ),
);

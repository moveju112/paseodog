import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import type { RecentSessionsWindow } from "@/utils/recent-sessions";

interface RecentSessionsPersistedState {
  window: RecentSessionsWindow;
}

interface RecentSessionsState extends RecentSessionsPersistedState {
  setWindow: (window: RecentSessionsWindow) => void;
}

const RecentSessionsPersistedStateSchema = z.strictObject({
  window: z.enum(["15m", "1h", "today"]),
});

export const useRecentSessionsStore = create<RecentSessionsState>()(
  persist<RecentSessionsState, [], [], RecentSessionsPersistedState>(
    (set) => ({
      window: "1h",
      setWindow: (window) => set({ window }),
    }),
    {
      name: "sidebar-recent-sessions",
      storage: createValidatedPersistStorage(AsyncStorage, RecentSessionsPersistedStateSchema),
      partialize: (state) => ({ window: state.window }),
    },
  ),
);

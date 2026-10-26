import AsyncStorage from "@react-native-async-storage/async-storage";
import { randomUUID } from "expo-crypto";
import { z } from "zod";
import { create } from "zustand";
import { persist, type StateStorage } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

export const SIDEBAR_WORKSPACE_FOLDERS_STORAGE_KEY = "paseodog-sidebar-workspace-folders";

const FolderSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  collapsed: z.boolean(),
});
const FolderStateSchema = z.object({
  folders: z.array(FolderSchema),
  workspaceFolderByKey: z.record(z.string(), z.string()),
});

export type SidebarWorkspaceFolder = z.infer<typeof FolderSchema>;
export type SidebarWorkspaceFoldersState = z.infer<typeof FolderStateSchema>;

interface FolderStore extends SidebarWorkspaceFoldersState {
  createFolder: (name: string) => string | null;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
  toggleFolder: (id: string) => void;
  assignWorkspace: (workspaceKey: string, folderId: string | null) => void;
}

// 별도 인스턴스도 같은 검증·저장 경로를 사용하여 재실행 복원을 테스트한다.
export function createSidebarWorkspaceFoldersStore(backingStorage: StateStorage = AsyncStorage) {
  return create<FolderStore>()(
    persist(
      (set, get) => ({
        folders: [],
        workspaceFolderByKey: {},
        createFolder: (name) => {
          const parsed = FolderSchema.shape.name.safeParse(name);
          if (!parsed.success) return null;
          const id = randomUUID();
          set((state) => ({
            folders: [...state.folders, { id, name: parsed.data, collapsed: false }],
          }));
          return id;
        },
        renameFolder: (id, name) => {
          const parsed = FolderSchema.shape.name.safeParse(name);
          if (!parsed.success) return;
          set((state) => ({
            folders: state.folders.map((folder) =>
              folder.id === id ? { ...folder, name: parsed.data } : folder,
            ),
          }));
        },
        deleteFolder: (id) => {
          // 폴더는 클라이언트 메타데이터다. 배정만 해제하며 서버·파일 삭제 API는 호출하지 않는다.
          set((state) => ({
            folders: state.folders.filter((folder) => folder.id !== id),
            workspaceFolderByKey: Object.fromEntries(
              Object.entries(state.workspaceFolderByKey).filter(([, folderId]) => folderId !== id),
            ),
          }));
        },
        toggleFolder: (id) => {
          set((state) => ({
            folders: state.folders.map((folder) =>
              folder.id === id ? { ...folder, collapsed: !folder.collapsed } : folder,
            ),
          }));
        },
        assignWorkspace: (workspaceKey, folderId) => {
          // 호스트를 포함한 기존 workspaceKey를 유지해 서로 다른 호스트의 동명 작업을 분리한다.
          if (!workspaceKey || (folderId !== null && !get().folders.some((f) => f.id === folderId))) {
            return;
          }
          set((state) => {
            const assignments = { ...state.workspaceFolderByKey };
            if (folderId === null) delete assignments[workspaceKey];
            else assignments[workspaceKey] = folderId;
            return { workspaceFolderByKey: assignments };
          });
        },
      }),
      {
        name: SIDEBAR_WORKSPACE_FOLDERS_STORAGE_KEY,
        version: 1,
        storage: createValidatedPersistStorage(backingStorage, FolderStateSchema),
        partialize: ({ folders, workspaceFolderByKey }) => ({ folders, workspaceFolderByKey }),
      },
    ),
  );
}

export const useSidebarWorkspaceFoldersStore = createSidebarWorkspaceFoldersStore();

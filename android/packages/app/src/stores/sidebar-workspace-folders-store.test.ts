import { describe, expect, it, vi } from "vitest";
import type { StateStorage } from "zustand/middleware";
import { createSidebarWorkspaceFoldersStore, SIDEBAR_WORKSPACE_FOLDERS_STORAGE_KEY } from "./sidebar-workspace-folders-store";

vi.mock("expo-crypto", async () => ({ randomUUID: (await import("node:crypto")).randomUUID }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

// 실제 저장 문자열을 공유해 새 store 인스턴스가 앱 재실행처럼 복원하도록 한다.
function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial) values.set(SIDEBAR_WORKSPACE_FOLDERS_STORAGE_KEY, initial);
  const storage: StateStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
  return { storage, values };
}

describe("virtual workspace folders", () => {
  it("creates unique trimmed folders, validates names, and never changes identity on rename", async () => {
    const store = createSidebarWorkspaceFoldersStore(memoryStorage().storage);
    await store.persist.rehydrate();
    const first = store.getState().createFolder("  Work  ")!;
    const second = store.getState().createFolder("Work")!;
    expect(first).not.toBe(second);
    expect(store.getState().createFolder("  ")).toBeNull();
    expect(store.getState().createFolder("x".repeat(81))).toBeNull();
    store.getState().renameFolder(first, "Renamed");
    store.getState().renameFolder(first, "  ");
    expect(store.getState().folders).toEqual([
      { id: first, name: "Renamed", collapsed: false },
      { id: second, name: "Work", collapsed: false },
    ]);
  });

  it("moves, unassigns, and deletes only metadata while preserving other hosts and folders", async () => {
    const store = createSidebarWorkspaceFoldersStore(memoryStorage().storage);
    await store.persist.rehydrate();
    const first = store.getState().createFolder("First")!;
    const second = store.getState().createFolder("Second")!;
    const actions = store.getState();
    actions.assignWorkspace("host-a:main", first);
    actions.assignWorkspace("host-b:main", second);
    actions.assignWorkspace("host-a:main", second);
    actions.assignWorkspace("host-a:main", null);
    expect(store.getState().workspaceFolderByKey).toEqual({ "host-b:main": second });
    actions.assignWorkspace("host-a:main", "missing");
    actions.assignWorkspace("host-a:main", first);
    actions.toggleFolder(second);
    actions.deleteFolder(first);
    expect(store.getState().workspaceFolderByKey).toEqual({ "host-b:main": second });
    expect(store.getState().folders).toEqual([{ id: second, name: "Second", collapsed: true }]);
  });

  it("restores names, exact workspace keys, assignment and collapse from the shared v1 envelope", async () => {
    const { storage, values } = memoryStorage();
    const original = createSidebarWorkspaceFoldersStore(storage);
    await original.persist.rehydrate();
    const id = original.getState().createFolder("Work")!;
    original.getState().assignWorkspace("host-a:path with spaces ", id);
    original.getState().toggleFolder(id);
    const expected = {
      folders: [{ id, name: "Work", collapsed: true }],
      workspaceFolderByKey: { "host-a:path with spaces ": id },
    };
    expect(JSON.parse(values.get(SIDEBAR_WORKSPACE_FOLDERS_STORAGE_KEY)!)).toEqual({
      state: expected, version: 1,
    });
    const restored = createSidebarWorkspaceFoldersStore(storage);
    await restored.persist.rehydrate();
    expect(restored.getState()).toMatchObject(expected);
    restored.getState().toggleFolder(id);
    restored.getState().renameFolder(id, "Later");
    const reopened = createSidebarWorkspaceFoldersStore(storage);
    await reopened.persist.rehydrate();
    expect(reopened.getState().folders).toEqual([{ id, name: "Later", collapsed: false }]);
  });

  it.each(["not json", JSON.stringify({ state: { folders: [{ id: "bad" }], workspaceFolderByKey: {} }, version: 1 })])(
    "rejects malformed persisted metadata without touching workspace storage: %s",
    async (raw) => {
      const { storage, values } = memoryStorage(raw);
      values.set("unrelated-workspaces", "keep");
      const store = createSidebarWorkspaceFoldersStore(storage);
      await store.persist.rehydrate();
      expect(store.getState().folders).toEqual([]);
      expect(store.getState().workspaceFolderByKey).toEqual({});
      expect(values.get("unrelated-workspaces")).toBe("keep");
    },
  );
});

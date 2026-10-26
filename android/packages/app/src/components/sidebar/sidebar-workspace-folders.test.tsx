/** @vitest-environment jsdom */
import React, { useCallback, type FormEvent, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarWorkspaceFolderCreateButton, SidebarWorkspaceFolderSections } from "./sidebar-workspace-folders";
import { SidebarWorkspaceContextMenu, SidebarWorkspaceMenu } from "./sidebar-workspace-menu";
import { useSidebarWorkspaceFoldersStore } from "@/stores/sidebar-workspace-folders-store";
import type {
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";

vi.hoisted(async () => { vi.stubGlobal("React", await import("react")); });
vi.mock("expo-crypto", async () => ({ randomUUID: (await import("node:crypto")).randomUUID }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, values?: { name?: string }) => values?.name ? `${key}: ${values.name}` : key }),
}));

// 메뉴 배치·포털만 제외하고 실제 action과 store 연결은 유지한다.
function Passthrough({ children }: { children?: ReactNode }) { return children; }
function MenuItem({ children, onSelect, disabled, testID }: { children?: ReactNode; onSelect?: () => void; disabled?: boolean; testID?: string }) {
  return <button type="button" data-testid={testID} disabled={disabled} onClick={onSelect}>{children}</button>;
}
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: Passthrough, DropdownMenuContent: Passthrough, DropdownMenuItem: MenuItem,
  DropdownMenuTrigger: () => null, DropdownMenuSubTrigger: () => null,
}));
vi.mock("@/components/ui/context-menu", () => ({
  ContextMenu: Passthrough, ContextMenuContent: Passthrough, ContextMenuItem: MenuItem, ContextMenuTrigger: Passthrough,
}));
vi.mock("@/workspace-labels/picker", () => ({ useWorkspaceLabelMenuPages: () => [], WORKSPACE_LABEL_PAGE_ID: "labels" }));
vi.mock("@/workspace/open-in-file-manager/menu-item", () => ({ OpenInFileManagerMenuItem: () => null }));
vi.mock("@/components/ui/shortcut", () => ({ Shortcut: () => null }));
vi.mock("@/hooks/use-settings", () => ({ useAppSettings: () => ({ settings: { workspaceTitleSource: "name" } }) }));
vi.mock("@/components/rename-modal", () => ({
  // 플랫폼별 모달 대신 입력만 치환한다. submit·close 흐름은 컴포넌트의 실제 콜백이다.
  AdaptiveRenameModal: function TestRenameModal({ visible, initialValue, onSubmit, onClose, testID }: {
    visible: boolean; initialValue: string; onSubmit: (value: string) => void; onClose: () => void; testID: string;
  }) {
    const submit = useCallback((event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const input = event.currentTarget.elements.namedItem("name") as HTMLInputElement;
      onSubmit(input.value);
      onClose();
    }, [onSubmit, onClose]);
    return visible ? (
    <form data-testid={testID} onSubmit={submit}>
      <input name="name" aria-label="name" defaultValue={initialValue} />
      <button type="submit">save</button>
    </form>
  ) : null;
  },
}));

const workspace: SidebarWorkspaceEntry = {
  workspaceKey: "host:main", workspaceId: "main", serverId: "host", name: "main",
  projectName: "Repo", projectViewKey: "repo", projectKind: "git", workspaceKind: "worktree",
  workspaceDirectory: "/repo/main", workspaceDirectoryLabel: "/repo/main",
  title: null, currentBranch: "main", statusBucket: "done", statusEnteredAt: null,
  archivingAt: null, diffStat: null, prHint: null, archiveHasUncommittedChanges: null,
  archiveUnpushedCommitCount: null, scripts: [], hasRunningScripts: false,
};

// 실제 작업의 정체성이 접기·펼치기 후에도 유지되는지 읽을 수 있게 렌더링한다.
function renderWorkspace(entry: SidebarWorkspacePlacement) {
  return <span key={entry.workspaceKey}>{entry.workspaceKey}</span>;
}

// 화면을 store에 구독시켜 생성·접기·삭제 후 실제 다시 렌더링되는 결과를 검사한다.
function FolderView() {
  const folders = useSidebarWorkspaceFoldersStore((state) => state.folders);
  const assignments = useSidebarWorkspaceFoldersStore((state) => state.workspaceFolderByKey);
  return (
    <>
      <SidebarWorkspaceFolderCreateButton />
      <SidebarWorkspaceFolderSections
        folders={folders}
        rowsByFolder={new Map(folders.map((folder) => [folder.id, assignments[workspace.workspaceKey] === folder.id ? [workspace] : []]))}
        renderWorkspace={renderWorkspace}
      />
    </>
  );
}

beforeEach(async () => {
  await useSidebarWorkspaceFoldersStore.persist.rehydrate();
  useSidebarWorkspaceFoldersStore.setState({ folders: [], workspaceFolderByKey: {} });
});
afterEach(cleanup);

describe("workspace folder controls", () => {
  it("creates, renames, collapses, expands and deletes folders without deleting assigned workspaces", () => {
    render(<FolderView />);
    fireEvent.click(screen.getByTestId("sidebar-folder-create"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Work" } });
    fireEvent.click(screen.getByText("save"));
    const id = useSidebarWorkspaceFoldersStore.getState().folders[0]!.id;
    act(() => useSidebarWorkspaceFoldersStore.getState().assignWorkspace(workspace.workspaceKey, id));
    expect(screen.getByText("host:main")).toBeTruthy();
    fireEvent.click(screen.getByTestId(`sidebar-folder-toggle-${id}`));
    expect(screen.queryByText("host:main")).toBeNull();
    expect(useSidebarWorkspaceFoldersStore.getState().folders[0]?.collapsed).toBe(true);
    fireEvent.click(screen.getByTestId(`sidebar-folder-toggle-${id}`));
    expect(screen.getByText("host:main")).toBeTruthy();
    fireEvent.click(screen.getByTestId(`sidebar-folder-rename-${id}`));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByText("save"));
    expect(screen.getByText("Renamed")).toBeTruthy();
    fireEvent.click(screen.getByTestId(`sidebar-folder-delete-${id}`));
    expect(useSidebarWorkspaceFoldersStore.getState().folders).toEqual([]);
    expect(useSidebarWorkspaceFoldersStore.getState().workspaceFolderByKey).toEqual({});
    expect(workspace.workspaceId).toBe("main");
  });

  it.each(["dropdown", "context"])("assigns, moves and unassigns through the %s menu without archive or rename calls", (surface) => {
    useSidebarWorkspaceFoldersStore.setState({ folders: [
      { id: "a", name: "A", collapsed: false }, { id: "b", name: "B", collapsed: false },
    ] });
    const onArchive = vi.fn();
    const onRename = vi.fn();
    const onContextMenuOpenChange = vi.fn();
    render(surface === "dropdown" ? (
      <SidebarWorkspaceMenu workspaceKey={workspace.workspaceKey} onArchive={onArchive} onRename={onRename} />
    ) : (
      <SidebarWorkspaceContextMenu
        workspaceKey={workspace.workspaceKey}
        workspace={workspace}
        onArchive={onArchive}
        onRename={onRename}
        contextMenuOpen
        onContextMenuOpenChange={onContextMenuOpenChange}
        highlightStyle={undefined}
      >
        main
      </SidebarWorkspaceContextMenu>
    ));
    fireEvent.click(screen.getByTestId("sidebar-workspace-folder-assign-host:main-a"));
    expect(useSidebarWorkspaceFoldersStore.getState().workspaceFolderByKey).toEqual({ "host:main": "a" });
    fireEvent.click(screen.getByTestId("sidebar-workspace-folder-assign-host:main-b"));
    expect(useSidebarWorkspaceFoldersStore.getState().workspaceFolderByKey).toEqual({ "host:main": "b" });
    fireEvent.click(screen.getByTestId("sidebar-workspace-folder-remove-host:main"));
    expect(useSidebarWorkspaceFoldersStore.getState().workspaceFolderByKey).toEqual({});
    expect(onArchive).not.toHaveBeenCalled();
    expect(onRename).not.toHaveBeenCalled();
  });
});

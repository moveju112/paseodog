import type { PinnedSidebarGroups } from "@/hooks/use-sidebar-pins";
import type { SidebarProjectEntry, SidebarWorkspacePlacement } from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarWorkspaceFoldersState } from "@/stores/sidebar-workspace-folders-store";
import type { SidebarWorkspaceGroup } from "./sidebar-labels";

// 이미 필터링된 배치만 이동하므로 폴더가 호스트·프로젝트·라벨 필터를 우회하지 않는다.
export function projectWorkspaceFolders(
  projects: SidebarProjectEntry[],
  pinnedGroups: PinnedSidebarGroups,
  workspaceGroups: SidebarWorkspaceGroup[],
  state: SidebarWorkspaceFoldersState,
) {
  const rowsByFolder = new Map<string, SidebarWorkspacePlacement[]>(
    state.folders.map((folder) => [folder.id, []]),
  );
  const assignedKeys = new Set<string>();
  for (const project of projects) {
    for (const workspace of project.workspaces) {
      const folderId = state.workspaceFolderByKey[workspace.workspaceKey];
      const rows = folderId ? rowsByFolder.get(folderId) : undefined;
      // 사라진 폴더를 참조하는 오래된 배정은 작업을 숨기지 않고 원래 목록에 남긴다.
      if (rows && !assignedKeys.has(workspace.workspaceKey)) {
        rows.push(workspace);
        assignedKeys.add(workspace.workspaceKey);
      }
    }
  }
  const unassigned = (workspace: SidebarWorkspacePlacement) => !assignedKeys.has(workspace.workspaceKey);
  const unassignedProject = (project: SidebarProjectEntry): SidebarProjectEntry[] => {
    const workspaces = project.workspaces.filter(unassigned);
    // 배정 때문에 비게 된 헤더만 숨긴다. 원래 빈 프로젝트의 첫 작업 생성 경로는 유지한다.
    if (project.workspaces.length > 0 && workspaces.length === 0) return [];
    return [workspaces.length === project.workspaces.length ? project : { ...project, workspaces }];
  };
  return {
    rowsByFolder,
    pinnedGroups: assignedKeys.size === 0 ? pinnedGroups : {
      pinnedChats: pinnedGroups.pinnedChats.filter(unassigned),
      unpinnedProjects: pinnedGroups.unpinnedProjects.flatMap(unassignedProject),
    },
    workspaceGroups: assignedKeys.size === 0 ? workspaceGroups : workspaceGroups.map((group) => ({
      ...group,
      rows: group.rows.filter(unassigned),
    })),
  };
}

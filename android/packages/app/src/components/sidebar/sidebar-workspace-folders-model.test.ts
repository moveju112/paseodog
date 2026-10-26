import { describe, expect, it } from "vitest";
import type { SidebarProjectEntry, SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { i18n } from "@/i18n/i18next";
import { projectWorkspaceFolders } from "./sidebar-workspace-folders-model";
import { buildSidebarProjection } from "./sidebar-projection";

// 서로 다른 호스트의 같은 작업 이름도 기존 정체성·경로를 유지하는 입력을 만든다.
function workspace(serverId: string): SidebarWorkspaceEntry {
  return {
    workspaceKey: `${serverId}:main`, serverId, workspaceId: "main",
    projectViewKey: serverId, projectName: serverId, projectKind: "git",
    workspaceKind: "worktree", name: "main", workspaceDirectory: `/repo/${serverId}`,
    workspaceDirectoryLabel: `/repo/${serverId}`, title: null, currentBranch: "main",
    statusBucket: "done", statusEnteredAt: null, archivingAt: null, diffStat: null,
    prHint: null, archiveHasUncommittedChanges: null, archiveUnpushedCommitCount: null,
    scripts: [], hasRunningScripts: false,
  };
}

// 프로젝트 배치를 원본 객체로 유지해 projection이 경로나 작업을 변경하지 않음을 검증한다.
function project(entry: SidebarWorkspaceEntry): SidebarProjectEntry {
  return {
    viewKey: entry.projectViewKey, projectName: entry.projectName, projectKind: "git",
    iconWorkingDir: entry.workspaceDirectory, hosts: [], workspaces: [entry],
  };
}

const first = workspace("host-a");
const second = workspace("host-b");
const firstProject = project(first);
const secondProject = project(second);
const emptyProject = { ...project(workspace("empty")), workspaces: [] };
const folders = [{ id: "folder", name: "Work", collapsed: false }];
const assignments = { [first.workspaceKey]: "folder" };

describe("folder list projection", () => {
  it("moves rows once, hides only newly emptied projects, and restores the original rows on deletion", () => {
    const projects = [firstProject, secondProject, emptyProject];
    const pinnedGroups = { pinnedChats: [], unpinnedProjects: projects };
    const projection = projectWorkspaceFolders(projects, pinnedGroups, [], { folders, workspaceFolderByKey: assignments });
    expect(projection.rowsByFolder.get("folder")).toEqual([first]);
    expect(projection.rowsByFolder.get("folder")?.[0]).toBe(first);
    expect(projection.pinnedGroups.unpinnedProjects).toEqual([secondProject, emptyProject]);
    expect(firstProject.workspaces).toEqual([first]);
    expect(first.workspaceDirectory).toBe("/repo/host-a");
    const restored = projectWorkspaceFolders(projects, pinnedGroups, [], { folders: [], workspaceFolderByKey: {} });
    expect(restored.pinnedGroups).toBe(pinnedGroups);
  });

  it("does not duplicate pinned rows, leak filtered hosts, or lose rows with stale folder ids", () => {
    const groups = [{ key: "done", label: "Done", rows: [first, second], leading: { kind: "status" as const, bucket: "done" as const } }];
    const pinnedGroups = { pinnedChats: [first], unpinnedProjects: [secondProject] };
    const projection = projectWorkspaceFolders([firstProject, secondProject], pinnedGroups, groups, { folders, workspaceFolderByKey: assignments });
    expect(projection.pinnedGroups.pinnedChats).toEqual([]);
    expect(projection.workspaceGroups[0]?.rows).toEqual([second]);
    const filtered = projectWorkspaceFolders([secondProject], { pinnedChats: [], unpinnedProjects: [secondProject] }, [], { folders, workspaceFolderByKey: assignments });
    expect(filtered.rowsByFolder.get("folder")).toEqual([]);
    const stale = projectWorkspaceFolders([firstProject], { pinnedChats: [], unpinnedProjects: [firstProject] }, [], { folders, workspaceFolderByKey: { [first.workspaceKey]: "missing" } });
    expect(stale.pinnedGroups.unpinnedProjects).toEqual([firstProject]);
  });

  it.each(["project", "status"] as const)("keeps shortcuts in visible order and skips collapsed folders in %s mode", (groupMode) => {
    const input = {
      projects: [firstProject, secondProject],
      pinnedKeys: { pinnedWorkspaceKeys: [first.workspaceKey], pinnedAtByKey: { [first.workspaceKey]: "2026-01-01" } },
      pinnedWorkspaceOrder: [], workspaceEntriesByKey: new Map([[first.workspaceKey, first], [second.workspaceKey, second]]),
      projectNamesByViewKey: new Map([["host-a", "A"], ["host-b", "B"]]), groupMode,
      pinnedCollapsed: true, collapsedProjectKeys: new Set<string>(),
      collapsedWorkspaceGroupKeys: new Set<string>(), t: i18n.t,
      workspaceFolders: { folders, workspaceFolderByKey: assignments },
    };
    const expanded = buildSidebarProjection(input).shortcutModel.shortcutIndexByWorkspaceKey;
    expect([...expanded.keys()]).toEqual([first.workspaceKey, second.workspaceKey]);
    const collapsed = buildSidebarProjection({
      ...input,
      workspaceFolders: { ...input.workspaceFolders, folders: [{ ...folders[0]!, collapsed: true }] },
    }).shortcutModel.shortcutIndexByWorkspaceKey;
    expect([...collapsed.keys()]).toEqual([second.workspaceKey]);
  });
});

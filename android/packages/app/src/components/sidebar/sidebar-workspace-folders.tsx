import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, ChevronRight, Folder, FolderPlus, MoreVertical } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useSidebarWorkspaceFoldersStore,
  type SidebarWorkspaceFolder,
} from "@/stores/sidebar-workspace-folders-store";
import type { SidebarWorkspacePlacement } from "@/hooks/use-sidebar-workspaces-list";
import type { Theme } from "@/styles/theme";

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedFolder = withUnistyles(Folder);
const ThemedFolderPlus = withUnistyles(FolderPlus);
const ThemedMoreVertical = withUnistyles(MoreVertical);
const mutedIconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

// 기존 적응형 모달을 재사용해 Android 시트와 desktop/web 입력의 동작을 일치시킨다.
export function SidebarWorkspaceFolderCreateButton() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const createFolder = useSidebarWorkspaceFoldersStore((state) => state.createFolder);
  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);
  const submit = useCallback((name: string) => { createFolder(name); }, [createFolder]);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("workspaceFolders.create")}
        testID="sidebar-folder-create"
        style={styles.action}
        onPress={open}
      >
        <ThemedFolderPlus size={16} uniProps={mutedIconColor} />
      </Pressable>
      <AdaptiveRenameModal
        visible={visible}
        title={t("workspaceFolders.create")}
        initialValue=""
        placeholder={t("workspaceFolders.name")}
        submitLabel={t("workspaceFolders.create")}
        maxLength={80}
        onClose={close}
        onSubmit={submit}
        testID="sidebar-folder-create-modal"
      />
    </>
  );
}

// 삭제 안내를 메뉴에 명시하고 폴더 메타데이터만 제거한다. 실제 경로나 작업은 보존된다.
function WorkspaceFolderSection({
  folder,
  workspaces,
  renderWorkspace,
}: {
  folder: SidebarWorkspaceFolder;
  workspaces: SidebarWorkspacePlacement[];
  renderWorkspace: (workspace: SidebarWorkspacePlacement) => ReactNode;
}) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const renameFolder = useSidebarWorkspaceFoldersStore((state) => state.renameFolder);
  const deleteFolder = useSidebarWorkspaceFoldersStore((state) => state.deleteFolder);
  const toggleFolder = useSidebarWorkspaceFoldersStore((state) => state.toggleFolder);
  const Chevron = folder.collapsed ? ThemedChevronRight : ThemedChevronDown;
  const accessibilityState = useMemo(() => ({ expanded: !folder.collapsed }), [folder.collapsed]);
  const toggle = useCallback(() => toggleFolder(folder.id), [toggleFolder, folder.id]);
  const remove = useCallback(() => deleteFolder(folder.id), [deleteFolder, folder.id]);
  const openRename = useCallback(() => setRenaming(true), []);
  const closeRename = useCallback(() => setRenaming(false), []);
  const submitRename = useCallback(
    (name: string) => renameFolder(folder.id, name),
    [renameFolder, folder.id],
  );
  return (
    <View testID={`sidebar-folder-${folder.id}`}>
      <View style={styles.header}>
        <Pressable
          style={styles.toggle}
          accessibilityRole="button"
          accessibilityLabel={folder.name}
          accessibilityState={accessibilityState}
          testID={`sidebar-folder-toggle-${folder.id}`}
          onPress={toggle}
        >
          <Chevron size={14} uniProps={mutedIconColor} />
          <ThemedFolder size={16} uniProps={mutedIconColor} />
          <Text numberOfLines={1} style={styles.name}>
            {folder.name}
          </Text>
          <Text style={styles.count}>{workspaces.length}</Text>
        </Pressable>
        <DropdownMenu>
          <DropdownMenuTrigger
            accessibilityLabel={t("workspaceFolders.actions", { name: folder.name })}
            testID={`sidebar-folder-menu-${folder.id}`}
            style={styles.action}
          >
            <ThemedMoreVertical size={14} uniProps={mutedIconColor} />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={openRename} testID={`sidebar-folder-rename-${folder.id}`}>
              {t("workspaceFolders.rename")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={remove} testID={`sidebar-folder-delete-${folder.id}`}>
              {t("workspaceFolders.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </View>
      {folder.collapsed ? null : (
        <View style={styles.rows}>
          {workspaces.length ? (
            workspaces.map(renderWorkspace)
          ) : (
            <Text style={styles.empty}>{t("workspaceFolders.empty")}</Text>
          )}
        </View>
      )}
      <AdaptiveRenameModal
        visible={renaming}
        title={t("workspaceFolders.rename")}
        initialValue={folder.name}
        maxLength={80}
        onClose={closeRename}
        onSubmit={submitRename}
        testID={`sidebar-folder-rename-modal-${folder.id}`}
      />
    </View>
  );
}

// 이름이나 접기 상태가 바뀌어도 폴더 ID를 key로 유지해 열린 모달과 작업 정체성을 보존한다.
export function SidebarWorkspaceFolderSections({
  folders,
  rowsByFolder,
  renderWorkspace,
}: {
  folders: SidebarWorkspaceFolder[];
  rowsByFolder: ReadonlyMap<string, SidebarWorkspacePlacement[]>;
  renderWorkspace: (workspace: SidebarWorkspacePlacement) => ReactNode;
}) {
  return folders.map((folder) => (
    <WorkspaceFolderSection
      key={folder.id}
      folder={folder}
      workspaces={rowsByFolder.get(folder.id) ?? []}
      renderWorkspace={renderWorkspace}
    />
  ));
}

const styles = StyleSheet.create((theme) => ({
  header: { flexDirection: "row", alignItems: "center", minHeight: 36 },
  toggle: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, padding: 6 },
  name: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  count: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  action: { padding: 8, alignItems: "center", justifyContent: "center" },
  rows: { paddingLeft: 8 },
  empty: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, padding: 8 },
}));

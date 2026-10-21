import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Copy,
  CopyX,
  Ellipsis,
  Pencil,
  RotateCw,
  X,
} from "lucide-react-native";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { WorkspaceTabMenuEntry } from "@/screens/workspace/workspace-tab-menu";
import type { Theme } from "@/styles/theme";

const ThemedEllipsis = withUnistyles(Ellipsis);
const ThemedCopy = withUnistyles(Copy);
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedArrowLeftToLine = withUnistyles(ArrowLeftToLine);
const ThemedArrowRightToLine = withUnistyles(ArrowRightToLine);
const ThemedCopyX = withUnistyles(CopyX);
const ThemedPencil = withUnistyles(Pencil);
const ThemedX = withUnistyles(X);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function mobileTabMenuTriggerStyle({ open, pressed }: { open?: boolean; pressed?: boolean }) {
  return [
    styles.mobileTabMenuTrigger,
    (Boolean(open) || Boolean(pressed)) && styles.mobileTabMenuTriggerActive,
  ];
}

// 메뉴 버튼과 터치 영역이 겹치지 않도록 오른쪽은 확장하지 않음
const MOBILE_TAB_CLOSE_HIT_SLOP = { top: 6, bottom: 6, left: 6, right: 0 };

// 닫기 버튼 스타일 (눌림 → 강조 배경)
function mobileTabCloseButtonStyle({ pressed }: { pressed?: boolean }) {
  return [styles.mobileTabCloseButton, Boolean(pressed) && styles.mobileTabMenuTriggerActive];
}

type WorkspaceTabMenuItemEntry = Extract<WorkspaceTabMenuEntry, { kind: "item" }>;

// 메뉴의 "닫기" 항목 찾기 (행 직접 닫기 버튼이 같은 동작을 재사용)
function findCloseMenuEntry(
  menuEntries: WorkspaceTabMenuEntry[],
): WorkspaceTabMenuItemEntry | null {
  for (const entry of menuEntries) {
    if (entry.kind === "item" && entry.key === "close") {
      return entry;
    }
  }
  return null;
}

// 행 직접 닫기 버튼 (탭 → 메뉴 닫기 항목 onSelect, 행 선택 전파 차단)
function MobileTabCloseButton({
  testID,
  presentationLabel,
  closeEntry,
}: {
  testID: string;
  presentationLabel: string;
  closeEntry: WorkspaceTabMenuItemEntry;
}): ReactElement {
  const { t } = useTranslation();
  const { onSelect } = closeEntry;
  const handlePress = useCallback(
    (event: { stopPropagation?: () => void }) => {
      event.stopPropagation?.();
      onSelect();
    },
    [onSelect],
  );
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={t("workspace.tabs.menu.closeFor", { label: presentationLabel })}
      disabled={closeEntry.disabled}
      hitSlop={MOBILE_TAB_CLOSE_HIT_SLOP}
      onPress={handlePress}
      style={mobileTabCloseButtonStyle}
    >
      <ThemedX size={16} uniProps={mutedColorMapping} />
    </Pressable>
  );
}

function MobileTabDropdownMenuItem({
  entry,
}: {
  entry: Extract<WorkspaceTabMenuEntry, { kind: "item" }>;
}) {
  const leading = useMemo(() => {
    switch (entry.icon) {
      case "copy":
        return <ThemedCopy size={16} uniProps={mutedColorMapping} />;
      case "rotate-cw":
        return <ThemedRotateCw size={16} uniProps={mutedColorMapping} />;
      case "arrow-left-to-line":
        return <ThemedArrowLeftToLine size={16} uniProps={mutedColorMapping} />;
      case "arrow-right-to-line":
        return <ThemedArrowRightToLine size={16} uniProps={mutedColorMapping} />;
      case "copy-x":
        return <ThemedCopyX size={16} uniProps={mutedColorMapping} />;
      case "pencil":
        return <ThemedPencil size={16} uniProps={mutedColorMapping} />;
      case "x":
        return <ThemedX size={16} uniProps={mutedColorMapping} />;
      default:
        return undefined;
    }
  }, [entry.icon]);
  const trailing = useMemo(
    () => (entry.hint ? <Text style={styles.menuItemHint}>{entry.hint}</Text> : undefined),
    [entry.hint],
  );
  return (
    <DropdownMenuItem
      testID={entry.testID}
      disabled={entry.disabled}
      destructive={entry.destructive}
      onSelect={entry.onSelect}
      tooltip={entry.tooltip}
      leading={leading}
      trailing={trailing}
    >
      {entry.label}
    </DropdownMenuItem>
  );
}

// 탭 전환 행 우측 동작 (직접 닫기 버튼 + "…" 기타 동작 메뉴)
export function MobileTabTrailingAccessory({
  menuTestIDBase,
  presentationLabel,
  menuEntries,
}: {
  menuTestIDBase: string;
  presentationLabel: string;
  menuEntries: WorkspaceTabMenuEntry[];
}): ReactElement {
  const { t } = useTranslation();
  const closeEntry = useMemo(() => findCloseMenuEntry(menuEntries), [menuEntries]);
  return (
    <View style={styles.mobileTabTrailingActions}>
      {closeEntry ? (
        <MobileTabCloseButton
          testID={`${menuTestIDBase}-close-button`}
          presentationLabel={presentationLabel}
          closeEntry={closeEntry}
        />
      ) : null}
      <MobileTabActionsMenu
        menuTestIDBase={menuTestIDBase}
        presentationLabel={presentationLabel}
        menuEntries={menuEntries}
        openLabel={t("workspace.tabs.menu.openFor", { label: presentationLabel })}
      />
    </View>
  );
}

// "…" 기타 동작 메뉴 (트리거 → 시트)
function MobileTabActionsMenu({
  menuTestIDBase,
  presentationLabel,
  menuEntries,
  openLabel,
}: {
  menuTestIDBase: string;
  presentationLabel: string;
  menuEntries: WorkspaceTabMenuEntry[];
  openLabel: string;
}): ReactElement {
  return (
    <DropdownMenu compactMode="sheet">
      <DropdownMenuTrigger
        testID={`${menuTestIDBase}-trigger`}
        accessibilityRole="button"
        accessibilityLabel={openLabel}
        hitSlop={8}
        style={mobileTabMenuTriggerStyle}
      >
        <ThemedEllipsis size={14} uniProps={mutedColorMapping} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="bottom"
        align="end"
        width={220}
        sheetTitle={presentationLabel}
        testID={menuTestIDBase}
      >
        {menuEntries.map((entry) =>
          entry.kind === "separator" ? (
            <DropdownMenuSeparator key={entry.key} />
          ) : (
            <MobileTabDropdownMenuItem key={entry.key} entry={entry} />
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const styles = StyleSheet.create((theme) => ({
  mobileTabMenuTrigger: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  mobileTabTrailingActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  mobileTabMenuTriggerActive: {
    backgroundColor: theme.colors.surface2,
  },
  mobileTabCloseButton: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  menuItemHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));

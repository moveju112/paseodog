import { useCallback, useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  ArrowDown,
  ArrowUp,
  Blocks,
  CalendarClock,
  Gauge,
  History,
  Plus,
  Search,
  type LucideIcon,
} from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { Shortcut } from "@/components/ui/shortcut";
import { Switch } from "@/components/ui/switch";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import {
  builtinSidebarNavLabelKey,
  builtinSidebarNavShortcutAction,
  type BuiltinSidebarItemId,
  type SidebarNavItem,
  type SidebarSection,
} from "@/sidebar-nav/model";
import { resolvePluginIcon } from "@/plugins/icons";
import { useSidebarNavItems } from "@/sidebar-nav/use-sidebar-nav-items";
import { useRecentSessionsStore } from "@/stores/recent-sessions-store";
import {
  MAX_RECENT_SESSIONS_WINDOWS,
  normalizeRecentSessionsWindows,
  RECENT_SESSIONS_WINDOW_OPTIONS,
  recentSessionsWindowLabel,
  type RecentSessionsWindow,
} from "@/utils/recent-sessions";
import { settingsStyles } from "@/styles/settings";
import { UsagePreferencesSection } from "@/usage/options";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedArrowDown = withUnistyles(ArrowDown);

const moveUpIcon = <ThemedArrowUp size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;
const moveDownIcon = <ThemedArrowDown size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;

const BUILTIN_ICONS: Record<BuiltinSidebarItemId, LucideIcon> = {
  "new-workspace": Plus,
  history: History,
  search: Search,
  schedules: CalendarClock,
  usage: Gauge,
};

/** Plugin items register no icon, so they share this one; a legacy `addSidebarItem` keeps its own. */
const PLUGIN_ICON = Blocks;

function NavIcon({ Icon, color = "" }: { Icon: LucideIcon; color?: string }) {
  return <Icon size={ICON_SIZE.md} color={color} />;
}

const ThemedNavIcon = withUnistyles(NavIcon);

function navItemIcon(item: SidebarNavItem): LucideIcon {
  if (item.kind === "builtin") return BUILTIN_ICONS[item.id];
  return item.group.kind === "legacy" ? resolvePluginIcon(item.group.icon) : PLUGIN_ICON;
}

function navItemLabel(t: TFunction, item: SidebarNavItem): string {
  return item.kind === "builtin" ? t(builtinSidebarNavLabelKey(item.id)) : item.group.title;
}

/** Own component so the row can stay hook-free about which items have a shortcut. */
function NavItemShortcut({ item }: { item: SidebarNavItem }): ReactElement | null {
  const chord = useShortcutKeys(
    item.kind === "builtin" ? builtinSidebarNavShortcutAction(item.id) : null,
  );
  return chord ? <Shortcut chord={chord} /> : null;
}

interface SidebarNavRowProps {
  item: SidebarNavItem;
  isFirst: boolean;
  isLast: boolean;
  onMove: (key: string, direction: "up" | "down") => void;
  onSetVisible: (key: string, visible: boolean) => void;
}

function SidebarNavRow({
  item,
  isFirst,
  isLast,
  onMove,
  onSetVisible,
}: SidebarNavRowProps): ReactElement {
  const { t } = useTranslation();
  const label = navItemLabel(t, item);

  const handleMoveUp = useCallback(() => onMove(item.key, "up"), [item.key, onMove]);
  const handleMoveDown = useCallback(() => onMove(item.key, "down"), [item.key, onMove]);
  const handleVisibleChange = useCallback(
    (visible: boolean) => onSetVisible(item.key, visible),
    [item.key, onSetVisible],
  );

  const rowStyle = useMemo(
    () => [settingsStyles.row, isFirst ? null : settingsStyles.rowBorder, styles.row],
    [isFirst],
  );

  return (
    <View style={rowStyle} testID={`sidebar-nav-item-${item.key}`}>
      <View style={styles.rowMain}>
        <ThemedNavIcon Icon={navItemIcon(item)} uniProps={mutedColorMapping} />
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {label}
        </Text>
        <NavItemShortcut item={item} />
      </View>
      <View style={styles.rowActions}>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={moveUpIcon}
          onPress={handleMoveUp}
          disabled={isFirst}
          accessibilityLabel={t("settings.appearance.sidebar.moveUp")}
          testID={`sidebar-nav-move-up-${item.key}`}
        />
        <Button
          variant="ghost"
          size="sm"
          leftIcon={moveDownIcon}
          onPress={handleMoveDown}
          disabled={isLast}
          accessibilityLabel={t("settings.appearance.sidebar.moveDown")}
          testID={`sidebar-nav-move-down-${item.key}`}
        />
        <Switch
          value={item.visible}
          onValueChange={handleVisibleChange}
          accessibilityLabel={label}
          testID={`sidebar-nav-toggle-${item.key}`}
        />
      </View>
    </View>
  );
}

const SECTION_COPY = {
  header: {
    title: "settings.appearance.sidebar.header.title",
    info: "settings.appearance.sidebar.header.description",
  },
  footer: {
    title: "settings.appearance.sidebar.footer.title",
    info: "settings.appearance.sidebar.footer.description",
  },
} as const satisfies Record<SidebarSection, { title: string; info: string }>;

function SidebarItemsCard({ section }: { section: SidebarSection }): ReactElement {
  const { t } = useTranslation();
  const { items, setVisible, move } = useSidebarNavItems(section);

  return (
    <SettingsSection
      title={t(SECTION_COPY[section].title)}
      info={t(SECTION_COPY[section].info)}
      testID={`sidebar-nav-section-${section}`}
    >
      <View style={settingsStyles.card}>
        {items.map((item, index) => (
          <SidebarNavRow
            key={item.key}
            item={item}
            isFirst={index === 0}
            isLast={index === items.length - 1}
            onMove={move}
            onSetVisible={setVisible}
          />
        ))}
      </View>
    </SettingsSection>
  );
}

interface RecentWindowRowProps {
  option: RecentSessionsWindow;
  selected: boolean;
  disabled: boolean;
  isFirst: boolean;
  onToggle: (option: RecentSessionsWindow, selected: boolean) => void;
}

// 최근 범위 행 (스위치 -> 사이드바 최근 목록 범위에 추가·제외)
function RecentWindowRow({
  option,
  selected,
  disabled,
  isFirst,
  onToggle,
}: RecentWindowRowProps): ReactElement {
  const { t } = useTranslation();
  const label = recentSessionsWindowLabel(t, option);
  const handleChange = useCallback((value: boolean) => onToggle(option, value), [option, onToggle]);
  const rowStyle = useMemo(
    () => [settingsStyles.row, isFirst ? null : settingsStyles.rowBorder, styles.row],
    [isFirst],
  );
  return (
    <View style={rowStyle} testID={`sidebar-recent-window-option-${option}`}>
      <Text style={settingsStyles.rowTitle} numberOfLines={1}>
        {label}
      </Text>
      <Switch
        value={selected}
        onValueChange={handleChange}
        disabled={disabled}
        accessibilityLabel={label}
        testID={`sidebar-recent-window-toggle-${option}`}
      />
    </View>
  );
}

// 사이드바 최근 목록 범위 카드 (1~3개 선택, 마지막 하나는 끌 수 없고 3개면 더 켤 수 없다)
function RecentSessionsWindowsCard(): ReactElement {
  const { t } = useTranslation();
  const storedWindows = useRecentSessionsStore((state) => state.windows);
  const setWindows = useRecentSessionsStore((state) => state.setWindows);
  const windows = useMemo(() => normalizeRecentSessionsWindows(storedWindows), [storedWindows]);
  const handleToggle = useCallback(
    (option: RecentSessionsWindow, selected: boolean) =>
      setWindows(selected ? [...windows, option] : windows.filter((item) => item !== option)),
    [setWindows, windows],
  );
  return (
    <SettingsSection
      title={t("sidebar.recentSessions.settingsTitle")}
      info={t("sidebar.recentSessions.settingsDescription")}
      testID="sidebar-recent-windows-section"
    >
      <View style={settingsStyles.card}>
        {RECENT_SESSIONS_WINDOW_OPTIONS.map((option, index) => {
          const selected = windows.includes(option);
          return (
            <RecentWindowRow
              key={option}
              option={option}
              selected={selected}
              disabled={
                selected ? windows.length === 1 : windows.length >= MAX_RECENT_SESSIONS_WINDOWS
              }
              isFirst={index === 0}
              onToggle={handleToggle}
            />
          );
        })}
      </View>
    </SettingsSection>
  );
}

/** Settings > Sidebar: one card per section. The footer's bottom line is fixed and not listed. */
export function SidebarNavSection(): ReactElement {
  return (
    <>
      <SidebarItemsCard section="header" />
      <SidebarItemsCard section="footer" />
      <RecentSessionsWindowsCard />
      <UsagePreferencesSection />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    gap: theme.spacing[2],
  },
  rowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));

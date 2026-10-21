import { View } from "react-native";
import { Settings } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { DropdownMenu, DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { extraMutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { ToolbarButton, paneContentToolbarIconSize } from "@/components/ui/pane-content-toolbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { SettingsRow, SettingsSwitch } from "@/components/settings";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { settingsStyles } from "@/styles/settings";
import { usageCopy } from "./copy";
import { useUsagePreferences } from "./display";
import { useUsageInSidebar } from "./in-sidebar";
import type { UsageDisplayAs, UsageSidebarStyle } from "./preferences";

const DISPLAY_AS_OPTIONS: SegmentedControlOption<UsageDisplayAs>[] = [
  { value: "used", label: usageCopy.displayUsed, testID: "usage-display-used" },
  { value: "remaining", label: usageCopy.displayRemaining, testID: "usage-display-remaining" },
];

// PaseoDog: 사이드바 요약을 막대 또는 도넛으로 그린다.
const SIDEBAR_STYLE_OPTIONS: SegmentedControlOption<UsageSidebarStyle>[] = [
  { value: "bar", label: usageCopy.sidebarStyleBar, testID: "usage-sidebar-style-bar" },
  { value: "donut", label: usageCopy.sidebarStyleDonut, testID: "usage-sidebar-style-donut" },
];

const ThemedSettings = withUnistyles(Settings);

/** The shared usage preferences, opened from a cog as a popover or compact sheet. */
export function UsageOptions() {
  const compact = useIsCompactFormFactor();
  const { display, preferences, setSidebarStyle } = useUsagePreferences();
  const { inSidebar, setInSidebar } = useUsageInSidebar();
  return (
    <DropdownMenu compactMode="sheet">
      <ToolbarButton
        kind="menu"
        label={usageCopy.options}
        compact={compact}
        testID="usage-options-menu"
      >
        <ThemedSettings
          size={paneContentToolbarIconSize(compact)}
          uniProps={extraMutedIconColorMapping}
        />
      </ToolbarButton>
      <DropdownMenuContent
        align="end"
        width={340}
        sheetTitle={usageCopy.options}
        testID="usage-options-surface"
      >
        <View testID="usage-options-fields">
          <SettingsSwitch
            label={usageCopy.showInSidebar}
            hint={usageCopy.showInSidebarHint}
            value={inSidebar}
            onValueChange={setInSidebar}
            testID="usage-show-in-sidebar"
          />
          <View style={settingsStyles.rowBorder}>
            <SettingsRow label={usageCopy.displayAs}>
              <SegmentedControl
                options={DISPLAY_AS_OPTIONS}
                value={display.displayAs}
                onValueChange={display.setDisplayAs}
                size="sm"
                testID="usage-display-as"
              />
            </SettingsRow>
          </View>
          <View style={settingsStyles.rowBorder}>
            <SettingsRow label={usageCopy.sidebarStyle}>
              <SegmentedControl
                options={SIDEBAR_STYLE_OPTIONS}
                value={preferences.sidebarStyle ?? "bar"}
                onValueChange={setSidebarStyle}
                size="sm"
                testID="usage-sidebar-style"
              />
            </SettingsRow>
          </View>
        </View>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

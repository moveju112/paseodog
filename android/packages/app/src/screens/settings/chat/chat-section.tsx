import { useCallback, useMemo } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  SettingsCard,
  SettingsInput,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@/components/settings";
import { isNative } from "@/constants/platform";
import { useAppSettings, type AppSettings } from "@/hooks/use-settings";
import { ASSISTANT_ICONS } from "@/hooks/use-settings/assistant-icons";

const TOOL_CALL_DETAIL_LEVELS: readonly AppSettings["toolCallDetailLevel"][] = [
  "detailed",
  "overview",
  "hidden",
];

// 채팅 표시 설정과 도우미 닉네임을 기기별로 저장한다.
export function ChatSection() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();

  const assistantIconOptions = useMemo(
    () =>
      ASSISTANT_ICONS.map((value) => ({
        value,
        label: value || t("settings.general.assistantIcon.initial"),
      })),
    [t],
  );
  const changeAssistantIcon = useCallback(
    (assistantIcon: AppSettings["assistantIcon"]) => void updateSettings({ assistantIcon }),
    [updateSettings],
  );
  const toolCallDetailOptions = useMemo(
    () =>
      TOOL_CALL_DETAIL_LEVELS.map((value) => ({
        value,
        label: t(`settings.general.toolCallDetail.options.${value}`),
      })),
    [t],
  );

  const changeToolCallDetailLevel = useCallback(
    (toolCallDetailLevel: AppSettings["toolCallDetailLevel"]) =>
      void updateSettings({ toolCallDetailLevel }),
    [updateSettings],
  );
  // 닉네임 입력 (변경값 -> 기존 앱 설정 저장·빈 값은 Dog로 정규화).
  const changeAssistantNickname = useCallback(
    (assistantNickname: string) => void updateSettings({ assistantNickname }),
    [updateSettings],
  );
  const changeAutoExpandReasoning = useCallback(
    (autoExpandReasoning: boolean) => void updateSettings({ autoExpandReasoning }),
    [updateSettings],
  );
  // 추론 숨김 전환 (스위치 값 -> 기기별 채팅 표시 설정 저장)
  const changeHideReasoning = useCallback(
    (hideReasoning: boolean) => void updateSettings({ hideReasoning }),
    [updateSettings],
  );
  const changeChatOutline = useCallback(
    (chatOutlineEnabled: boolean) => void updateSettings({ chatOutlineEnabled }),
    [updateSettings],
  );
  const changeShowGitDiffSummary = useCallback(
    (showGitDiffSummary: boolean) => void updateSettings({ showGitDiffSummary }),
    [updateSettings],
  );

  return (
    <View>
      <SettingsSection title={t("settings.appearance.detailLevel.title")}>
        <SettingsCard>
          <SettingsInput
            label={t("settings.general.assistantNickname.label")}
            hint={t("settings.general.assistantNickname.description")}
            initialValue={settings.assistantNickname}
            placeholder="Dog"
            onChangeText={changeAssistantNickname}
            testID="assistant-nickname-input"
          />
          <SettingsSelect
            label={t("settings.general.assistantIcon.label")}
            hint={t("settings.general.assistantIcon.description")}
            value={settings.assistantIcon}
            options={assistantIconOptions}
            onValueChange={changeAssistantIcon}
            testID="assistant-icon-select"
          />
          <SettingsSwitch
            label={t("settings.general.autoExpandReasoning.label")}
            hint={t("settings.general.autoExpandReasoning.description")}
            value={settings.autoExpandReasoning}
            onValueChange={changeAutoExpandReasoning}
          />
          <SettingsSwitch
            label={t("settings.general.hideReasoning.label")}
            hint={t("settings.general.hideReasoning.description")}
            value={settings.hideReasoning}
            onValueChange={changeHideReasoning}
          />
          <SettingsSelect
            label={t("settings.general.toolCallDetail.label")}
            hint={t("settings.general.toolCallDetail.description")}
            value={settings.toolCallDetailLevel}
            options={toolCallDetailOptions}
            onValueChange={changeToolCallDetailLevel}
          />
          <SettingsSwitch
            label={t("settings.appearance.gitDiffSummary.title")}
            hint={t("settings.appearance.gitDiffSummary.description")}
            value={settings.showGitDiffSummary}
            onValueChange={changeShowGitDiffSummary}
          />
          {isNative ? null : (
            <SettingsSwitch
              label={t("settings.appearance.chatOutline.title")}
              hint={t("settings.appearance.chatOutline.description")}
              value={settings.chatOutlineEnabled}
              onValueChange={changeChatOutline}
            />
          )}
        </SettingsCard>
      </SettingsSection>
    </View>
  );
}

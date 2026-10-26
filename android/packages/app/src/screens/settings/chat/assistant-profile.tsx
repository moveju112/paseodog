import * as React from "react";
import { Image, View } from "react-native";
import { useTranslation } from "react-i18next";
import { SettingsAction, SettingsRow, SettingsSelect } from "@/components/settings";
import { useAppSettings } from "@/hooks/use-settings";
import { ASSISTANT_ICONS } from "@/hooks/use-settings/assistant-icons";
import { pickAssistantPhoto } from "@/hooks/assistant-photo-picker";
import { createAssistantProfileSettings } from "./assistant-profile-settings";

export const AssistantProfileSettings = createAssistantProfileSettings({
  React,
  View,
  Image,
  SettingsAction,
  SettingsRow,
  SettingsSelect,
  useTranslation,
  useAppSettings,
  icons: ASSISTANT_ICONS,
  pickPhoto: pickAssistantPhoto,
});

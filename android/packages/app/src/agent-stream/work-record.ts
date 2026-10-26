import * as React from "react";
import { View, Text, Image, Pressable } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "@/stores/session-store";
import { createWorkRecordRenderer } from "./work-record-renderer";
import { useSettings } from "@/hooks/use-settings";

export const renderWorkRecord = createWorkRecordRenderer({
  React,
  View: withUnistyles(View),
  Text: withUnistyles(Text),
  Image: withUnistyles(Image),
  Pressable: withUnistyles(Pressable),
  StyleSheet,
  useTranslation,
  useAssistantNickname: () => useSettings((settings) => settings.assistantNickname),
  useAssistantIcon: () => useSettings((settings) => settings.assistantIcon),
  useAssistantPhoto: () => useSettings((settings) => settings.assistantPhoto),
  getClient: (serverId) => useSessionStore.getState().sessions[serverId]?.client ?? null,
});

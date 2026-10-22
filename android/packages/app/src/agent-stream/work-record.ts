import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "@/stores/session-store";
import { createWorkRecordRenderer } from "./work-record-renderer";

export const renderWorkRecord = createWorkRecordRenderer({
  React,
  View: withUnistyles(View),
  Text: withUnistyles(Text),
  Pressable: withUnistyles(Pressable),
  StyleSheet,
  useTranslation,
  getClient: (serverId) => useSessionStore.getState().sessions[serverId]?.client ?? null,
});

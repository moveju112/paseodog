import * as React from "react";
import { Linking } from "react-native";
import { useSidebarCallouts } from "@/contexts/sidebar-callout-context";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHosts, useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { createDaemonUpdateCallouts } from "./daemon-update-callouts";

export const DaemonUpdateCallouts = createDaemonUpdateCallouts({
  React,
  useHosts,
  useClient: useHostRuntimeClient,
  useConnected: useHostRuntimeIsConnected,
  useProvidersSnapshot,
  useCallouts: useSidebarCallouts,
  openURL: (url) => Linking.openURL(url),
  fetch: (...args) => globalThis.fetch(...args),
});

import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

export interface StartPushNotificationsInput {
  client: DaemonClient;
  serverId: string;
  enabled: boolean;
}

export interface RevokePushNotificationsInput {
  client: DaemonClient | null;
  serverId: string;
}

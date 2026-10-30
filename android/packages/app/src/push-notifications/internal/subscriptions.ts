import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { z } from "zod";
import { readValidatedString } from "@/storage/validated-storage";
import { requestAndroidNotificationPermission } from "@/utils/android-notifications";
import type { RevokePushNotificationsInput, StartPushNotificationsInput } from "./types";

const STORAGE_PREFIX = "@paseo:expo-push-token:";
const ExpoPushTokenSchema = z.string().trim().min(1);

function storageKey(serverId: string): string {
  return `${STORAGE_PREFIX}${serverId}`;
}

function getExpoProjectId(): string | null {
  const fromEas = ExpoPushTokenSchema.safeParse(Constants.easConfig?.projectId);
  if (fromEas.success) return fromEas.data;
  const fromExtra = ExpoPushTokenSchema.safeParse(Constants.expoConfig?.extra?.eas?.projectId);
  return fromExtra.success ? fromExtra.data : null;
}

async function ensurePushPermission(): Promise<boolean> {
  if (Platform.OS === "android") return requestAndroidNotificationPermission();
  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === Notifications.PermissionStatus.GRANTED) return true;
  if (!existing.canAskAgain) return false;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.status === Notifications.PermissionStatus.GRANTED;
}

async function resolveToken(
  input: StartPushNotificationsInput,
  isStopped: () => boolean,
): Promise<string | null> {
  if (!(await ensurePushPermission())) {
    if (!isStopped()) await revokeSubscription(input);
    return null;
  }

  const projectId = getExpoProjectId();
  if (!projectId) {
    console.warn("[PushNotifications] Missing EAS projectId; cannot fetch Expo push token");
    return null;
  }

  const result = await Notifications.getExpoPushTokenAsync({ projectId });
  const token = result.data.trim();
  if (!token || isStopped()) return null;
  await AsyncStorage.setItem(storageKey(input.serverId), token);
  return token;
}

export function startSubscription(input: StartPushNotificationsInput): () => void {
  let stopped = false;
  let token: string | null = null;
  let resolving = false;
  const register = () => {
    if (stopped || !input.client.isConnected) return;
    if (token) {
      input.client.registerPushToken(token);
      return;
    }
    if (resolving) return;
    resolving = true;
    void resolveToken(input, () => stopped)
      .then((resolved) => {
        if (stopped) return undefined;
        token = resolved;
        if (token && input.client.isConnected) input.client.registerPushToken(token);
        return undefined;
      })
      .catch((error) => console.warn("[PushNotifications] Failed to register push token", error))
      .finally(() => {
        resolving = false;
      });
  };

  register();

  const unsubscribe = input.client.subscribeConnectionStatus((state) => {
    if (state.status === "connected") register();
  });

  return () => {
    stopped = true;
    unsubscribe();
  };
}

export async function revokeSubscription(input: RevokePushNotificationsInput): Promise<void> {
  const key = storageKey(input.serverId);
  const token = await readValidatedString(AsyncStorage, key, ExpoPushTokenSchema);
  if (
    token &&
    input.client?.isConnected &&
    input.client.getLastServerInfoMessage()?.features?.pushTokenRevocation === true
  ) {
    try {
      await input.client.unregisterPushToken(token);
    } catch (error) {
      console.warn("[PushNotifications] Failed to revoke push token", error);
      return;
    }
    await AsyncStorage.removeItem(key);
  }
}

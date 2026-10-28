import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import { requireNativeModule } from "expo-modules-core";
import { useAppSettings } from "@/hooks/use-settings";
import { selectAgentTurnPresentation, useSessionStore } from "@/stores/session-store";

export function BackgroundNotifications() {
  const { settings } = useAppSettings();
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const service = requireNativeModule<{ setActive(active: boolean): void }>(
      "PaseodogBackgroundNotifications",
    );
    let running = false;
    const sync = () => {
      const active =
        settings.backgroundNotificationsEnabled &&
        Object.values(useSessionStore.getState().sessions).some((session) =>
          [...new Set([...session.agents.keys(), ...session.messageSubmissions.keys()])].some(
            (id) => selectAgentTurnPresentation(session, id).isActive,
          ),
        );
      if (active === running) return;
      // Android는 백그라운드에서 새 foreground service를 시작하는 것을 제한한다.
      if (active && AppState.currentState !== "active") return;
      try {
        service.setActive(active);
        running = active;
      } catch (error) {
        console.warn("[Notifications] Background connection service failed", error);
      }
    };
    const unsubscribe = useSessionStore.subscribe(sync);
    const appState = AppState.addEventListener("change", sync);
    sync();
    return () => {
      unsubscribe();
      appState.remove();
      service.setActive(false);
    };
  }, [settings.backgroundNotificationsEnabled]);
  return null;
}

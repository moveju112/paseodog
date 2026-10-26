import { useVoiceAudioEngineOptional } from "@/contexts/voice-context";
import { pluginSettingsKey } from "./settings/use-settings";
import { useEffect, useRef } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { pluginRegistry } from "./registry";

export function PluginCatalogSync({
  serverId,
  client,
}: {
  serverId: string;
  client: DaemonClient;
}) {
  const audio = useVoiceAudioEngineOptional();
  const connected = useHostRuntimeIsConnected(serverId);
  const supported = useHostFeature(serverId, "plugins");
  // 설치에 사용한 클라이언트. 같은 클라이언트의 재연결은 기존 설치를 재사용한다.
  const installedClient = useRef<DaemonClient | null>(null);

  useEffect(() => {
    let cancelled = false;
    let refreshQueue = Promise.resolve();
    if (!supported || !audio) {
      pluginRegistry.removeHost(serverId);
      return;
    }
    // 앱 백그라운드 등 일시적인 연결 끊김에는 설치된 플러그인 화면을 유지한다.
    // 재연결 후 카탈로그가 같으면 번들을 다시 평가하지 않아 버튼이 늦게 나타나지 않는다.
    if (!connected) return;
    if (installedClient.current && installedClient.current !== client)
      pluginRegistry.removeHost(serverId);
    installedClient.current = client;
    const refresh = (replacePluginId?: string) => {
      refreshQueue = refreshQueue.then(() =>
        client
          .getPluginCatalog()
          .then((catalog) => {
            if (!cancelled) {
              pluginRegistry.installCatalog(serverId, catalog, {
                replacePluginId,
                client,
                audio,
              });
            }
            return undefined;
          })
          .catch((error) => {
            if (!cancelled) {
              console.warn(`[Plugins] Failed to load catalog for ${serverId}`, error);
            }
            return undefined;
          }),
      );
      return refreshQueue;
    };
    const observation = client.observeEvents([
      "status.plugin_catalog_changed",
      "status.plugin_settings_changed",
    ]);
    observation.subscribe({
      snapshot: () => {
        void refresh();
      },
      update: (message) => {
        if (message.type !== "status") return;
        if (message.payload.status === "plugin_settings_changed") {
          const { pluginId, settingsId } = message.payload;
          if (typeof settingsId === "string") {
            const plugin = pluginRegistry
              .getSnapshot()
              .find((item) => item.serverId === serverId && item.id === pluginId);
            void plugin?.queryClient.invalidateQueries({ queryKey: pluginSettingsKey(settingsId) });
          }
        }
        if (message.payload.status === "plugin_catalog_changed") {
          const pluginId = message.payload.pluginId;
          if (typeof pluginId === "string") void refresh(pluginId);
        }
      },
    });
    return () => {
      cancelled = true;
      void observation
        .release()
        .catch((error) => console.warn("[Plugins] Failed to release catalog", error));
    };
  }, [audio, client, connected, serverId, supported]);

  useEffect(() => () => pluginRegistry.removeHost(serverId), [serverId]);
  return null;
}

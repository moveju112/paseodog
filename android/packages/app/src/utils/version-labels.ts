import type * as ReactTypes from "react";

interface Client {
  invokePluginRpc: (pluginId: string, method: string, input: unknown) => Promise<unknown>;
}

interface Dependencies {
  React: typeof ReactTypes;
  readAppRelease: () => Promise<unknown>;
  useClient: (serverId: string) => Client | null;
  useConnected: (serverId: string) => boolean;
  useProvidersSnapshot: (serverId: string) => {
    entries: readonly { provider: string }[] | undefined;
  };
}

// 버전 표시는 호환성 비교와 분리한다. 앱·원격 호스트 값을 서로 대신 사용하지 않는다.
export function createVersionLabels(deps: Dependencies) {
  const { React, readAppRelease, useClient, useConnected, useProvidersSnapshot } = deps;

  function releaseLines(value: unknown, baseVersion: string, engine: boolean): string {
    const release = value as {
      version?: unknown;
      versionCode?: unknown;
      paseodogUpstream?: { mixdog?: unknown };
    } | null;
    const version =
      typeof release?.version === "string" && release.version.trim()
        ? release.version.trim()
        : "미확인";
    const build =
      Number.isSafeInteger(release?.versionCode) && (release!.versionCode as number) > 0
        ? String(release!.versionCode)
        : "미확인";
    const lines = [`PaseoDog: ${version}`, `빌드: ${build}`, `Paseo: ${baseVersion}`];
    if (engine) {
      const mixdog = release?.paseodogUpstream?.mixdog;
      lines.push(`Mixdog: ${typeof mixdog === "string" && mixdog.trim() ? mixdog.trim() : "미확인"}`);
    }
    return lines.join("\n");
  }

  function useAppVersionText(baseVersion: string): string {
    const [release, setRelease] = React.useState<unknown>(null);
    React.useEffect(() => {
      let cancelled = false;
      void (async () => {
        try {
          const value = await readAppRelease();
          if (!cancelled) setRelease(value);
        } catch {
          if (!cancelled) setRelease(null);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, []);
    return releaseLines(release, baseVersion, false);
  }

  function useHostVersionText(serverId: string, baseVersion: string): string {
    const client = useClient(serverId);
    const connected = useConnected(serverId);
    const { entries } = useProvidersSnapshot(serverId);
    const isPaseodog = entries?.some((entry) => entry.provider === "paseodog") === true;
    const [result, setResult] = React.useState<{
      serverId: string;
      client: Client;
      release: unknown;
    } | null>(null);
    React.useEffect(() => {
      setResult(null);
      if (!connected || !client || !isPaseodog) return;
      let cancelled = false;
      void (async () => {
        try {
          const release = await client.invokePluginRpc("paseodog-provider", "daemon-release", {});
          if (!cancelled) setResult({ serverId, client, release });
        } catch {
          if (!cancelled) setResult(null);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [serverId, client, connected, isPaseodog]);
    if (!connected) return baseVersion;
    if (!isPaseodog) return `Paseo: ${baseVersion}`;
    const release = result?.serverId === serverId && result.client === client ? result.release : null;
    return releaseLines(release, baseVersion, true);
  }

  return { useAppVersionText, useHostVersionText };
}

import type * as ReactTypes from "react";
import type { SidebarCalloutOptions } from "@/contexts/sidebar-callout-state";

interface Client {
  invokePluginRpc: (pluginId: string, method: string, input: unknown) => Promise<unknown>;
}
interface Host {
  serverId: string;
  label: string;
}
interface PublishedRelease {
  versionCode: number;
  versionName: string;
}
interface Dependencies {
  React: typeof ReactTypes;
  useHosts: () => readonly Host[];
  useClient: (serverId: string) => Client | null;
  useConnected: (serverId: string) => boolean;
  useProvidersSnapshot: (serverId: string) => {
    entries: readonly { provider: string }[] | undefined;
  };
  useCallouts: () => { show: (options: SidebarCalloutOptions) => () => void };
  openURL: (url: string) => unknown;
  fetch: typeof globalThis.fetch;
}

// 공유 앱과 검토된 웹 번들에서 같은 훅·알림 수명주기를 사용한다.
export function createDaemonUpdateCallouts(deps: Dependencies) {
  const { React, useHosts, useClient, useConnected, useProvidersSnapshot, useCallouts } = deps;
  const intervalMs = 30 * 60 * 1000;
  // GitHub 다운로드 리다이렉트는 CORS를 허용하지 않아 브라우저에서도 읽을 수 있는 API를 쓴다.
  const releaseURL = "https://api.github.com/repos/moveju112/paseodog/releases/latest";
  const releasesURL = "https://github.com/moveju112/paseodog/releases/latest";

  function HostUpdate({ host, latest }: { host: Host; latest: PublishedRelease | null }) {
    const client = useClient(host.serverId);
    const connected = useConnected(host.serverId);
    const { entries } = useProvidersSnapshot(host.serverId);
    const isPaseodog = entries?.some((entry) => entry.provider === "paseodog") === true;
    const callouts = useCallouts();
    const [status, setStatus] = React.useState<{
      client: Client;
      versionCode: number | null;
      version: string | null;
    } | null>(null);

    React.useEffect(() => {
      setStatus(null);
      if (!connected || !client || !isPaseodog) return;
      let cancelled = false;
      let checking = false;
      async function check() {
        if (checking) return;
        checking = true;
        try {
          const value = await client!.invokePluginRpc("paseodog-provider", "daemon-release", {});
          const release = value as { version?: unknown; versionCode?: unknown } | null;
          if (
            !release ||
            typeof release.version !== "string" ||
            !release.version.trim() ||
            !Number.isSafeInteger(release.versionCode) ||
            (release.versionCode as number) <= 0
          ) {
            throw new Error("데몬 릴리즈 정보를 확인할 수 없습니다.");
          }
          if (!cancelled) {
            setStatus({
              client: client!,
              versionCode: release.versionCode as number,
              version: release.version,
            });
          }
        } catch {
          // 구형 RPC·통신 실패를 '업데이트 있음'이나 '최신'으로 단정하지 않는다.
          if (!cancelled) setStatus({ client: client!, versionCode: null, version: null });
        } finally {
          checking = false;
        }
      }
      void check();
      const timer = setInterval(() => void check(), intervalMs);
      return () => {
        cancelled = true;
        clearInterval(timer);
      };
    }, [client, connected, isPaseodog]);

    React.useEffect(() => {
      if (!connected || !isPaseodog || !latest || !status || status.client !== client) return;
      if (status.versionCode !== null && status.versionCode >= latest.versionCode) return;
      const unknown = status.versionCode === null;
      return callouts.show({
        id: `paseodog-daemon-update:${host.serverId}`,
        dismissalKey: `paseodog-daemon-update:${host.serverId}:${latest.versionCode}:${unknown ? "unknown" : status.versionCode}`,
        priority: 40,
        title: unknown ? "데몬 업데이트 확인 필요" : "데몬 업데이트 사용 가능",
        description: unknown
          ? `${host.label}: 데몬 버전을 확인하지 못했습니다. 최신 ${latest.versionName}과 비교하려면 호스트의 PaseoDog 버전을 확인하세요.`
          : `${host.label}: ${status.version}.${status.versionCode} → ${latest.versionName}\n이 앱을 업데이트해도 연결된 데몬은 업데이트되지 않습니다. 호스트에서 업데이트·재시작하면 실행 중인 작업이 중지될 수 있습니다.`,
        actions: [
          {
            label: "업데이트 안내",
            variant: "primary",
            onPress: () => {
              void deps.openURL(releasesURL);
            },
          },
        ],
        testID: `paseodog-daemon-update:${host.serverId}`,
      });
    }, [callouts, client, connected, host.label, host.serverId, isPaseodog, latest, status]);
    return null;
  }

  return function DaemonUpdateCallouts() {
    const hosts = useHosts();
    const hasHosts = hosts.length > 0;
    const [latest, setLatest] = React.useState<PublishedRelease | null>(null);
    React.useEffect(() => {
      if (!hasHosts) return;
      let cancelled = false;
      let controller: AbortController | null = null;
      async function check() {
        if (controller) return;
        controller = new AbortController();
        const current = controller;
        const timeout = setTimeout(() => current.abort(), 30000);
        try {
          const response = await deps.fetch(releaseURL, { signal: current.signal });
          if (!response.ok) throw new Error(`업데이트 조회 실패: HTTP ${response.status}`);
          const release = (await response.json()) as {
            tag_name?: unknown;
            draft?: unknown;
            prerelease?: unknown;
          } | null;
          const match =
            typeof release?.tag_name === "string"
              ? /^v[0-9][0-9A-Za-z.+-]*\.([1-9]\d*)$/.exec(release.tag_name)
              : null;
          if (
            !match ||
            release?.draft !== false ||
            release.prerelease !== false ||
            !Number.isSafeInteger(Number(match[1]))
          ) {
            throw new Error("공개된 PaseoDog 릴리즈 정보를 확인할 수 없습니다.");
          }
          if (!cancelled) {
            setLatest({
              versionName: (release.tag_name as string).slice(1),
              versionCode: Number(match[1]),
            });
          }
        } catch {
          if (!cancelled) setLatest(null);
        } finally {
          clearTimeout(timeout);
          controller = null;
        }
      }
      void check();
      const timer = setInterval(() => void check(), intervalMs);
      return () => {
        cancelled = true;
        clearInterval(timer);
        controller?.abort();
      };
    }, [hasHosts]);
    return React.createElement(
      React.Fragment,
      null,
      ...hosts.map((host) => React.createElement(HostUpdate, { key: host.serverId, host, latest })),
    );
  };
}

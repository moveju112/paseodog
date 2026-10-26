/** @vitest-environment jsdom */
import React from "react";
import { renderHook } from "@testing-library/react";
import { afterAll, describe, expect, it, vi } from "vitest";
import { NewTabLauncherProvider, useWorkspaceTabLaunchCatalog, type NewTabLauncher } from "./index";

vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());

function launcherWrapper(value: () => NewTabLauncher) {
  return function Wrapper({ children }: React.PropsWithChildren) {
    const launcher = value();
    return <NewTabLauncherProvider value={launcher}>{children}</NewTabLauncherProvider>;
  };
}

vi.mock("expo-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/use-daemon-config", () => ({ useDaemonConfig: () => ({ config: null }) }));
vi.mock("@/plugins/registry", () => ({ useInstalledPlugins: () => [] }));
vi.mock("@/plugins/icons", () => ({ resolvePluginIcon: () => null }));
vi.mock("@/plugins/workspace-panels/locations", () => ({
  pluginPanelSupportsLocation: () => true,
}));
vi.mock("@/utils/host-routes", () => ({ buildSettingsHostSectionRoute: () => "/settings" }));
vi.mock("@/panels/register-panels", () => ({ ensurePanelsRegistered: () => {} }));
vi.mock("@/panels/panel-registry", () => ({
  getPanelRegistration: (kind: string) => ({
    presentation: { label: () => kind, icon: () => null },
  }),
}));

describe("workspace import launcher", () => {
  it.each(["menu" as const, "panel" as const])(
    "opens the existing import sheet next to the agent action on the main $0 and tracks availability",
    (surface) => {
      const open = vi.fn();
      const launch = vi.fn();
      let launcher: NewTabLauncher = {
        showChanges: false,
        showPullRequest: false,
        showBrowser: false,
        terminalDisabled: false,
        importSession: { disabled: false, open },
        launch,
      };
      const { result, rerender } = renderHook(
        () =>
          useWorkspaceTabLaunchCatalog({
            serverId: "host",
            purpose: "primary",
            host: "main",
            surface,
          }),
        {
          wrapper: launcherWrapper(() => launcher),
        },
      );
      const items = () => result.current.flatMap((group) => group.items);
      expect(
        items()
          .slice(0, 2)
          .map((item) => item.id),
      ).toEqual(["agent", "import-session"]);
      expect(items()[1].disabled).toBe(false);
      items()[1].launch({ kind: "open", paneId: "primary" });
      expect(open).toHaveBeenCalledOnce();
      expect(launch).not.toHaveBeenCalled();
      launcher = { ...launcher, importSession: { disabled: true, open } };
      rerender();
      expect(items()[1].disabled).toBe(true);
    },
  );

  it.each([
    { host: "explorer" as const, surface: "menu" as const },
    { host: "explorer" as const, surface: "panel" as const },
  ])("keeps import out of $host $surface launches", ({ host, surface }) => {
    const launcher: NewTabLauncher = {
      showChanges: false,
      showPullRequest: false,
      showBrowser: false,
      terminalDisabled: false,
      importSession: { disabled: false, open: vi.fn() },
      launch: vi.fn(),
    };
    const { result } = renderHook(
      () => useWorkspaceTabLaunchCatalog({ serverId: "host", purpose: "primary", host, surface }),
      {
        wrapper: launcherWrapper(() => launcher),
      },
    );
    expect(result.current.flatMap((group) => group.items).map((item) => item.id)).not.toContain(
      "import-session",
    );
  });
});

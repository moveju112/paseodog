/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ connected: true }));

vi.mock("@/contexts/voice-context", () => ({
  useVoiceAudioEngineOptional: () => ({ play: vi.fn() }),
}));
vi.mock("@/runtime/host-features", () => ({ useHostFeature: () => true }));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeIsConnected: () => state.connected,
}));
vi.mock("./settings/use-settings", () => ({ pluginSettingsKey: (id: string) => ["settings", id] }));
vi.mock("./registry", () => ({
  pluginRegistry: { removeHost: vi.fn(), installCatalog: vi.fn(), getSnapshot: () => [] },
}));

import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { PluginCatalogSync } from "./catalog-sync";
import { pluginRegistry } from "./registry";

function fakeClient(): DaemonClient {
  return {
    getPluginCatalog: vi.fn(async () => []),
    observeEvents: () => ({ subscribe: () => undefined, release: async () => undefined }),
  } as unknown as DaemonClient;
}

beforeEach(() => {
  state.connected = true;
  vi.mocked(pluginRegistry.removeHost).mockClear();
});

// 앱 백그라운드 복귀처럼 같은 클라이언트가 다시 연결되면 설치된 플러그인 화면을 유지한다.
it("keeps installed plugins across a temporary disconnect of the same client", () => {
  const client = fakeClient();
  const view = render(<PluginCatalogSync serverId="host" client={client} />);
  state.connected = false;
  view.rerender(<PluginCatalogSync serverId="host" client={client} />);
  state.connected = true;
  view.rerender(<PluginCatalogSync serverId="host" client={client} />);
  expect(pluginRegistry.removeHost).not.toHaveBeenCalled();

  // 다른 클라이언트로 바뀌면 이전 클라이언트에 묶인 설치를 정리한다.
  view.rerender(<PluginCatalogSync serverId="host" client={fakeClient()} />);
  expect(pluginRegistry.removeHost).toHaveBeenCalledWith("host");
  view.unmount();
});

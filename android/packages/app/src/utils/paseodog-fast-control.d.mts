import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

interface FastSnapshot {
  enabled: boolean | null;
  available: boolean;
  busy: boolean;
  error: string;
}

interface FastControl {
  getSnapshot(): FastSnapshot;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  toggle(): Promise<void>;
}

type FastClient = Pick<DaemonClient, "isConnected" | "fetchAgent" | "setAgentFeature" | "invokePluginRpc">;

export function createFastControl(client: FastClient, agentId?: string | null, modelId?: string | null): FastControl;
export function getFastControl(client: FastClient, agentId?: string | null, modelId?: string | null): FastControl;

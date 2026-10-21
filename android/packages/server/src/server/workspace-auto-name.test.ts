import pino from "pino";
import { expect, test, vi } from "vitest";
import type { AgentManager } from "./agent/agent-manager.js";
import type { ProviderSnapshotManager } from "./agent/provider-snapshot-manager.js";
import { WorkspaceAutoName } from "./workspace-auto-name.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";

test("directory title generation waits for a completed conversation, not the opening prompt", () => {
  const generateWorkspaceName = vi.fn();
  const update = vi.fn();
  const autoName = new WorkspaceAutoName({
    agentManager: {} as AgentManager,
    workspaceRegistry: { update },
    workspaceGitService: {} as WorkspaceGitService,
    providerSnapshotManager: {} as ProviderSnapshotManager,
    readDaemonConfig: () => ({}),
    gitMutation: { notifyGitMutation: async () => {} },
    emitWorkspaceUpdateForCwd: async () => {},
    emitWorkspaceUpdateForWorkspaceId: async () => {},
    logger: pino({ level: "silent" }),
    generateWorkspaceName,
  });
  autoName.scheduleForDirectory({
    workspaceId: "workspace",
    cwd: "/workspace",
    firstAgentContext: { prompt: "https://github.com/example/project" },
  });
  expect(generateWorkspaceName).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
});

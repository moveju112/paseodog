import { describe, expect, it } from "vitest";
import { engineSnapshotSchema, routeCommand } from "./ai-engine-contract";
import { normalizeHostSectionSlug } from "@/utils/host-routes";
import { buildSelectableProviderSelectorProviders } from "@/provider-selection/provider-selection";
import { buildProviderDefinitions } from "@/utils/provider-definitions";

describe("host AI engine settings", () => {
  it("recognizes each engine host section and redirects the legacy combined page", () => {
    for (const slug of [
      "engine-accounts",
      "engine-workflow",
      "engine-tokens",
      "engine-instructions",
      "engine-tools",
      "engine-skills",
      "engine-agents",
    ]) {
      expect(normalizeHostSectionSlug(slug)).toBe(slug);
    }
    expect(normalizeHostSectionSlug("ai-engine")).toBe("engine-workflow");
  });
  it("accepts instruction file mode and read-only agent definitions from the engine", () => {
    const route = {
      provider: "subscription",
      model: "small",
      effort: null,
      fast: false,
      autoEffort: false,
    };
    const result = engineSnapshotSchema.parse({
      route,
      models: [],
      agents: [],
      workflows: [],
      orchestration: "none",
      compaction: { auto: true },
      sessions: [],
      instructionFiles: "claude",
      agentDefinition: {
        id: "worker",
        name: "Worker",
        body: "# Body\n",
        custom: true,
        userOverride: false,
      },
    });
    expect(result.instructionFiles).toBe("claude");
    expect(result.agentDefinition?.body).toBe("# Body\n");
  });
  it("keeps main and agent settings isolated", () => {
    expect(routeCommand(null, { model: "small" })).toEqual({
      action: "main",
      route: { model: "small" },
    });
    expect(routeCommand("worker", { autoEffort: false })).toEqual({
      action: "agent",
      agent: "worker",
      route: { autoEffort: false },
    });
  });
  it("accepts native engine state with workflowPack and autoClear, and rejects incompatible responses", () => {
    const route = {
      provider: "subscription",
      model: "small",
      effort: null,
      fast: false,
      autoEffort: false,
    };
    const result = engineSnapshotSchema.parse({
      route,
      models: [],
      agents: [{ id: "worker", label: "Worker", description: "구현", disabled: true, route }],
      workflows: [{ id: "default", name: "Default", active: true }],
      workflowPack: { id: "default", name: "Default", body: "# Rules\n" },
      orchestration: "balanced",
      compaction: { auto: true, onModelChange: true, mainBufferPercent: 0.2 },
      autoClear: { enabled: true, idleMs: 3600000, minContextPercent: 50 },
      sessions: [],
    });
    expect(result.agents[0].disabled).toBe(true);
    expect(result.autoClear?.enabled).toBe(true);
    expect(result.workflowPack?.id).toBe("default");
    expect(result.orchestration).toBe("swarm");
    expect(() => engineSnapshotSchema.parse({ ...result, compaction: {} })).toThrow();
  });
  it("filters out omp, pi, opencode, claude, codex, and copilot when paseodog is present", () => {
    const entries = [
      { provider: "claude", label: "Claude", enabled: true, status: "ready" as const, models: [] },
      { provider: "codex", label: "Codex", enabled: true, status: "ready" as const, models: [] },
      {
        provider: "opencode",
        label: "OpenCode",
        enabled: true,
        status: "ready" as const,
        models: [],
      },
      { provider: "pi", label: "Pi", enabled: true, status: "ready" as const, models: [] },
      { provider: "omp", label: "Oh My Pi", enabled: true, status: "ready" as const, models: [] },
      {
        provider: "paseodog",
        label: "PaseoDog",
        enabled: true,
        status: "ready" as const,
        models: [],
      },
    ];
    expect(buildSelectableProviderSelectorProviders(entries).map((p) => p.id)).toEqual([
      "paseodog",
    ]);
    expect(buildProviderDefinitions(entries).map((p) => p.id)).toEqual(["paseodog"]);
  });
});

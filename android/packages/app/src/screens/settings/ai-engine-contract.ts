import { z } from "zod";

const fallbackRouteSchema = z.object({
  provider: z.string(),
  model: z.string(),
  effort: z.string().optional(),
  fast: z.boolean().optional(),
});

const route = z.object({
  provider: z.string(),
  model: z.string(),
  effort: z.string().nullable().optional(),
  fast: z.boolean(),
  autoEffort: z.boolean(),
  inherited: z.boolean().optional(),
  contextPercent: z.number().optional(),
  contextTokens: z.number().optional(),
  fallbacks: z.array(fallbackRouteSchema).optional(),
});

const moduleStateSchema = z.object({
  enabled: z.boolean(),
  installed: z.boolean().optional(),
  supported: z.boolean().optional(),
});

export const workflowPackSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  body: z.string(),
  source: z.string().optional(),
  userOverride: z.boolean().optional(),
  editable: z.boolean().optional(),
});

export const agentDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  body: z.string(),
  revision: z.string().optional(),
  custom: z.boolean().optional(),
  userOverride: z.boolean().optional(),
});

export const engineSnapshotSchema = z.object({
  route,
  instructionFiles: z.string().optional(),
  recap: z.boolean().optional(),
  aiSessionTitles: z.boolean().optional(),
  toolModules: z
    .object({
      webSearch: z.boolean(),
      memory: moduleStateSchema,
      git: moduleStateSchema,
      office: moduleStateSchema,
      tidy: moduleStateSchema,
      visualize: moduleStateSchema,
      media: moduleStateSchema,
      localProvider: moduleStateSchema,
      autoEffort: moduleStateSchema,
    })
    .optional(),
  webSearchRoute: z
    .object({
      inherited: z.boolean().optional(),
      provider: z.string().optional(),
      model: z.string().optional(),
      effort: z.string().nullable().optional(),
      effectiveProvider: z.string().optional(),
      effectiveModel: z.string().optional(),
      effectiveEffort: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  outputStyle: z.string().optional(),
  outputStyles: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        description: z.string().optional(),
      }),
    )
    .optional(),
  profile: z
    .object({
      title: z.string().optional(),
      language: z.string().optional(),
      experienceLevel: z.string().optional(),
    })
    .optional(),
  shell: z
    .object({
      command: z.string().optional(),
      effective: z.string().optional(),
      source: z.string().optional(),
    })
    .optional(),
  worktree: z
    .object({
      newTaskDefault: z.enum(["worktree", "branch", "direct", "ask"]).optional(),
      branchPrefix: z.string().optional(),
      sizeWarnBytes: z.number().optional(),
      autoCleanup: z.boolean().optional(),
    })
    .optional(),
  skills: z
    .object({
      disabled: z.array(z.string()),
      items: z.array(
        z.object({
          name: z.string(),
          description: z.string().optional(),
          disabled: z.boolean().optional(),
        }),
      ),
    })
    .optional(),
  hooks: z
    .object({
      rules: z.array(
        z.object({
          index: z.number(),
          revision: z.string().optional(),
          event: z.string(),
          matcher: z.string().optional(),
          command: z.string(),
          enabled: z.boolean(),
        }),
      ),
    })
    .optional(),
  agentDefinition: agentDefinitionSchema.nullable().optional(),
  models: z.array(
    z.object({
      id: z.string(),
      provider: z.string(),
      label: z.string(),
      effortOptions: z.array(z.object({ id: z.string(), label: z.string() })),
      fastCapable: z.boolean(),
    }),
  ),
  agents: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      description: z.string().optional(),
      body: z.string().optional(),
      custom: z.boolean().optional(),
      userOverride: z.boolean().optional(),
      locked: z.boolean().optional(),
      disabled: z.boolean(),
      route,
    }),
  ),
  workflows: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      body: z.string().optional(),
      source: z.string().optional(),
      userOverride: z.boolean().optional(),
      active: z.boolean(),
    }),
  ),
  workflowPack: workflowPackSchema.nullable().optional(),
  orchestration: z
    .enum(["none", "focused", "balanced", "swarm"])
    .transform((mode) => (mode === "none" ? "none" : "swarm")),
  compaction: z.object({
    auto: z.boolean(),
    onModelChange: z.boolean().optional(),
    mainBufferPercent: z.number().optional(),
    mainBufferRatio: z.number().optional(),
    mainBufferTokens: z.number().optional(),
    summaryModel: z.string().optional(),
    memoryTimeoutMs: z.number().optional(),
  }),
  autoClear: z
    .object({
      enabled: z.boolean(),
      idleMs: z.number(),
      idleMinutes: z.number().optional(),
      custom: z.boolean().optional(),
      providerCustom: z.boolean().optional(),
      providerDefault: z.number().optional(),
      provider: z.string().nullable().optional(),
      providerDefaults: z
        .array(
          z.object({
            provider: z.string(),
            label: z.string().optional(),
            idleMs: z.number(),
            custom: z.boolean().optional(),
          }),
        )
        .optional(),
      minContextPercent: z.number(),
    })
    .optional(),
  sessions: z.array(
    z.object({
      id: z.string(),
      model: z.string().optional(),
      state: z.string().optional(),
      compaction: z.object({ auto: z.boolean() }).optional(),
      context: z.record(z.string(), z.number()).optional(),
    }),
  ),
});

export type EngineSnapshot = z.infer<typeof engineSnapshotSchema>;
export type WorkflowPack = z.infer<typeof workflowPackSchema>;
export type AgentDefinition = z.infer<typeof agentDefinitionSchema>;
export type FallbackRoute = z.infer<typeof fallbackRouteSchema>;
export type RoutePatch = {
  provider?: string;
  model?: string;
  effort?: string | null;
  fast?: boolean;
  autoEffort?: boolean;
  disabled?: boolean;
  contextPercent?: number | null;
  contextTokens?: number | null;
  fallbacks?: FallbackRoute[];
};
export type EngineCommand =
  | { action: "read"; refresh?: boolean; workflowId?: string }
  | { action: "main"; route: RoutePatch }
  | { action: "agent"; agent: string; route: RoutePatch }
  | { action: "agentDefinition"; agent: string }
  | {
      action: "agentSave";
      expectedRevision: string;
      agent?: string;
      name?: string;
      description?: string;
      body: string;
      route?: RoutePatch;
    }
  | {
      action: "agentCreate";
      agent?: string;
      name: string;
      description?: string;
      body: string;
      route?: RoutePatch;
    }
  | { action: "agentDelete"; agent: string }
  | {
      action: "instructionFiles";
      enabled?: boolean;
      instructionMode?: "all" | "agents" | "claude" | "off";
    }
  | { action: "workflow"; workflow: string }
  | { action: "workflowPack"; workflow: string }
  | {
      action: "workflowSave";
      workflow: string;
      name?: string;
      description?: string;
      body: string;
      activate?: boolean;
    }
  | {
      action: "workflowCreate";
      workflow: string;
      name?: string;
      description?: string;
      body?: string;
      activate?: boolean;
    }
  | { action: "workflowDelete"; workflow: string }
  | { action: "orchestration"; mode: EngineSnapshot["orchestration"] }
  | {
      action: "compaction";
      enabled?: boolean;
      onModelChange?: boolean;
      mainBufferPercent?: number;
      mainBufferTokens?: number;
      summaryModel?: string;
      memoryTimeoutMs?: number;
    }
  | {
      action: "autoClear";
      enabled?: boolean;
      idleMs?: number | null;
      reset?: boolean;
      provider?: string;
      resetProvider?: boolean;
      minContextPercent?: number;
    }
  | {
      action: "features";
      recap?: boolean;
      memoryTools?: boolean;
      webSearch?: boolean;
      builtinTool?: string;
      enabled?: boolean;
      installFeature?: string;
      webSearchRoute?: {
        inherited?: boolean;
        provider?: string;
        model?: string;
        effort?: string | null;
      };
    }
  | {
      action: "preferences";
      outputStyle?: string;
      profile?: {
        title?: string;
        language?: string;
        experienceLevel?: string;
      };
      aiSessionTitles?: boolean;
      shellCommand?: string;
      worktree?: {
        newTaskDefault?: "worktree" | "branch" | "direct" | "ask";
        branchPrefix?: string;
        sizeWarnBytes?: number;
        autoCleanup?: boolean;
      };
      disabledSkills?: string[];
      hookAction?: "add" | "toggle" | "delete";
      hookIndex?: number;
      hookRevision?: string;
      enabled?: boolean;
      hookRule?: {
        event: string;
        matcher?: string;
        command: string;
      };
    };

// 기본 모델과 역할별 모델의 저장 대상을 명확하게 구분한다.
export function routeCommand(agent: string | null, patch: RoutePatch): EngineCommand {
  return agent ? { action: "agent", agent, route: patch } : { action: "main", route: patch };
}

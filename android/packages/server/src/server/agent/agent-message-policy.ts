import type * as FileSystem from "node:fs/promises";

interface PolicyDependencies {
  fs: Pick<typeof FileSystem, "readFile" | "writeFile" | "mkdir" | "mkdtemp" | "rename" | "rm">;
  join: (...paths: string[]) => string;
  isAbsolute: (path: string) => boolean;
  home: string | undefined;
}

interface AgentRecord {
  labels?: Record<string, unknown>;
}

interface AgentLookup {
  getAgent: (id: string) => AgentRecord | null | undefined;
}

interface AgentStorageLookup {
  get: (id: string) => Promise<AgentRecord | null | undefined>;
}

// 공유 서버·고정 서버 패치·설정 RPC가 같은 저장 형식과 허용 규칙을 사용한다.
export function createAgentMessagePolicy({ fs, join, isAbsolute, home }: PolicyDependencies) {
  const parentLabel = "paseo.parent-agent-id";

  function policyPath(): string {
    if (!home || !isAbsolute(home)) throw new Error("PaseoDog message policy requires PASEO_HOME");
    return join(home, "paseodog-message-policy.json");
  }

  function validate(value: unknown): { allowUnrelatedSessions: boolean } {
    if (
      !value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== 1 ||
      typeof (value as { allowUnrelatedSessions?: unknown }).allowUnrelatedSessions !== "boolean"
    ) {
      throw new Error("Invalid PaseoDog message policy");
    }
    return { allowUnrelatedSessions: (value as { allowUnrelatedSessions: boolean }).allowUnrelatedSessions };
  }

  async function read() {
    const path = policyPath();
    try {
      return validate(JSON.parse(await fs.readFile(path, "utf8")));
    } catch (error) {
      // 미설정 호스트는 기존 동작을 유지한다. 손상·권한 오류는 허용으로 바꾸지 않는다.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { allowUnrelatedSessions: true };
      throw error;
    }
  }

  async function write(value: unknown) {
    const next = validate(value);
    const path = policyPath();
    await fs.mkdir(home!, { recursive: true, mode: 0o700 });
    const temporary = await fs.mkdtemp(join(home!, ".paseodog-message-policy-"));
    try {
      const staged = join(temporary, "policy.json");
      await fs.writeFile(staged, `${JSON.stringify(next)}\n`, { mode: 0o600, flag: "wx" });
      await fs.rename(staged, path);
      return next;
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }

  async function authorize(
    callerAgentId: string | undefined,
    targetAgentId: string,
    manager: AgentLookup,
    storage: AgentStorageLookup,
  ) {
    // 사용자 입력과 자기 세션은 제한하지 않는다. 엔진 내부 오케스트레이터도 이 경로와 별개다.
    if (!callerAgentId || callerAgentId === targetAgentId) return;
    if ((await read()).allowUnrelatedSessions) return;
    const [caller, target] = await Promise.all([
      manager.getAgent(callerAgentId) ?? storage.get(callerAgentId),
      manager.getAgent(targetAgentId) ?? storage.get(targetAgentId),
    ]);
    if (
      caller && target &&
      (caller.labels?.[parentLabel] === targetAgentId || target.labels?.[parentLabel] === callerAgentId)
    ) return;
    throw new Error("Unrelated session messages are disabled on this host; parent-child messages remain allowed");
  }

  function assertLabelUpdate(callerAgentId: string | undefined, labels?: Record<string, string>) {
    // MCP 송신자가 라벨 수정으로 예외 관계를 위조하지 못하게 한다.
    if (callerAgentId && labels && Object.hasOwn(labels, parentLabel)) {
      throw new Error("Agent parent relationship is assigned by the server at creation");
    }
  }

  return { read, write, authorize, assertLabelUpdate };
}

import type * as Crypto from "node:crypto";

interface IdentityDependencies {
  crypto: Pick<typeof Crypto, "createHmac" | "timingSafeEqual">;
  secret: string;
}

interface IdentityRequest {
  token: string | null;
  requestedCaller: unknown;
  verifyPassword: (token: string) => Promise<boolean>;
}

type IdentityResult =
  | { authorized: false }
  | { authorized: true; callerAgentId?: string };

// 루트 키는 데몬 안에만 두고, 에이전트에는 자기 ID에 한정된 서명 토큰만 전달한다.
export function createAgentMcpIdentity({ crypto, secret }: IdentityDependencies) {
  if (!secret) throw new Error("Agent MCP signing key required");
  const prefix = "paseodog-agent-v1";

  function same(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  function mint(agentId: string): string {
    if (!agentId) throw new Error("Agent MCP identity required");
    const identity = Buffer.from(agentId, "utf8").toString("base64url");
    const payload = `${prefix}.${identity}`;
    const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    return `${payload}.${signature}`;
  }

  async function resolve({
    token,
    requestedCaller,
    verifyPassword,
  }: IdentityRequest): Promise<IdentityResult> {
    if (!token) return { authorized: false };
    if (token.startsWith(`${prefix}.`)) {
      const parts = token.split(".");
      if (parts.length === 3) {
        const agentId = Buffer.from(parts[1]!, "base64url").toString("utf8");
        if (agentId && same(token, mint(agentId))) {
          if (requestedCaller !== undefined && requestedCaller !== agentId) return { authorized: false };
          return { authorized: true, callerAgentId: agentId };
        }
      }
    }
    // 신원 없는 HTTP 호출을 사용자로 간주하지 않는다. 소유자는 루트 키나 비밀번호로 인증한다.
    if (requestedCaller !== undefined) return { authorized: false };
    if (same(token, secret) || await verifyPassword(token)) return { authorized: true };
    return { authorized: false };
  }

  return { mint, resolve };
}

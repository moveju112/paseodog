import { compare } from "bcryptjs";
import type { WSHelloMessage } from "@getpaseo/protocol/messages";
import { OWNER_PERMISSIONS } from "./authorization/index.js";
import { matchesLocalCredential } from "./local-credential.js";
import type { SessionAdmission } from "./websocket-server.js";

export type AdmissionFailure = "password_required" | "incorrect_password";

type AdmissionResolution = { admission: SessionAdmission } | { rejection: AdmissionFailure };

// 릴레이 암호 대입 제한: 10분 안의 실패·진행 중 비교가 10회면 비교 없이 거부한다(데몬 재시작 시 초기화).
const RELAY_ATTEMPT_WINDOW_MS = 10 * 60_000;
const RELAY_ATTEMPT_LIMIT = 10;
let relayAttempts: Array<{ time: number }> = [];

export async function resolveSessionAdmission(input: {
  credential: WSHelloMessage["auth"];
  passwordHash: string | undefined;
  relayPasswordHash?: string;
  localCredential: string | null;
  transport: "direct" | "relay";
}): Promise<AdmissionResolution> {
  const { credential, passwordHash, localCredential, transport } = input;
  if (transport === "relay") {
    if (!input.relayPasswordHash || !credential) return { rejection: "password_required" };
    if (credential.kind !== "password" || Buffer.byteLength(credential.password, "utf8") > 72) {
      return { rejection: "incorrect_password" };
    }
    const now = Date.now();
    relayAttempts = relayAttempts.filter((entry) => now - entry.time < RELAY_ATTEMPT_WINDOW_MS);
    if (relayAttempts.length >= RELAY_ATTEMPT_LIMIT) return { rejection: "incorrect_password" };
    // 비교 전에 기록해 동시 접속으로 제한을 넘지 못하게 하고, 성공한 시도만 지운다.
    const attempt = { time: now };
    relayAttempts.push(attempt);
    if (!(await compare(credential.password, input.relayPasswordHash))) {
      return { rejection: "incorrect_password" };
    }
    relayAttempts = relayAttempts.filter((entry) => entry !== attempt);
    return { admission: { principalId: "owner", permissions: OWNER_PERMISSIONS } };
  }
  if (!passwordHash) {
    return { admission: { principalId: "owner", permissions: OWNER_PERMISSIONS } };
  }
  if (!credential) {
    return { rejection: "password_required" };
  }
  if (credential.kind === "localCredential") {
    if (localCredential && matchesLocalCredential(localCredential, credential.token)) {
      return { admission: { principalId: "owner", permissions: OWNER_PERMISSIONS } };
    }
    return { rejection: "incorrect_password" };
  }
  return (await compare(credential.password, passwordHash))
    ? { admission: { principalId: "owner", permissions: OWNER_PERMISSIONS } }
    : { rejection: "incorrect_password" };
}

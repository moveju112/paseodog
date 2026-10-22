import { compare } from "bcryptjs";
import type { WSHelloMessage } from "@getpaseo/protocol/messages";
import { OWNER_PERMISSIONS } from "./authorization/index.js";
import { matchesLocalCredential } from "./local-credential.js";
import type { SessionAdmission } from "./websocket-server.js";

export type AdmissionFailure = "password_required" | "incorrect_password";

type AdmissionResolution = { admission: SessionAdmission } | { rejection: AdmissionFailure };

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
    return (await compare(credential.password, input.relayPasswordHash))
      ? { admission: { principalId: "owner", permissions: OWNER_PERMISSIONS } }
      : { rejection: "incorrect_password" };
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

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compare } from "bcryptjs";
import { hashDaemonPassword } from "./auth.js";
import { loadOrCreateDaemonKeyPair } from "./daemon-keypair.js";
import { ensurePrivateDirectory, writePrivateFileAtomicSync } from "./private-files.js";

// 입력 암호 검사 (bcrypt 72바이트 한도, 새 암호는 8자 이상)
function validateRelayPassword(password: string, isNew: boolean): void {
  if (!password || Buffer.byteLength(password, "utf8") > 72) {
    throw new Error("Relay password must contain 1–72 UTF-8 bytes");
  }
  // 새 암호만 온라인 대입을 버티도록 8자 이상을 요구하고 기존 암호 확인은 그대로 둔다.
  if (isNew && Array.from(password).length < 8) {
    throw new Error("New relay password must contain at least 8 characters");
  }
}

// 잊은 암호 재설정 (새 암호 해시 저장 -> 데몬 키 교체로 기존 주소 무효화, 재시작 후 적용)
export async function resetRelayAccess(home: string, password: string): Promise<void> {
  validateRelayPassword(password, true);
  // Hub 등록은 데몬 공개키에 묶여 있어 키를 바꾸면 끊기므로 먼저 해제하게 한다.
  if (existsSync(join(home, "hub-relationship.json"))) {
    throw new Error("Disconnect Paseo Hub before resetting relay access");
  }
  writePrivateFileAtomicSync(join(home, "relay-password"), `${hashDaemonPassword(password)}\n`);
  rmSync(join(home, "daemon-keypair.json"), { force: true });
  await loadOrCreateDaemonKeyPair(home);
}

// 릴레이 전용 해시를 읽고 파일 손상·권한 오류는 인증 실패로 전달한다.
export function readRelayPasswordHash(home: string): string | undefined {
  try {
    const hash = readFileSync(join(home, "relay-password"), "utf8").trim();
    if (!/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/.test(hash)) {
      throw new Error("Invalid relay password file");
    }
    return hash;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

// 첫 발급은 해시만 저장하고 재발급은 기존 암호를 확인하며 덮어쓰지 않는다.
export async function requireRelayPassword(home: string, password: string): Promise<void> {
  validateRelayPassword(password, false);
  let hash = readRelayPasswordHash(home);
  if (!hash) {
    validateRelayPassword(password, true);
    ensurePrivateDirectory(home);
    const created = hashDaemonPassword(password);
    try {
      writeFileSync(join(home, "relay-password"), `${created}\n`, { flag: "wx", mode: 0o600 });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      hash = readRelayPasswordHash(home);
    }
  }
  if (!hash || !(await compare(password, hash))) {
    throw new Error("Incorrect relay password");
  }
}

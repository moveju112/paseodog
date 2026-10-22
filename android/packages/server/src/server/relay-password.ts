import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compare } from "bcryptjs";
import { hashDaemonPassword } from "./auth.js";
import { ensurePrivateDirectory } from "./private-files.js";

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
  if (!password || Buffer.byteLength(password, "utf8") > 72) {
    throw new Error("Relay password must contain 1–72 UTF-8 bytes");
  }
  let hash = readRelayPasswordHash(home);
  if (!hash) {
    // 새 암호만 온라인 대입을 버티도록 8자 이상을 요구하고 기존 암호 확인은 그대로 둔다.
    if (Array.from(password).length < 8) {
      throw new Error("New relay password must contain at least 8 characters");
    }
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

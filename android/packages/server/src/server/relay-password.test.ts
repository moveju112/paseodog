import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { compare } from "bcryptjs";
import {
  readRelayPasswordHash,
  resetRelayAccess,
  verifyRelayLoginPassword,
} from "./relay-password.js";

vi.mock("bcryptjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("bcryptjs")>();
  return { ...actual, compare: vi.fn(actual.compare) };
});

const PASSWORD_HASH = "$2b$12$OLxyuuP9uLK30Uzc4wQX0O6liuU/Q1t5P2b0Ebf36mULvpVK3DRZW";
let home: string;
const compareMock = vi.mocked(compare);

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "paseo-relay-login-"));
  writeFileSync(join(home, "relay-password"), `${PASSWORD_HASH}\n`, { mode: 0o600 });
  compareMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(home, { recursive: true, force: true });
});

function login(password = "correct-password") {
  return verifyRelayLoginPassword(home, password, PASSWORD_HASH);
}

describe("persistent relay login security", () => {
  test("only five guesses reach bcrypt, with no clock-based or module-reload unlock", async () => {
    for (let attempt = 0; attempt < 5; attempt++) expect(await login("wrong")).toBe(false);
    expect(compareMock).toHaveBeenCalledTimes(5);
    expect(await login()).toBe(false);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2100-01-01T00:00:00Z"));
    vi.resetModules();
    const restarted = await import("./relay-password.js");
    expect(await restarted.verifyRelayLoginPassword(home, "correct-password", PASSWORD_HASH)).toBe(
      false,
    );
    expect(compareMock).toHaveBeenCalledTimes(5);
  });

  test("a valid fifth attempt clears the consecutive failure count", async () => {
    for (let cycle = 0; cycle < 2; cycle++) {
      for (let attempt = 0; attempt < 4; attempt++) expect(await login("wrong")).toBe(false);
      expect(await login()).toBe(true);
      expect(readFileSync(join(home, "relay-login-failures"), "utf8")).toBe("0\n");
    }
  });

  test("parallel guesses are rejected without queued bcrypt work or additional reservations", async () => {
    let finish!: (value: boolean) => void;
    compareMock.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = login("wrong");
    expect(readFileSync(join(home, "relay-login-failures"), "utf8")).toBe("1\n");
    const results = await Promise.all(Array.from({ length: 100 }, () => login()));
    expect(results).toEqual(Array(100).fill(false));
    expect(compareMock).toHaveBeenCalledTimes(1);
    finish(false);
    expect(await pending).toBe(false);
    expect(await login()).toBe(true);
  });

  test("empty and overlong UTF-8 passwords count as failures without bcrypt truncation", async () => {
    for (const password of ["", "x".repeat(73), "가".repeat(25), "", "x".repeat(73)]) {
      expect(await login(password)).toBe(false);
    }
    expect(await login()).toBe(false);
    expect(compareMock).not.toHaveBeenCalled();
  });

  test("corrupt or unwritable state fails closed before password comparison", async () => {
    const file = join(home, "relay-login-failures");
    for (const value of ["", "-1", "6", "1.5", "NaN", "{}"]) {
      writeFileSync(file, value);
      await expect(login()).rejects.toThrow("Invalid relay login failure state");
    }
    rmSync(file);
    mkdirSync(file);
    await expect(login()).rejects.toThrow();
    expect(compareMock).not.toHaveBeenCalled();
  });

  test("comparison errors consume the reserved attempt and release the in-flight guard", async () => {
    compareMock.mockRejectedValueOnce(new Error("comparison failed"));
    await expect(login()).rejects.toThrow("comparison failed");
    expect(readFileSync(join(home, "relay-login-failures"), "utf8")).toBe("1\n");
    expect(await login()).toBe(true);
  });

  test("a reset invalidates in-flight old passwords without erasing the new generation's state", async () => {
    let finish!: (value: boolean) => void;
    compareMock.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = login();
    await resetRelayAccess(home, "replacement-password");
    writeFileSync(join(home, "relay-login-failures"), "3\n", { mode: 0o600 });
    finish(true);
    expect(await pending).toBe(false);
    expect(readFileSync(join(home, "relay-login-failures"), "utf8")).toBe("3\n");
    expect(
      await verifyRelayLoginPassword(home, "replacement-password", readRelayPasswordHash(home)!),
    ).toBe(true);
  });

  test("invalid or Hub-blocked resets do not unlock; a completed reset recovers corrupt state", async () => {
    const file = join(home, "relay-login-failures");
    writeFileSync(file, "5\n", { mode: 0o600 });
    await expect(resetRelayAccess(home, "short")).rejects.toThrow("at least 8 characters");
    expect(await login()).toBe(false);
    writeFileSync(join(home, "hub-relationship.json"), "{}");
    await expect(resetRelayAccess(home, "replacement-password")).rejects.toThrow(
      "Disconnect Paseo Hub",
    );
    expect(await login()).toBe(false);
    rmSync(join(home, "hub-relationship.json"));
    writeFileSync(file, "corrupt");
    await resetRelayAccess(home, "replacement-password");
    expect(
      await verifyRelayLoginPassword(home, "replacement-password", readRelayPasswordHash(home)!),
    ).toBe(true);
  });

  test("one daemon's lockout does not block a different private home", async () => {
    writeFileSync(join(home, "relay-login-failures"), "5\n", { mode: 0o600 });
    const other = join(home, "other");
    mkdirSync(other, { mode: 0o700 });
    writeFileSync(join(other, "relay-password"), `${PASSWORD_HASH}\n`, { mode: 0o600 });
    expect(await login()).toBe(false);
    expect(await verifyRelayLoginPassword(other, "correct-password", PASSWORD_HASH)).toBe(true);
  });
});

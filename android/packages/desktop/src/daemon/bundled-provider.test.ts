import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareBundledProvider } from "./bundled-provider";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

// 실제 복사 경로를 쓰되 프로필 실행만 가짜로 바꾼 독립 첫 실행 환경을 만든다.
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "paseodog-bundle-"));
  roots.push(root);
  const stateRoot = path.join(root, "state");
  const home = path.join(stateRoot, "paseo");
  const resourcesPath = path.join(root, "resources");
  await mkdir(home, { recursive: true });
  await mkdir(path.join(resourcesPath, "paseodog-runtime", "scripts"), { recursive: true });
  await writeFile(
    path.join(resourcesPath, "paseodog-runtime", "scripts", "desktop-profile.mjs"),
    "// fixture",
  );
  const input = {
    home,
    stateRoot,
    resourcesPath,
    version: "1.0.0-rc.7.11052",
    execPath: "/app/electron",
    confirmTrust: vi.fn(async () => true),
    runSetup: vi.fn(async (entry: string) => {
      const runtime = path.dirname(path.dirname(entry));
      await writeFile(
        path.join(home, "config.json"),
        JSON.stringify({
          agents: {
            providers: {
              paseodog: {
                command: [
                  input.execPath,
                  path.join(runtime, "engine", "bin", "paseodog-engine.mjs"),
                ],
              },
            },
          },
          plugins: { "paseodog-provider": { path: path.join(runtime, "plugin") } },
        }),
      );
    }),
  };
  return input;
}

describe("bundled provider", () => {
  it("requires trust, copies outside the AppImage mount, and does not repeat setup", async () => {
    const input = await fixture();
    const result = await prepareBundledProvider(input);
    expect(result?.changed).toBe(true);
    expect(result?.needsInstall).toBe(true);
    expect(result?.pluginPath).toBe(
      path.join(input.stateRoot, "desktop-runtimes", input.version, "plugin"),
    );
    expect(input.confirmTrust).toHaveBeenCalledOnce();
    const next = await prepareBundledProvider(input);
    expect(next?.changed).toBe(false);
    expect(next?.needsInstall).toBe(false);
    expect(input.runSetup).toHaveBeenCalledOnce();
    expect(input.confirmTrust).toHaveBeenCalledOnce();
    // AppImage가 재마운트되어 Electron 실행 경로가 바뀌면 명령만 다시 설정한다.
    input.execPath = "/new-mount/electron";
    expect((await prepareBundledProvider(input))?.changed).toBe(true);
    expect(input.runSetup).toHaveBeenCalledTimes(2);
    expect(input.confirmTrust).toHaveBeenCalledOnce();
  });

  it("preserves external installations, disabled providers, and non-dedicated profiles byte for byte", async () => {
    const input = await fixture();
    for (const profile of [
      { agents: { providers: { paseodog: { command: ["node", "/checkout/engine.mjs"] } } } },
      { plugins: { "paseodog-provider": { path: "/checkout/plugin" } } },
      { agents: { providers: { paseodog: { enabled: false } } } },
      { plugins: { "paseodog-provider": { enabled: false } } },
    ]) {
      const before = JSON.stringify(profile);
      await writeFile(path.join(input.home, "config.json"), before);
      expect(await prepareBundledProvider(input)).toBeNull();
      expect(await readFile(path.join(input.home, "config.json"), "utf8")).toBe(before);
    }
    expect(
      await prepareBundledProvider({ ...input, home: path.join(input.stateRoot, ".paseo") }),
    ).toBeNull();
    expect(input.runSetup).not.toHaveBeenCalled();
    expect(input.confirmTrust).not.toHaveBeenCalled();
  });

  it("leaves a cancelled first run unchanged and reports corrupt config", async () => {
    const input = await fixture();
    input.confirmTrust.mockResolvedValue(false);
    await expect(prepareBundledProvider(input)).rejects.toThrow("취소");
    expect(input.runSetup).not.toHaveBeenCalled();
    await writeFile(path.join(input.home, "config.json"), "broken");
    await expect(prepareBundledProvider(input)).rejects.toThrow();
    expect(await readFile(path.join(input.home, "config.json"), "utf8")).toBe("broken");
  });

  it("moves a managed installation to the new version without asking for trust again", async () => {
    const input = await fixture();
    await prepareBundledProvider(input);
    input.version = "1.0.0-rc.7.11053";
    const result = await prepareBundledProvider(input);
    expect(result?.changed).toBe(true);
    expect(result?.needsInstall).toBe(true);
    expect(result?.pluginPath).toContain(input.version);
    expect(input.confirmTrust).toHaveBeenCalledOnce();
  });
});

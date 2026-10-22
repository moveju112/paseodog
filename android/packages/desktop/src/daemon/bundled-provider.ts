import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

interface BundledProfile {
  agents?: { providers?: Record<string, { command?: string[]; enabled?: boolean }> };
  plugins?: Record<string, { path?: string; enabled?: boolean }>;
}

interface PrepareBundledProviderInput {
  home: string;
  stateRoot: string;
  resourcesPath: string;
  version: string;
  execPath: string;
  confirmTrust: () => Promise<boolean>;
  runSetup: (entry: string) => Promise<void>;
}

// 없는 설정만 빈 값으로 취급하고 손상·권한 오류는 그대로 중단한다.
async function readProfile(file: string): Promise<BundledProfile> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as BundledProfile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

// 꺼 둔 공급자와 내장 런타임 경로 바깥의 수동 등록은 갱신 대상에서 제외한다.
function usesExternalProvider(profile: BundledProfile, runtimes: string): boolean {
  const provider = profile.agents?.providers?.paseodog;
  const plugin = profile.plugins?.["paseodog-provider"];
  const owns = (file?: string) => Boolean(file?.startsWith(runtimes + path.sep));
  return Boolean(
    provider?.enabled === false ||
    plugin?.enabled === false ||
    (provider && !owns(provider.command?.[1])) ||
    (plugin && !owns(plugin.path)),
  );
}

// 기존 외부 등록은 보존하고 내장 런타임만 버전별 고정 경로로 복사·설정한다.
export async function prepareBundledProvider(input: PrepareBundledProviderInput): Promise<{
  pluginPath: string;
  changed: boolean;
  needsInstall: boolean;
} | null> {
  if (path.resolve(input.home) !== path.join(input.stateRoot, "paseo")) return null;
  const profile = await readProfile(path.join(input.home, "config.json"));
  const provider = profile.agents?.providers?.paseodog;
  const plugin = profile.plugins?.["paseodog-provider"];
  const runtimes = path.join(input.stateRoot, "desktop-runtimes");
  if (usesExternalProvider(profile, runtimes)) return null;
  if (!provider && !(await input.confirmTrust()))
    throw new Error(
      "PaseoDog 초기 설정을 취소했어요. 로컬 호스트를 시작하면 다시 설정할 수 있어요.",
    );

  if (!/^[A-Za-z0-9._-]+$/.test(input.version)) throw new Error("Invalid runtime version");
  const destination = path.join(runtimes, input.version);
  const marker = path.join(destination, ".complete");
  let ready = false;
  try {
    ready = (await readFile(marker, "utf8")) === input.version;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (!ready) {
    await mkdir(runtimes, { recursive: true, mode: 0o700 });
    const staging = await mkdtemp(path.join(runtimes, ".prepare-"));
    try {
      await cp(path.join(input.resourcesPath, "paseodog-runtime"), staging, { recursive: true });
      await writeFile(path.join(staging, ".complete"), input.version, { mode: 0o600 });
      await rename(staging, destination);
    } catch (error) {
      await rm(staging, { recursive: true });
      throw error;
    }
  }
  const engine = path.join(destination, "engine", "bin", "paseodog-engine.mjs");
  const changed = provider?.command?.[0] !== input.execPath || provider?.command?.[1] !== engine;
  if (changed) await input.runSetup(path.join(destination, "scripts", "desktop-profile.mjs"));
  const pluginPath = path.join(destination, "plugin");
  return { pluginPath, changed, needsInstall: plugin?.path !== pluginPath };
}

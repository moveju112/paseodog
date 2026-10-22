import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface DesktopStartupDependencies {
  hasPendingGuiLaunchRequest: boolean;
  runCliPassthroughIfRequested: () => Promise<boolean>;
  inheritLoginShellEnv: () => void;
  bootstrapGui: () => Promise<void>;
}

// 래퍼와 같은 전용 데이터 경로를 OS별로 선택한다.
export function resolveDesktopStateRoot(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  userHome = homedir(),
): string {
  return resolve(
    env.PASEODOG_HOME ||
      (platform === "win32"
        ? join(env.LOCALAPPDATA || join(userHome, "AppData", "Local"), "paseodog")
        : join(userHome, ".local", "share", "paseodog")),
  );
}

export async function runDesktopStartup(deps: DesktopStartupDependencies): Promise<void> {
  // Keep the launch-time profile across GUI shell inheritance and bundled CLI calls.
  const stateRoot = resolveDesktopStateRoot();
  const paseoHome = process.env.PASEO_HOME || join(stateRoot, "paseo");
  process.env.PASEO_HOME = paseoHome;

  if (!deps.hasPendingGuiLaunchRequest && (await deps.runCliPassthroughIfRequested())) {
    return;
  }

  deps.inheritLoginShellEnv();
  process.env.PASEODOG_HOME = stateRoot;
  process.env.PASEO_HOME = paseoHome;
  await deps.bootstrapGui();
}

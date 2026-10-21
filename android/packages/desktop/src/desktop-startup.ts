import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface DesktopStartupDependencies {
  hasPendingGuiLaunchRequest: boolean;
  runCliPassthroughIfRequested: () => Promise<boolean>;
  inheritLoginShellEnv: () => void;
  bootstrapGui: () => Promise<void>;
}

export async function runDesktopStartup(deps: DesktopStartupDependencies): Promise<void> {
  // Keep the launch-time profile across GUI shell inheritance and bundled CLI calls.
  const stateRoot = resolve(
    process.env.PASEODOG_HOME || join(homedir(), ".local", "share", "paseodog"),
  );
  const paseoHome = process.env.PASEO_HOME || join(stateRoot, "paseo");
  process.env.PASEO_HOME = paseoHome;

  if (!deps.hasPendingGuiLaunchRequest && (await deps.runCliPassthroughIfRequested())) {
    return;
  }

  deps.inheritLoginShellEnv();
  process.env.PASEO_HOME = paseoHome;
  await deps.bootstrapGui();
}

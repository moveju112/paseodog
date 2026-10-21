import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDesktopStartup } from "./desktop-startup";

beforeEach(() => {
  vi.stubEnv("PASEO_HOME", undefined);
  vi.stubEnv("PASEODOG_HOME", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("desktop startup", () => {
  it("runs CLI passthrough before GUI login-shell env inheritance", async () => {
    const calls: string[] = [];
    await runDesktopStartup({
      hasPendingGuiLaunchRequest: false,
      runCliPassthroughIfRequested: vi.fn(async () => {
        calls.push("cli");
        expect(process.env.PASEO_HOME).toBe(
          join(homedir(), ".local", "share", "paseodog", "paseo"),
        );
        return true;
      }),
      inheritLoginShellEnv: vi.fn(() => calls.push("env")),
      bootstrapGui: vi.fn(async () => {
        calls.push("gui");
        expect(process.env.PASEO_HOME).toBe(
          join(homedir(), ".local", "share", "paseodog", "paseo"),
        );
      }),
    });

    expect(calls).toEqual(["cli"]);
  });

  it("keeps login-shell env inheritance on normal GUI startup", async () => {
    const calls: string[] = [];
    await runDesktopStartup({
      hasPendingGuiLaunchRequest: false,
      runCliPassthroughIfRequested: vi.fn(async () => {
        calls.push("cli");
        return false;
      }),
      inheritLoginShellEnv: vi.fn(() => calls.push("env")),
      bootstrapGui: vi.fn(async () => {
        calls.push("gui");
      }),
    });

    expect(calls).toEqual(["cli", "env", "gui"]);
  });

  it("does not route open-project launches through CLI passthrough", async () => {
    const runCliPassthroughIfRequested = vi.fn(async () => true);
    const calls: string[] = [];

    await runDesktopStartup({
      hasPendingGuiLaunchRequest: true,
      runCliPassthroughIfRequested,
      inheritLoginShellEnv: vi.fn(() => calls.push("env")),
      bootstrapGui: vi.fn(async () => {
        calls.push("gui");
      }),
    });

    expect(runCliPassthroughIfRequested).not.toHaveBeenCalled();
    expect(calls).toEqual(["env", "gui"]);
  });

  it("uses the dedicated profile even when the login shell selects stock Paseo", async () => {
    await runDesktopStartup({
      hasPendingGuiLaunchRequest: true,
      runCliPassthroughIfRequested: vi.fn(),
      inheritLoginShellEnv: () => {
        process.env.PASEO_HOME = join(homedir(), ".paseo");
      },
      bootstrapGui: async () => {
        expect(process.env.PASEO_HOME).toBe(
          join(homedir(), ".local", "share", "paseodog", "paseo"),
        );
      },
    });
  });

  it("preserves an explicitly selected profile across login-shell inheritance", async () => {
    const explicitHome = join(homedir(), "custom-paseo");
    vi.stubEnv("PASEO_HOME", explicitHome);
    vi.stubEnv("PASEODOG_HOME", join(homedir(), "other-paseodog"));

    await runDesktopStartup({
      hasPendingGuiLaunchRequest: false,
      runCliPassthroughIfRequested: async () => {
        expect(process.env.PASEO_HOME).toBe(explicitHome);
        return false;
      },
      inheritLoginShellEnv: () => {
        process.env.PASEO_HOME = join(homedir(), ".paseo");
      },
      bootstrapGui: async () => {
        expect(process.env.PASEO_HOME).toBe(explicitHome);
      },
    });
  });

  it.each(["custom-paseodog", join(homedir(), "custom-paseodog")])(
    "resolves PASEODOG_HOME %s with the same layout as the wrapper",
    async (stateRoot) => {
      vi.stubEnv("PASEODOG_HOME", stateRoot);
      await runDesktopStartup({
        hasPendingGuiLaunchRequest: true,
        runCliPassthroughIfRequested: vi.fn(),
        inheritLoginShellEnv: vi.fn(),
        bootstrapGui: async () => {
          expect(process.env.PASEO_HOME).toBe(join(resolve(stateRoot), "paseo"));
        },
      });
    },
  );
});

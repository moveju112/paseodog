import { confirm, isCancel, log, password as passwordPrompt } from "@clack/prompts";
import { Command } from "commander";
import chalk from "chalk";
import { generateLocalPairingOffer } from "@getpaseo/server/pairing";
import { readDaemonInstance } from "@getpaseo/server/daemon-control";
import {
  readPersistedConfig,
  editPersistedConfig,
  resolveConfigFromPersisted,
} from "@getpaseo/server/configuration";
import { connectToDaemon } from "../../utils/client.js";
import type { DaemonTarget } from "../../utils/daemon-target.js";
import { addJsonAndDaemonHostOptions, withGlobalOptions } from "../../utils/command-options.js";
import { formatPairingInstructions } from "../../output/pairing.js";
import { parseConnectionOfferFromUrl } from "@getpaseo/protocol/connection-offer";
import { serializeRelayConnectionUri } from "@getpaseo/protocol/daemon-endpoints";

interface PairOptions {
  daemonTarget: DaemonTarget;
  home?: string;
  json?: boolean;
  relay?: boolean;
  resetPassword?: boolean;
}

export interface PairCommandOutput {
  columns: number | undefined;
  writeStdout(message: string): void;
  writeStderr(message: string): void;
  setExitCode(code: number): void;
  success(message: string): void;
}

export interface PairingOffer {
  relayEnabled: boolean;
  url: string | null;
  qr: string | null;
}

const PAIRING_DAEMON_RPC_TIMEOUT_MS = 1500;
// bcrypt 해시·비교와 재설정 키 교체가 느린 기기에서도 응답 전에 끊기지 않게 한다.
const PASSWORD_PAIRING_RPC_TIMEOUT_MS = 15_000;
const RELAY_DOCS_URL = "https://paseo.sh/docs/security";

function createProcessOutput(): PairCommandOutput {
  return {
    columns: process.stdout.columns,
    writeStdout(message) {
      process.stdout.write(message);
    },
    writeStderr(message) {
      process.stderr.write(message);
    },
    setExitCode(code) {
      process.exitCode = code;
    },
    success(message) {
      log.success(message);
    },
  };
}

export function pairCommand(): Command {
  return addJsonAndDaemonHostOptions(
    new Command("pair").description("Print the daemon pairing QR code and link"),
  )
    .option("--relay", "Enable relay without prompting")
    .option(
      "--reset-password",
      "Set a new relay password and invalidate every existing pairing link (restarts the daemon)",
    )
    .action(
      withGlobalOptions((options: PairOptions, _command: Command) => runPairCommand(options)),
    );
}

export async function resolveLocalPairingOffer(options: {
  paseoHome: string;
  enableRelay?: boolean;
  password?: string;
  reset?: boolean;
}): Promise<PairingOffer> {
  const instance = await readDaemonInstance(options.paseoHome);
  if (instance)
    return resolveDaemonPairingOffer(
      { kind: "instance", home: options.paseoHome },
      options.enableRelay,
      options.password,
      options.reset,
    );
  if (options.enableRelay)
    editPersistedConfig(options.paseoHome, "daemon.relay.enabled", { value: true });
  const config = resolveConfigFromPersisted(
    options.paseoHome,
    readPersistedConfig(options.paseoHome, { defaultsIfMissing: true }),
    { env: {} },
  );

  return generateLocalPairingOffer({
    paseoHome: options.paseoHome,
    relayEnabled: config.relayEnabled,
    password: options.password,
    reset: options.reset,
    relayEndpoint: config.relayEndpoint,
    relayPublicEndpoint: config.relayPublicEndpoint,
    relayUseTls: config.relayUseTls,
    relayPublicUseTls: config.relayPublicUseTls,
    appBaseUrl: config.appBaseUrl,
    includeQr: true,
  });
}

async function resolveDaemonPairingOffer(
  target: DaemonTarget,
  enableRelay: boolean | undefined,
  password: string | undefined,
  reset?: boolean,
): Promise<PairingOffer> {
  const offerTimeout =
    password === undefined ? PAIRING_DAEMON_RPC_TIMEOUT_MS : PASSWORD_PAIRING_RPC_TIMEOUT_MS;
  const client = await connectToDaemon({
    target,
    timeout: PAIRING_DAEMON_RPC_TIMEOUT_MS,
  });

  try {
    const serverInfo = client.getLastServerInfoMessage();
    if (serverInfo?.features?.daemonStatusRpc !== true) {
      throw new Error("Update the Paseo daemon before pairing from this command.");
    }
    if (password !== undefined && serverInfo.features.relayPasswordAuth !== true) {
      throw new Error("Update the PaseoDog daemon before password-protected relay pairing.");
    }

    let offer = await client.getDaemonPairingOffer({
      timeout: offerTimeout,
      password,
      reset,
    });
    if (!offer.relayEnabled && enableRelay) {
      if (serverInfo.features.relayConfig !== true) {
        throw new Error("Update the Paseo daemon before enabling relay from this command.");
      }
      await client.patchDaemonConfig({ relay: { enabled: true } });
      try {
        offer = await client.getDaemonPairingOffer({
          timeout: offerTimeout,
          password,
          reset,
        });
      } catch (error) {
        throw new Error(
          `Relay configuration was saved, but fetching the pairing offer failed: ${String(error)}`,
          { cause: error },
        );
      }
    }
    return {
      relayEnabled: offer.relayEnabled,
      url: offer.url || null,
      qr: offer.qr ?? null,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function confirmRelayPairing(): Promise<boolean> {
  log.message("Your connection is end-to-end encrypted. Paseo cannot read your code or messages.");
  log.message(`Learn how it works: ${RELAY_DOCS_URL}`);
  const answer = await confirm({
    message: "Enable relay to pair a device?",
    initialValue: false,
  });
  return !isCancel(answer) && answer;
}

export function printDirectConnectionGuidance(): void {
  console.log("Daemon is running with relay off.");
  console.log(
    "To connect another device directly, use the daemon's TCP address over your LAN, Tailscale, or another VPN.",
  );
  console.log(`Learn more: ${RELAY_DOCS_URL}#direct-connections`);
}

export async function runPairCommand(options: PairOptions): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new Error("Relay pairing needs an interactive terminal to read the password.");
  }
  const reset = options.resetPassword === true;
  const password = await passwordPrompt({
    message: reset ? "New relay password" : "Relay password (set on first use)",
  });
  if (isCancel(password)) throw new Error("Relay pairing cancelled");
  if (!password || Buffer.byteLength(password, "utf8") > 72) {
    throw new Error("Relay password must contain 1–72 UTF-8 bytes");
  }
  if (reset) {
    // 잊은 암호를 다시 잃지 않도록 새 암호만 두 번 확인한다.
    const confirmation = await passwordPrompt({ message: "Confirm new relay password" });
    if (isCancel(confirmation)) throw new Error("Relay pairing cancelled");
    if (confirmation !== password) throw new Error("Relay passwords do not match");
  }
  const output = createProcessOutput();
  const target = options.daemonTarget;
  const resolveOffer = (enableRelay: boolean) =>
    target.kind === "instance"
      ? resolveLocalPairingOffer({ paseoHome: target.home, enableRelay, password, reset })
      : resolveDaemonPairingOffer(target, enableRelay, password, reset);
  const offline = target.kind === "instance" && !(await readDaemonInstance(target.home));
  const pairing = await resolveOffer(options.relay === true);

  if (offline)
    output.writeStderr(
      `Offline pairing offer. Start with: paseo daemon start --home ${JSON.stringify(target.kind === "instance" ? target.home : "")}\n`,
    );

  outputPairingResult(pairing, options, output);
  if (reset && pairing.url && !options.json)
    output.writeStderr(
      `Relay password and pairing link were reset. Previous links and passwords no longer work${offline ? "." : "; the daemon is restarting."}\n`,
    );
}

function outputPairingResult(
  pairing: PairingOffer,
  options: PairOptions,
  output: PairCommandOutput,
): void {
  if (!pairing.relayEnabled || !pairing.url) {
    if (options.json) {
      output.writeStderr(
        `${JSON.stringify({
          code: "RELAY_DISABLED",
          message: "Relay pairing is disabled for this daemon.",
          action: "Run paseo daemon pair --relay --json to enable it explicitly.",
        })}\n`,
      );
    } else {
      output.writeStderr(`${chalk.red("Relay pairing is disabled for this daemon.")}\n`);
      output.writeStderr(`${chalk.yellow("Run paseo daemon pair --relay to enable it.")}\n`);
    }
    output.setExitCode(1);
    return;
  }

  const offer = parseConnectionOfferFromUrl(pairing.url);
  const connectionUri = offer ? serializeRelayConnectionUri({ offer }) : null;

  if (options.json) {
    output.writeStdout(
      `${JSON.stringify(
        { relayEnabled: pairing.relayEnabled, url: pairing.url, qr: pairing.qr, connectionUri },
        null,
        2,
      )}\n`,
    );
    return;
  }

  output.writeStdout(
    formatPairingInstructions({
      url: pairing.url,
      qr: pairing.qr,
      connectionUri,
      columns: output.columns,
    }),
  );
}

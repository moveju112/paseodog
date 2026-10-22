import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const [executable, version] = process.argv.slice(2);
if (!executable || !version)
  throw new Error("Usage: bundled-provider.e2e.mjs <packaged-electron-executable> <release-version>");
const root = await mkdtemp(path.join(tmpdir(), "paseodog-first-run-"));
const home = path.join(root, "state", "paseo");
const listener = net.createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
assert.ok(port !== 6767 && port !== 6768);
await mkdir(home, { recursive: true });
const harness = path.join(root, "first-run.cjs");
await writeFile(harness, `
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const { app, dialog } = require("electron");
Object.defineProperty(app, "isPackaged", { get: () => true });
app.getVersion = () => ${JSON.stringify(version)};
app.setPath("userData", ${JSON.stringify(path.join(root, "user-data"))});
let confirmed = 0;
dialog.showMessageBox = async () => { confirmed++; return { response: 1 }; };
app.whenReady().then(async () => {
  const manager = require(path.join(process.resourcesPath, "app.asar/dist/daemon/daemon-manager.js"));
  const cli = require(path.join(process.resourcesPath, "app.asar/dist/daemon/cli/external.js"));
  const commands = manager.createDaemonCommandHandlers();
  let failure;
  try {
    const [first, same] = await Promise.all([
      commands.start_desktop_daemon(), commands.start_desktop_daemon(),
    ]);
    assert.equal(first.status, "running");
    assert.equal(first.pid, same.pid);
    assert.equal(first.home, ${JSON.stringify(home)});
    assert.equal(confirmed, 1);
    const providers = await cli.runExternalCliJsonCommand(["provider", "ls", "--home", first.home, "--json"]);
    const provider = providers.find((entry) => entry.provider === "paseodog");
    assert.equal(provider?.status, "available");
    assert.equal(provider.defaultMode, "ask");
    const before = await fs.readFile(path.join(first.home, "config.json"), "utf8");
    await commands.start_desktop_daemon();
    assert.equal(confirmed, 1);
    assert.equal(await fs.readFile(path.join(first.home, "config.json"), "utf8"), before);
    console.log("BUNDLED_PROVIDER_OK trust=once start=coalesced provider=available mode=ask restart=idempotent");
  } catch (error) { failure = error; }
  finally {
    try { await manager.stopDesktopDaemonViaCli("quit"); }
    catch (error) { failure ||= error; }
  }
  if (failure) { console.error(failure); app.exit(1); }
  else app.exit(0);
}).catch((error) => { console.error(error); app.exit(1); });
`);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(PASEO|PASEODOG|MIXDOG|OPENAI|ANTHROPIC|CODEX)_/.test(key) &&
  !["NODE_OPTIONS", "NODE_PATH", "ELECTRON_RUN_AS_NODE"].includes(key),
));
let output = "";
try {
  const child = spawn(path.resolve(executable), ["--no-sandbox", "--ozone-platform=headless", harness], {
    env: {
      ...env, HOME: root, USERPROFILE: root, PASEODOG_HOME: path.join(root, "state"),
      PASEO_HOME: home, PASEO_LISTEN: `127.0.0.1:${port}`,
      PASEO_WEB_UI_DIST_DIR: path.join(path.dirname(path.resolve(executable)), "resources/app-dist"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  const [code] = await once(child, "exit");
  assert.equal(code, 0, output.slice(-10000));
  assert.match(output, /BUNDLED_PROVIDER_OK/);
  console.log(output.split("\n").find((line) => line.includes("BUNDLED_PROVIDER_OK")));
} finally {
  await rm(root, { recursive: true });
}

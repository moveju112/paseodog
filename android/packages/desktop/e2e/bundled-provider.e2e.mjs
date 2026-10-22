import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
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
// 실제 전용 데몬 포트와 충돌하지 않도록 테스트의 리스너만 임시 포트로 고정한다.
await writeFile(path.join(home, "config.json"), JSON.stringify({
  version: 1, daemon: { listen: `127.0.0.1:${port}`, relay: { enabled: false } },
}));
const harness = path.join(root, "first-run.cjs");
const packagedExecutable = path.resolve(executable);
const driver = createRequire(new URL("../package.json", import.meta.url))("electron");
const testModule = createRequire(new URL("../package.json", import.meta.url)).resolve("playwright/test");
await writeFile(harness, `
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const { app, dialog } = require("electron");
const { expect } = require(${JSON.stringify(testModule)});
Object.defineProperty(process, "resourcesPath", { value: ${JSON.stringify(path.join(path.dirname(packagedExecutable), "resources"))} });
Object.defineProperty(process, "execPath", { value: ${JSON.stringify(packagedExecutable)} });
const getPath = app.getPath.bind(app);
app.getPath = (name) => name === "exe" ? process.execPath : getPath(name);
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
    // 첫 카탈로그는 비동기로 준비되므로 고정 대기 대신 공개 상태의 완료를 기다린다.
    await expect.poll(async () => {
      const providers = await cli.runExternalCliJsonCommand(["provider", "ls", "--home", first.home, "--json"]);
      return providers.find((entry) => entry.provider === "paseodog");
    }, { timeout: 60_000 }).toMatchObject({ status: "available", defaultMode: "ask" });
    const before = await fs.readFile(path.join(first.home, "config.json"), "utf8");
    const repeated = await commands.start_desktop_daemon();
    assert.equal(repeated.pid, first.pid, "Unchanged bundled runtime must reuse its running daemon");
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
let succeeded = false;
try {
  // 개발용 Electron은 검사 드라이버일 뿐이며 데몬·엔진은 패키징된 실행 파일로 띄운다.
  const child = spawn(driver, ["--no-sandbox", "--ozone-platform=headless", harness], {
    env: {
      ...env, HOME: root, USERPROFILE: root, PASEODOG_HOME: path.join(root, "state"),
      PASEO_HOME: home, PASEO_LISTEN: `127.0.0.1:${port}`,
      PASEO_WEB_UI_DIST_DIR: path.join(path.dirname(path.resolve(executable)), "resources/app-dist"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  const [code] = await once(child, "close");
  assert.equal(code, 0, output.slice(-10000));
  assert.match(output, /BUNDLED_PROVIDER_OK/);
  console.log(output.split("\n").find((line) => line.includes("BUNDLED_PROVIDER_OK")));
  succeeded = true;
} finally {
  if (succeeded) await rm(root, { recursive: true, maxRetries: 1, retryDelay: 100 });
  else console.error(`First-run failure fixture retained: ${root}`);
}

import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createServer } from "node:http";
import { patchQueryStringDecoder } from "../../../../scripts/patch-query-string-decoder.mjs";

const appRequire = createRequire(import.meta.url);
const easRequire = createRequire(appRequire.resolve("eas-cli/package.json"));
const expoRequire = createRequire(appRequire.resolve("expo-router/package.json"));
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const path of temporaryDirectories.splice(0)) await rm(path, { recursive: true });
});

describe("security dependency compatibility", () => {
  it("preserves Expo Router query parsing with the bounded decoder", () => {
    const root = dirname(expoRequire.resolve("query-string/package.json"));
    patchQueryStringDecoder(root, { check: true });
    patchQueryStringDecoder(root);
    const query = expoRequire("query-string");
    expect(query.parse("path=%2Ftmp%2Fa%20b&tag=a&tag=b")).toEqual({
      path: "/tmp/a b",
      tag: ["a", "b"],
    });
    expect(query.stringify({ path: "/tmp/a b" })).toBe("path=%2Ftmp%2Fa%20b");
    expect(query.parse(`q=${"%C2".repeat(10_000)}%`).q).toBe("\uFFFD".repeat(10_000) + "%");
  });

  it("keeps both Metro image-size consumers compatible", () => {
    const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000003000000020806000000", "hex");
    const nativeRequire = createRequire(
      appRequire.resolve("@react-native/metro-config/package.json"),
    );
    for (const resolve of [appRequire, nativeRequire]) {
      const metroRoot = dirname(resolve.resolve("metro/package.json"));
      const { getAssetSize } = resolve(join(metroRoot, "src/Assets.js"));
      expect(getAssetSize("png", png, "security-test.png")).toEqual({ width: 3, height: 2 });
    }
  });

  it("keeps EAS XML, glob and configuration merge APIs compatible", () => {
    const { DOMParser } = easRequire("@xmldom/xmldom");
    const document = new DOMParser().parseFromString(
      "<plist><string>PaseoDog</string></plist>",
      "text/xml",
    );
    expect(document.getElementsByTagName("string")[0].textContent).toBe("PaseoDog");
    expect(easRequire("minimatch").match(["one.ts", "two.js"], "*.ts")).toEqual(["one.ts"]);
    expect(easRequire("ts-deepmerge").merge({ nested: { a: 1 } }, { nested: { b: 2 } })).toEqual({
      nested: { a: 1, b: 2 },
    });
  });

  it("preserves archive creation and extraction used by build tooling", async () => {
    const root = await mkdtemp(join(process.env.PASEODOG_TMP || tmpdir(), "paseodog-security-archive-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "source"));
    await mkdir(join(root, "output"));
    await writeFile(join(root, "source/probe.txt"), "PaseoDog archive compatibility\n");
    const tar = easRequire("tar");
    const archive = join(root, "probe.tgz");
    await tar.c({ cwd: join(root, "source"), file: archive, gzip: true }, ["probe.txt"]);
    await tar.x({ cwd: join(root, "output"), file: archive });
    expect(await readFile(join(root, "output/probe.txt"), "utf8")).toBe(
      "PaseoDog archive compatibility\n",
    );
  });

  it("preserves Miniflare image transforms with patched sharp", async () => {
    const miniflareRequire = createRequire(appRequire.resolve("miniflare/package.json"));
    const sharp = miniflareRequire("sharp");
    const image = await sharp({
      create: { width: 3, height: 2, channels: 4, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    expect(await sharp(image).metadata()).toMatchObject({ width: 3, height: 2, format: "png" });
  });

  it("keeps the AI SDK HTTP client functional without external access", async () => {
    const serverRequire = createRequire(new URL("../../../server/package.json", import.meta.url));
    const aiRequire = createRequire(serverRequire.resolve("ai"));
    const providerRequire = createRequire(aiRequire.resolve("@ai-sdk/provider-utils"));
    const { fetch } = providerRequire("undici");
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end('{"compatible":true}');
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected a TCP test listener");
      const response = await fetch(`http://127.0.0.1:${address.port}/`);
      expect(await response.json()).toEqual({ compatible: true });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });
});

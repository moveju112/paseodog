# Task: build and release

Read Git-ignored `config/rules.local.md` for default targets (S25 arm64-v8a APK + Linux .deb) and signing-key location. Release from the pushed commit.

## Automated delivery and resume

Prefer `npm run deliver:release -- --config <absolute-config.json> --start` after updating the version/changelog and pushing the verified source commit. This is a user-systemd **service**, not a caller-owned scope: closing the chat does not terminate the delivery or the installed desktop. Without `--start` or `--execute`, it prints a plan and performs no release.

### Agent execution budget

- Optimize request-to-delivery latency, not only compiler time. Choose the affected checks once; run `--verify-only` before commit. After commit/push, `--start` reuses `verification.json` only for the same source bytes, Node version and app-test list. Do not run the same root suite again simply because the phase changed from commit to release.
- Once started, the agent handles exceptions only. Do not split successful build, upload, publish, Pages, PC install and reload phases into separate chat turns or approval questions. The original release approval covers them; active-turn interruption, new credentials and destructive recovery remain approval boundaries.
- Read only the failed stage's log when a stage fails. Do not re-read the whole repository or all successful logs, rerun passed suites, or rebuild all platforms for an unrelated check error.
- Use the service status and checkpoint durations instead of repeated polling. Keep source inspection, active operator time, command wall time and idle/approval waits separate when reporting a slowdown. A faster four-test sample is not proof the whole delivery is faster.
- Use `npm test -- --files tests/a.test.mjs,tests/b.test.mjs` for focused root checks. On the Linux release host, both focused and full harness runs share a repository-wide OS lock and print `queueMs` separately from `executionMs`; do not bypass that lock with direct `node --test` for heavyweight bundle checks. A cancelled process releases the OS lock without stale-lock cleanup. Other platforms retain ordinary local test execution without the Linux lock.
- Runtime application waits for the initiating agent to become idle. End the turn after the independent service is scheduled; do not hold the turn open waiting for the service to reload that same active turn.

Keep the JSON configuration in the unique release workspace, never in Git:

```json
{
  "workspace": "/data/tmp/ubuntu/paseodog-release-<unique>",
  "cacheRoot": "<absolute reusable cache from local rules>",
  "signingInit": "<absolute approved signing init>",
  "signingKey": "<absolute existing key>",
  "previousApk": "<absolute previously published signed APK>",
  "androidTools": "<absolute SDK build-tools version directory>",
  "metroWorkers": "2",
  "appTests": ["src/<affected behavior>.test.ts"],
  "repo": "moveju112/paseodog",
  "pagesProject": "paseodog",
  "webUrl": "https://paseodog.choondoggy.com/"
}
```

- The runner checks the clean pushed commit and signing-key reference before building. Root checks/tests and explicit affected app tests/types reuse the identical pre-commit verification receipt or run once when no valid receipt exists. Run affected-path lint before invoking it; pre-existing lint findings must be reported separately. Changes to installed dependencies outside the pinned lockfiles require a fresh workspace/receipt.
- Root tests retain every `tests/*.test.mjs`. `scripts/test.mjs` prepares the common hash-gated bundle and checks its real idempotence once per run. Identical-input assertions reuse that result; legacy-upgrade and drift/partial-patch checks still call the real implementation. Test-only compression uses quality 4; shipped compression retains quality 11.
- `release-state.json` records per-stage results and artifact hashes. Repeating `--start` resumes completed verified stages; changed inputs/artifacts are rejected. Packaging retains at most two heavyweight tasks and records `*-metrics.jsonl` for source copy, dependency install, patching, native downloads and pruning. Native binary cache hits still verify upstream SHA-256; Windows archives still verify lockfile SHA-512.
- `--status` reads progress. If the service was killed, inspect the unit and state first; `--unlock-stopped` removes a stale lock only when its recorded process no longer exists. An uncertain remote mutation **never automatically retries**. Inspect GitHub/Pages/runtime state and use `--execute --retry-stage <exact-name>` only with approval covering that specific retry; never use it to overwrite an existing release blindly.
- GitHub assets are checked before publication; the browser build uses the same dependency build but a separate export. Pages verification waits for startup and checks DOM `input.type`, not the optional HTML attribute. Deep-link refresh must render the exported bundle.
- PC install, plugin reload and desktop relaunch wait for **all** active turns to become idle (up to one hour). Timeout leaves apply incomplete; it never stops an active turn. A GUI owning its daemon or failing to exit gracefully blocks relaunch without force-kill. Desktop verification uses the real `.bin` executable and startup/connection logs, not mutable `/proc` environment variables.
- The standalone `build:release` and the manual steps below remain available. Native changes still require the prebuild decision in section B before either workflow.

## Required Cloudflare Pages delivery

Every requested build/release also includes the following web delivery after GitHub publication, without a separate approval loop. `npm run build:release` alone does not deploy Pages; the operator must complete these steps before reporting delivery complete.

1. From the same pushed commit, export a separate browser bundle: `node scripts/build-web.mjs --hosting cloudflare --output <absolute-release-workspace>/web-cloudflare --metro-workers <local-rule-count>`. Follow section B's resource/cache rules. Do not upload the Electron bundle or the default GitHub Pages export.
2. From `android/packages/app`, run `npx --no-install wrangler pages deploy <absolute-release-workspace>/web-cloudflare --project-name paseodog --branch main` using the existing Cloudflare login. This updates the existing `paseodog` Pages project serving `https://paseodog.choondoggy.com/`; no DNS change is needed for routine updates.
3. Verify the production deployment succeeds, then check HTTPS access, the address/password connection UI, and a deep-link refresh at `https://paseodog.choondoggy.com/` in a real browser. Do not run billable inference for this check. Report Pages deployment separately from artifact publication and PC apply; authentication, deployment or browser-check failures leave web delivery incomplete.

## A. Version

1. versionCode = latest release `paseodog-android-update.json` `versionCode` + 1 (also above `dpkg -s paseodog`). Pass it as `-PpaseodogVersionCode=<vc>`; do not edit the `app.config.js` offset (prebuild fallback only).
   `evidence: android/packages/app/plugins/with-android-version-code.js:16`
2. Write user-facing changes in the current version section of `CHANGELOG.md`.

## B. Build (resource limits)

3. Temp workspace: `mktemp -d /data/tmp/ubuntu/paseodog-release-XXXXXX` (systemd-tmpfiles 3-day TTL).
4. Use `npm run build:release -- --workspace <unique-output> --cache-root <reusable-cache> --signing-init <absolute-init-script> --version-code <vc> --version <제품 버전>.<vc>` with `ANDROID_HOME` from local rules. This builds shared dependencies once and starts PC packaging as soon as web export finishes, without waiting for APK. Each stage has its own `systemd-run --user --scope -p MemoryHigh=16G -p MemorySwapMax=2G`. Keep default Gradle workers; use `--metro-workers <measured-count>` from local rules when default Metro concurrency causes memory pressure (applies equally to Android/web). Allocate the cache root once with `mktemp -d /data/tmp/ubuntu/paseodog-build-cache-XXXXXX`, record its path ONLY in `config/rules.local.md`, and reuse it across releases (existing 3-day inactivity cleanup). Never put Metro caches under a new per-release output directory; Android/web use distinct persistent `TMPDIR`s. `PASEODOG_RESET_METRO_CACHE=1` explicitly restores Android cache reset for troubleshooting. The desktop entry point is `electron-builder.cjs`, which combines the common YAML filters with each platform's exclusions without creating a second unrestricted copy pass.
5. APK: run `CI=1 APP_VARIANT=production npx expo prebuild --platform android --no-install` in `android/packages/app` ONLY when `app.config.js`, `plugins/`, `modules/*/app.plugin*` or native dependencies changed (prebuild invalidates native build caches); otherwise reuse the generated project. Then in `android/packages/app/android/`, with the signing init script, `./gradlew assembleRelease -PpaseodogVersionCode=<vc> -PpaseodogVersionName=<제품 버전>.<vc>`.
   The runner overlaps APK with web export and then one desktop packager. Linux and Windows packaging run sequentially: three simultaneous heavyweight builds caused a measured `systemd-oomd` kill. Do not start a third heavyweight stage to fill the APK's remaining time.
6. Confirm the signing key file matches the init script's `signingConfigs.debug.storeFile`. If the key is missing, stop and report; NEVER create a new key. Per APK: `zipalign`, `apksigner verify`, package ID, version, ABI.
7. .deb: after step 4's deps build, `cd android/packages/app && CI=1 PASEO_WEB_PLATFORM=electron npx expo export --platform web && cd ../.. && npm run build:package --workspace=@getpaseo/desktop -- --linux deb AppImage -c.extraMetadata.version=<제품 버전>.<versionCode>` (same as `npm run build:desktop` minus deps; one invocation so `latest-linux.yml` lists both the .deb and the AppImage; tar.gz is skipped). Windows: `--win nsis --x64` with the same version (installer only, no zip).
   `evidence: android/package.json:96`

## C. Publish

8. One release version everywhere: `<ver>` = `<제품 버전>.<versionCode>` (e.g. `1.0.0-rc.7.11052`). Copy the APK as `PaseoDog-<ver>-arm64-v8a.apk`, then update JSON: `python3 scripts/android-update-manifest.py --version-code <vc> --version-name <ver> --tag v<ver> --target-abi arm64-v8a --output paseodog-android-update.json <apk>`.
    `evidence: scripts/android-update-manifest.py:59`
9. Tag `v<ver>` (check duplicates), title `PaseoDog <ver>`. Upload to ONE draft release: APK, `paseodog-android-update.json`, .deb, AppImage, `latest-linux.yml`, Windows `.exe` + `.exe.blockmap` + `latest.yml`, and `SHA256SUMS`. The phone reads `releases/latest/download/paseodog-android-update.json` and the desktop updater reads `releases/latest`, so the tag name itself is free.
    `evidence: android/packages/desktop/electron-builder.yml:48`
10. Compare remote asset names and byte sizes with local (no re-download), then publish and mark latest.
    `evidence: android/packages/app/src/components/paseodog-update-row.tsx:44`

## D. PC apply and wrap-up

11. Install the same .deb on this PC with `sudo dpkg -i`, relaunch the app, and reload plugin / restart daemon as needed — [RUNTIME_DAEMON.md](../RUNTIME_DAEMON.md) "How to apply".
12. Commit title in Korean: `<변경 요약> 및 <vc> 릴리즈`.

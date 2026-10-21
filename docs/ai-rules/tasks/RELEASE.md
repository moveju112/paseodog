# Task: build and release

Proceed immediately regardless of other sessions — [RUNTIME_DAEMON.md](../RUNTIME_DAEMON.md) "Immediate apply".
Read Git-ignored `config/rules.local.md` for default targets (S25 arm64-v8a APK + Linux .deb) and signing-key location. If absent, build only the targets in the current request.

## Scope

- Code-change request: up to local build + PC apply. No Git commit/push or GitHub publish.
- "커밋·푸시" request: selective commit/push of your own changes + this whole release (build, sign, publish, PC apply). An explicit narrowing such as "커밋만" wins.
- "릴리즈" request: build, sign, publish, PC apply. Do not infer a separate commit/push.
- New branch/remote, force push, signing-key replacement need separate approval.

## A. Version

1. Checks: root `npm run check && npm test` (`npm run typecheck` for plugin TS), plus typecheck/lint/related Vitest for changed `android/` paths.
   `evidence: package.json:12`
2. Raise the `versionCode` offset `+N` above every existing release/install (`dpkg -s paseodog`, `gh release list`).
   `evidence: android/packages/app/app.config.js:134`
3. Write user-facing changes in the current version section of `CHANGELOG.md`. Add new required files to `MANIFEST.sha256` (and `scripts/package.py` `ROOT_FILES` for `android/`).
   `evidence: scripts/package.py:15`

## B. Build (resource limits)

4. Temp workspace: `mktemp -d /data/tmp/ubuntu/paseodog-release-XXXXXX` (systemd-tmpfiles 3-day TTL). NEVER accumulate artifacts inside the project (deliverables/ etc.).
5. Build inside `systemd-run --user --scope -p MemoryHigh=8G -p MemorySwapMax=2G`, explicitly limiting Gradle/Metro parallelism to 1. NEVER run Android and Linux builds concurrently in the same checkout (run sequentially).
6. APK: in `android/packages/app/android/`, with the signing init script, `./gradlew assembleRelease --max-workers=1 -Porg.gradle.parallel=false`. Confirm `reactNativeArchitectures=arm64-v8a` in `gradle.properties`.
   `evidence: android/packages/app/plugins/with-android-architectures.js:5`
7. Confirm the signing key file matches the init script's `signingConfigs.debug.storeFile`. If the key is missing, stop and report; NEVER create a new key. Per APK: `zipalign`, `apksigner verify`, package ID, version, ABI.
8. .deb: in `android/`, the `npm run build:desktop` order (`build:desktop-deps` → `expo export --platform web` → `build:package`), version `-c.extraMetadata.version=<제품 버전>.<versionCode>`.
   `evidence: android/package.json:96`
9. If source changes after a build, rebuild only affected artifacts. NEVER rename an old file and call it a new build.

## C. Publish

10. Update JSON: `python3 scripts/android-update-manifest.py --version-code <vc> --version-name <name> --tag <tag> --target-abi arm64-v8a --output paseodog-android-update.json <apk>`.
    `evidence: scripts/android-update-manifest.py:59`
11. Match `latest-linux.yml` `version`/`path`/`sha512`/`size` against the real .deb; create `SHA256SUMS`.
12. Tag `android-v<Paseo 기반 버전>-<n>` (check duplicates), title `PaseoDog <vc> · Galaxy S25 · Linux`. Upload all five files — APK, `paseodog-android-update.json`, .deb, `latest-linux.yml`, `SHA256SUMS` — to ONE draft release.
    `evidence: android/packages/desktop/electron-builder.yml:48`
13. Compare remote names/bytes/SHA-256 with local, then publish and mark latest. Afterwards confirm tag/assets via `gh api repos/moveju112/paseodog/releases/latest`.
    `evidence: android/packages/app/src/components/paseodog-update-row.tsx:44`
14. Release notes: source commit, checks run, APK signed with the public debug key, .deb has no code signature; state if uncommitted changes were included.

## D. PC apply and wrap-up

15. Install the same .deb on this PC with `sudo dpkg -i`, relaunch the app, and reload plugin / restart daemon as needed — [RUNTIME_DAEMON.md](../RUNTIME_DAEMON.md) "How to apply".
16. Commit title in Korean: `<변경 요약> 및 <vc> 릴리즈`.
17. Delete this task's temporary artifacts after publish/verification; keep the build log path in the result report.

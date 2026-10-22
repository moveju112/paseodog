# Task: build and release

Read Git-ignored `config/rules.local.md` for default targets (S25 arm64-v8a APK + Linux .deb) and signing-key location. Release from the pushed commit.

## A. Version

1. versionCode = latest release `paseodog-android-update.json` `versionCode` + 1 (also above `dpkg -s paseodog`). Pass it as `-PpaseodogVersionCode=<vc>`; do not edit the `app.config.js` offset (prebuild fallback only).
   `evidence: android/packages/app/plugins/with-android-version-code.js:16`
2. Write user-facing changes in the current version section of `CHANGELOG.md`.

## B. Build (resource limits)

3. Temp workspace: `mktemp -d /data/tmp/ubuntu/paseodog-release-XXXXXX` (systemd-tmpfiles 3-day TTL).
4. Build inside `systemd-run --user --scope -p MemoryHigh=12G -p MemorySwapMax=2G` with default Gradle/Metro worker counts. Run `npm run build:desktop-deps` (in `android/`) once first; then the APK build and the Linux web export + package may run concurrently, each in its own scope (`MemoryHigh=8G`).
5. APK: run `CI=1 APP_VARIANT=production npx expo prebuild --platform android --no-install` in `android/packages/app` ONLY when `app.config.js`, `plugins/`, `modules/*/app.plugin*` or native dependencies changed (prebuild invalidates native build caches); otherwise reuse the generated project. Then in `android/packages/app/android/`, with the signing init script, `./gradlew assembleRelease -PpaseodogVersionCode=<vc>`.
6. Confirm the signing key file matches the init script's `signingConfigs.debug.storeFile`. If the key is missing, stop and report; NEVER create a new key. Per APK: `zipalign`, `apksigner verify`, package ID, version, ABI.
7. .deb: after step 4's deps build, `cd android/packages/app && CI=1 PASEO_WEB_PLATFORM=electron npx expo export --platform web && cd ../.. && npm run build:package --workspace=@getpaseo/desktop -- --linux deb AppImage -c.extraMetadata.version=<제품 버전>.<versionCode>` (same as `npm run build:desktop` minus deps; one invocation so `latest-linux.yml` lists both the .deb and the AppImage; tar.gz is skipped). Windows: `--win nsis --x64` with the same version (installer only, no zip). If the change touches only Android-native files (`android/packages/app/plugins/`, `modules/*/android/`, Android-only config), skip the Linux build and re-upload the previous latest release's `.deb` + `latest-linux.yml` unchanged.
   `evidence: android/package.json:96`
8. If source changes after a build, rebuild only affected artifacts.

## C. Publish

9. One release version everywhere: `<ver>` = `<제품 버전>.<versionCode>` (e.g. `1.0.0-rc.7.11052`). Copy the APK as `PaseoDog-<ver>-arm64-v8a.apk`, then update JSON: `python3 scripts/android-update-manifest.py --version-code <vc> --version-name <ver> --tag v<ver> --target-abi arm64-v8a --output paseodog-android-update.json <apk>`.
    `evidence: scripts/android-update-manifest.py:59`
10. Tag `v<ver>` (check duplicates), title `PaseoDog <ver>`. Upload to ONE draft release: APK, `paseodog-android-update.json`, .deb, AppImage, `latest-linux.yml`, Windows `.exe` + `.exe.blockmap` + `latest.yml`, and `SHA256SUMS`. The phone reads `releases/latest/download/paseodog-android-update.json` and the desktop updater reads `releases/latest`, so the tag name itself is free.
    `evidence: android/packages/desktop/electron-builder.yml:48`
11. Compare remote asset names and byte sizes with local (no re-download), then publish and mark latest.
    `evidence: android/packages/app/src/components/paseodog-update-row.tsx:44`

## D. PC apply and wrap-up

12. Install the same .deb on this PC with `sudo dpkg -i`, relaunch the app, and reload plugin / restart daemon as needed — [RUNTIME_DAEMON.md](../RUNTIME_DAEMON.md) "How to apply".
13. Commit title in Korean: `<변경 요약> 및 <vc> 릴리즈`.

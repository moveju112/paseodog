# Pitfalls

Each entry: verbatim symptom (grep it) → cause → fix.

## Daemon / provider

- **Symptom:** `Provider 'paseodog' is not available. Available providers: none.`
  - **Cause:** the running plugin holds the `VERSION` it loaded while the on-disk engine `--check` reports a newer one. `evidence: plugin/server/provider.ts:29`
  - **Fix:** reload the plugin immediately — [RUNTIME_DAEMON.md](RUNTIME_DAEMON.md) "How to apply".
- **Symptom:** `provider diagnostic paseodog` shows `PaseoDog engine version mismatch`.
  - **Cause:** same as above, seen from the diagnostic side.
  - **Fix:** reload. NEVER revert `release.json` to the old value.
- **Symptom:** PC app works but `paseodog ...` reloads/changes do not reach it (or the reverse).
  - **Cause:** the app started without the dedicated `PASEO_HOME` and attached to the `~/.paseo` (6767) daemon. Check `desktop daemon ... listen` in `~/.config/PaseoDog/logs/main.log`.
  - **Fix:** launch the app with the dedicated `PASEO_HOME` — [RUNTIME_DAEMON.md](RUNTIME_DAEMON.md) "Which daemon".
- **Symptom:** `Session already owned by another live connection` / `Session already owned`.
  - **Cause:** two connections/daemons share one journal dir; the lock fails closed by design. `evidence: plugin/server/journal.mjs:79`
  - **Fix:** reduce to one owning daemon. NEVER delete a live lock file.
- **Symptom:** `doctor` passes / Provider Ready, but the feature fails in the app.
  - **Cause:** `doctor` makes no inference request. `evidence: scripts/doctor.mjs:28`
  - **Fix:** verify on the actually connected host/session; report test doubles and real use separately.

## Upstream patches

- **Symptom:** during install `hash mismatch`, `anchor mismatch`, `Partial ... patch`, `patch drift`.
  - **Cause:** the installed upstream file differs from the reviewed original (new upstream version, fix already upstream, or another patch missing from the order).
  - **Fix:** re-review the new original, then re-port or delete the patch. NEVER change only the hash — [CODING_RULES.md](CODING_RULES.md) "Upstream patches".
- **Symptom:** `npm run upstream:check` fails with `Mixdog patch pin mismatch` / `Paseo CLI/SDK pins differ` / `Lockfile mismatch` / `Exact version required`.
  - **Cause:** only part of the pin records was updated. `evidence: scripts/check-upstream.mjs:39`
  - **Fix:** update the three packages, lockfiles and `PIN` in one change.
- **Symptom:** `npm test` fails `independent product version and upstream provenance stay consistent`.
  - **Cause:** product version / `paseodogUpstream` changed in only some of `package.json`, `plugin/shared/release.json`, sub-packages. `evidence: tests/version.test.mjs:9`
  - **Fix:** bump all together, then reload the plugin.

## Release package

- **Symptom:** `python3 scripts/package.py` fails `Reviewed release source missing: <경로>`.
  - **Cause:** a path in `MANIFEST.sha256` is missing from the working tree (including deleted/moved docs). `evidence: scripts/package.py:59`
  - **Fix:** restore the file, or remove its line from `MANIFEST.sha256` and keep the `tests/package.test.mjs` required list in sync.
- **Symptom:** a new module works in dev but import fails in the release ZIP.
  - **Cause:** not added to `MANIFEST.sha256`, so the ZIP dropped it. `evidence: scripts/package.py:35`
  - **Fix:** add it and confirm the package test via `npm test`.
- **Symptom:** PC app Settings update check shows no new version.
  - **Cause:** latest release lacks .deb/`latest-linux.yml` (Android-only publish) or the desktop version is not higher. The updater reads only `releases/latest`.
  - **Fix:** publish all five assets in one release and bump `versionCode` — [tasks/RELEASE.md](tasks/RELEASE.md) C.
- **Symptom:** during Android bundling `hermesc` runs for minutes or uses several GB of memory.
  - **Cause:** huge generated code (e.g. a single `ws-outbound.aot`-family function) re-entered the bundle.
  - **Fix:** NEVER raise the memory limit; stop, inspect bundle inputs and report.

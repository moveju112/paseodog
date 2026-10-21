# Pitfalls

Each entry: verbatim symptom (grep it) -> cause -> fix.

## Runtime / daemon

- **Symptom:** `Provider 'paseodog' is not available. Available providers: none. Use one of those providers, or install/configure 'paseodog'.`
  - **Cause:** the running plugin still holds the `VERSION` it loaded, while `paseodog-engine --check` on disk reports a newer version after a version bump or upstream intake (`evidence: plugin/server/provider.ts`). Also seen when the client is attached to a daemon whose plugin was not reloaded.
  - **Fix:** reload the plugin on the authorized local dedicated daemon at a safe point, then confirm `provider ls` shows `available`. Other hosts require their own authorization — [RUNTIME_DAEMON.md](RUNTIME_DAEMON.md) "Live plugin vs source tree".

- **Symptom:** `provider diagnostic paseodog` shows `PaseoDog engine version mismatch`.
  - **Cause:** same as above, seen from the diagnostic side.
  - **Fix:** same reload; do not edit `release.json` back to the old value.

- **Symptom:** desktop app works but changes/reloads made with `paseodog ...` have no effect (or the reverse).
  - **Cause:** the desktop was launched without `PASEO_HOME` and attached to `~/.paseo` (port `6767`), while `paseodog` targets the dedicated home. Check `~/.config/PaseoDog/logs/main.log` -> `desktop daemon ... listen`.
  - **Fix:** launch the desktop with the dedicated `PASEO_HOME`; do not automatically edit or reload the stock profile — [RUNTIME_DAEMON.md](RUNTIME_DAEMON.md) "Which daemon".

- **Symptom:** daemon log warning `Provider override matches no registered provider` right before `[paseo] Stopping plugin`.
  - **Cause:** expected transient while `paseodog-provider` reloads; the provider is unregistered between stop and ready.
  - **Fix:** none if `Plugin ready` follows; otherwise read `paseodog plugin logs paseodog-provider`.

- **Symptom:** `Session already owned by another live connection` / `Session already owned`.
  - **Cause:** two connections or two daemons share one journal dir (`evidence: plugin/server/journal.mjs` owner lock); the lock fails closed by design.
  - **Fix:** identify the owning daemon/connection and coordinate a safe release of ownership. Do not stop another active session without interruption approval or delete a live lock (`evidence: docs/OPERATIONS.md` § "6. 진단").

- **Symptom:** doctor passes / provider shows Ready, but the feature fails in the app.
  - **Cause:** `doctor` makes no inference request; Ready only proves `--check` (`evidence: scripts/doctor.mjs` `warning`).
  - **Fix:** verify the actual connected host/session capability; follow `docs/ACCEPTANCE.md` for real model/UI acceptance.

## Upstream intake

- **Symptom:** `Paseo terminal source drift; expected audited SHA-256 ...` (or another `patch-*.mjs` drift/hash error) during install.
  - **Cause:** the installed upstream file differs from the reviewed original — a new upstream version or a fix already merged upstream.
  - **Fix:** re-review the new source, port or delete the patch — [tasks/MERGE_UPSTREAM.md](tasks/MERGE_UPSTREAM.md). Never change only the hash.

- **Symptom:** `npm run upstream:check` fails with `Mixdog patch pin mismatch`, `Paseo CLI/SDK pins differ`, `Lockfile mismatch: <name>` or `Exact version required: <name>`.
  - **Cause:** partial intake — one of `scripts/patch-mixdog.mjs` `PIN`, the two Paseo pins, or a lockfile was not updated together (`evidence: scripts/check-upstream.mjs`).
  - **Fix:** update every record listed in [UPSTREAM_INTAKE.md](UPSTREAM_INTAKE.md) in one change.

- **Symptom:** `npm test` fails in `independent product version and upstream provenance stay consistent`.
  - **Cause:** product version or `paseodogUpstream` changed in some of `package.json`, `plugin/shared/release.json`, the three sub-packages or their lockfiles (`evidence: tests/version.test.mjs`).
  - **Fix:** bump all of them together, then reload the live plugin.

## Documentation drift

- **Symptom:** `docs/ARCHITECTURE.md` says images, steering and live settings are "Not advertised".
  - **Cause:** that section predates the image/steer/configure work; code now advertises `prompt.image`, `prompt.steer`, `session.configure` (`evidence: plugin/server/connection.mjs`).
  - **Fix:** treat `CAPABILITIES` as truth; update `docs/ARCHITECTURE.md` § "Capability contract" when touching capabilities.

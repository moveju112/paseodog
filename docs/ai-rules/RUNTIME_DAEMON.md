# Daemon and PC apply

Build, signing and GitHub publish order: [tasks/RELEASE.md](tasks/RELEASE.md). This file: which daemon to use, and when/how source changes reach the running daemon and the installed PC app.

## Immediate apply

- **MUST** run build, deploy, release and PC apply (plugin reload, daemon restart, PC app install/update) immediately, regardless of other sessions, active turns or other agents' work; NEVER defer.
  - why: explicit user instruction (2026-10-21). Do not hold, schedule or hand off to a final owner to protect active sessions.
  - ❌ reporting "reload deferred to a safe point because another session is running" and stopping.
  - ✅ after verification run `paseodog plugin reload paseodog-provider` or `paseodog daemon restart` right away; list any interrupted sessions in the result report.
- **MUST** preserve other sessions' Git changes even while applying immediately: stage/commit only your own changes; NEVER revert or clean up others' work.
  - why: the immediacy rule removes waiting, not ownership of others' work.
  - ✅ select only your hunks with `git add -p`.
- **MUST** treat every code-change request as including, after verification, commit/push, the full release ([tasks/RELEASE.md](tasks/RELEASE.md)) and every needed apply on this PC (build, install, reload, restart, web-bundle patch). Do not ask "apply?", "release?" or "push?". Doc-only edits that change no executable code get commit/push only, no build/release/restart.
  - why: explicit user instruction (2026-10-21). The phone only updates in-app from a published release, so stopping at PC apply leaves the app behind.
  - ❌ "PC에만 적용했고, 휴대폰은 릴리즈를 따로 말해줘야 해" 하고 멈추기.
  - ✅ `plugin/` change → reload; shared app/desktop change → release, then install the same .deb; web-bundle patch change → `node scripts/patch-<이름>.mjs` + `--check`.

## Which daemon

- **MUST** do PaseoDog work only on the dedicated daemon, started only via the `paseodog` wrapper (`paseodog start`, or `paseodog serve` under systemd).
  - why: the wrapper injects the dedicated `PASEO_HOME`/`MIXDOG_HOME`; plain `paseo` falls back to `~/.paseo`.
  - ✅ `evidence: scripts/paths.mjs:28` — `runtimeEnv()` sets `PASEO_HOME: paseoHome`.
- **NEVER** run `paseodog start` (managed) and `paseodog.service` (`serve`) on the same home at once.
  - why: two supervisors compete for the port and session journal locks.
  - ✅ `evidence: scripts/service.mjs:11` — tells you to `paseodog daemon stop` before switching to the service.
- **NEVER** reload or modify stock Paseo (`~/.paseo`, 6767) or personal profiles (`~/.mixdog`) as an apply target.
  - why: PaseoDog does not own them.
  - ✅ report an unexpected registration; do not touch it.

## How to apply

- **MUST** after changing `plugin/`, the product version or upstream pins, reload the plugin on the dedicated daemon and confirm `available`.
  - why: the daemon keeps the `VERSION` it loaded; a newer disk version makes the provider unavailable.
  - ✅ `evidence: plugin/server/provider.ts:29` — `PaseoDog engine version mismatch`
  - ✅ commands:
    ```bash
    paseodog plugin reload paseodog-provider
    paseodog provider ls          # paseodog = available
    ```
- **MUST** apply shared app/desktop changes to the real install /opt/PaseoDog: install the verified locally built .deb with `sudo dpkg -i` and relaunch the app.
  - why: source, build, published release, installed app and running app are separate states.
  - ❌ hand-editing the installed `app.asar`. `paseodog desktop-update --apply` (asar overwrite) is the legacy path for pre-11032 installs only. `evidence: bin/paseodog.mjs:44`
  - ✅ after install, confirm `dpkg -s paseodog` reports the built version.
- **NEVER** run `scripts/install.sh` or `scripts/service.mjs --install` as a check or upgrade trial.
  - why: install rewrites the profile, re-applies patches and starts/reloads the daemon; the systemd unit is opt-in.
  - ✅ check with `paseodog doctor`; patches with `node scripts/patch-<이름>.mjs --check`.
- **NEVER** fold remote server apply, new public listeners, signing-key replacement, or chat/account data deletion into PC-apply approval.
  - why: the immediate-apply scope is this PC's dedicated PaseoDog environment.
  - ✅ get separate approval stating target and impact.

## Diagnose

```bash
paseodog doctor                                  # 설치·설정만, 추론 요청 없음
paseodog daemon status                           # 전용 데몬 pid·listen
paseodog provider diagnostic paseodog --json
paseodog plugin logs paseodog-provider
```

- **NEVER** report a passing `doctor` or Provider Ready as proof a feature works.
  - why: `doctor` makes no inference request; Ready only proves `--check`.
  - ✅ `evidence: scripts/doctor.mjs:28` — `no inference request was made`

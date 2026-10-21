# Daemon and PC apply

Build, signing and GitHub publish order: [tasks/RELEASE.md](tasks/RELEASE.md). This file: which daemon to use, and when/how source changes reach the running daemon and the installed PC app.

## Which daemon

- **MUST** do PaseoDog work only on the dedicated daemon, started only via the `paseodog` wrapper (`paseodog start`).
  - why: the wrapper injects the dedicated `PASEO_HOME`/`MIXDOG_HOME`; plain `paseo` falls back to `~/.paseo`.
  - ✅ `evidence: scripts/paths.mjs:28` — `runtimeEnv()` sets `PASEO_HOME: paseoHome`.
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
  - ❌ hand-editing the installed `app.asar`.
  - ✅ after install, confirm `dpkg -s paseodog` reports the built version.
- **NEVER** run `scripts/install.sh` as a check or upgrade trial.
  - why: install rewrites the profile, re-applies patches and starts/reloads the daemon.
  - ✅ check with `paseodog doctor`; patches with `node scripts/patch-<이름>.mjs --check`.
- **NEVER** fold new public listeners or chat/account data deletion into PC-apply approval.
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

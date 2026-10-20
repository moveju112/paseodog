# Runtime and Daemons

Install/ops guide: `docs/OPERATIONS.md`. This file: which daemon to use and how live
processes see source changes.

## Which daemon

| Daemon | `PASEO_HOME` | Listen | Status |
|---|---|---|---|
| **PaseoDog dedicated** | `${PASEODOG_HOME:-~/.local/share/paseodog}/paseo` | from its `config.json`; `6768` when stock Paseo also runs | **canonical** |
| stock Paseo | `~/.paseo` (Paseo default) | `6767` | not PaseoDog-owned |

- **MUST** run PaseoDog work on the dedicated daemon, started only through the `paseodog` wrapper (`paseodog start`, or `paseodog serve` under `paseodog.service`).
  - why: the wrapper injects the dedicated `PASEO_HOME`, `MIXDOG_HOME` and journal dir; plain `paseo` falls back to `~/.paseo`.
  - ✅ `evidence: scripts/paths.mjs` — `runtimeEnv()` sets `PASEO_HOME: paseoHome` for every wrapped call (`evidence: bin/paseodog.mjs`).

- **MUST** give the dedicated profile a port other than `6767` when stock Paseo is installed on the host.
  - why: `configure.mjs` defaults a new profile to `6767`, the stock Paseo port.
  - ✅ `evidence: scripts/configure.mjs` (`baseDaemon` default listen); procedure `evidence: docs/OPERATIONS.md` § "1. 설치와 최초 로그인".

- **PREFER** launching the installed PaseoDog desktop app with `PASEO_HOME` set to the dedicated home.
  - why: without it the app starts or attaches to the `~/.paseo` daemon, so a second daemon runs the same plugin; edits, reloads and diagnostics then have to target both.
  - ✅ export `PASEO_HOME` = the dedicated home (`evidence: scripts/paths.mjs` `paseoHome`) in the desktop launcher environment.

- **NEVER** run the managed `paseodog start` daemon and the systemd `paseodog serve` unit at the same time.
  - why: two supervisors on one home compete for the port and the session journal locks.
  - ✅ `evidence: docs/OPERATIONS.md` § "5. systemd 사용자 서비스 및 작업별 cgroup"; unit `ExecStart` is `serve` (`evidence: scripts/service.mjs`).

## Live plugin vs source tree

Release approval, rollout checks and completion reporting:
[tasks/RELEASE.md](tasks/RELEASE.md). GitHub publication does not reload a plugin,
restart a daemon or install a phone app. A scheduled restart is not a verified restart.

The plugin is registered from the source checkout (`evidence: scripts/install.sh` `plugin install "$ROOT/plugin"`), and each
engine child runs `engine/bin/paseodog-engine.mjs` from the same tree. A running daemon keeps the
plugin code and `release.json` it loaded; new engine children read the disk.

- **MUST** reload the plugin on every daemon that registered it after changing `plugin/`, the product version, or upstream pins.
  - why: provider status compares the loaded `VERSION` with `paseodog-engine --check`; a version bump on disk makes the provider unavailable until reload.
  - ✅ `evidence: plugin/server/provider.ts` `status()` version check
  - ✅ commands:
    ```bash
    paseodog plugin reload paseodog-provider                                   # dedicated home
    tools/node_modules/.bin/paseo plugin reload paseodog-provider --home ~/.paseo   # only if registered there
    paseodog provider ls                                                       # expect paseodog = available
    ```

- **NEVER** reload or restart a daemon during another agent's active turn without operator approval.
  - why: reload stops the provider; an in-flight turn fails and its side effects stay done.
  - ✅ check `paseodog ls` for running agents first; ask, then reload.

- **NEVER** run `scripts/install.sh` or `scripts/service.mjs --install` as a check or to try an upgrade; both change config/services.
  - why: install rewrites the profile, re-applies patches and starts/reloads the daemon; the systemd unit is opt-in.
  - ✅ `evidence: docs/UPSTREAM.md` § "Upgrade procedure"; `evidence: docs/OPERATIONS.md` § "5. systemd 사용자 서비스 및 작업별 cgroup"

## Diagnose

```bash
paseodog doctor                       # install/config only, no inference
paseodog daemon status                # dedicated daemon pid/listen
paseodog provider diagnostic paseodog --json
paseodog plugin logs paseodog-provider
```

Daemon logs: `<PASEO_HOME>/daemon.log`. Desktop log: `~/.config/PaseoDog/logs/main.log`
(its `desktop daemon` line shows which `listen` the app attached to).

# Architecture

PaseoDog = Paseo (daemon, desktop/mobile/web/SSH clients) + Mixdog (inference, native sessions), joined through a Paseo provider plugin.

## Directories

| Path | Role |
|---|---|
| `bin/paseodog.mjs` | `paseodog` wrapper injecting the dedicated home (`start`→`daemon start`, `serve`→`daemon run`, `desktop-update`) |
| `plugin/` | Paseo provider plugin. `plugin/server/` (connection, journal, engine process), `plugin/client/` (settings, usage UI), `plugin/shared/release.json` (product + base versions) |
| `engine/` | Mixdog native engine worker (`engine/src/*.mjs`), `engine/bin/paseodog-engine.mjs` |
| `scripts/patch-*.mjs` | patch installers that modify installed upstream files after hash verification |
| `patches/*.mjs` | pure string transforms (`withX`/`withoutX`) used by the installers |
| `tools/` | pinned `@getpaseo/cli` install; tests read its real bundles |
| `android/` | vendored Paseo monorepo source. Shared app source for Android APK, Linux .deb and web bundle (`packages/app`), desktop (`packages/desktop`), server, protocol |
| `tests/` | root `node --test` tests, `tests/fixtures/`, `tests/contracts/`, `*-smoke.mjs` (device/billable smokes) |
| `config/` | `model-routes.example.json`, Git-ignored `rules.local.md` |

## Version sources

- Product version: `package.json` `version` = `plugin/shared/release.json`. `evidence: tests/version.test.mjs:9`
- Base versions: `package.json` `paseodogUpstream` (Paseo, Mixdog). Pinned in three places — `engine` (`mixdog`), `tools` (`@getpaseo/cli`), `plugin` (`@getpaseo/plugin`) — plus `scripts/patch-mixdog.mjs` `PIN`. `evidence: scripts/check-upstream.mjs:10`
- Android `versionCode` = `androidVersionCode` (derived from the Paseo base version) + release offset `+N`. `evidence: android/packages/app/app.config.js:134`
- Desktop version = `<제품 버전>.<versionCode>` (e.g. `1.0.0-rc.7.11036`).

## Runtime

| Target | Location |
|---|---|
| Dedicated home | `${PASEODOG_HOME:-~/.local/share/paseodog}` → paseo/ (PASEO_HOME), mixdog/ (MIXDOG_HOME). `evidence: scripts/paths.mjs:6` |
| Dedicated daemon port | `listen` in the dedicated home's paseo/config.json (this PC: `127.0.0.1:6768`). 6767 is stock Paseo |
| Installed PC app | /opt/PaseoDog, log `~/.config/PaseoDog/logs/main.log` |
| Plugin registration | the source checkout's `plugin/` is registered directly. `evidence: scripts/install.sh:64` |

## Data flow

1. Client → Paseo daemon → `plugin/server/connection.mjs` writes the turn receipt to the journal first.
2. `plugin/server/process-engine.mjs` spawns the engine child (`engine/bin/paseodog-engine.mjs`) over JSON Lines.
3. Engine `engine/src/native-engine.mjs` runs the Mixdog native session; tool calls get ask/deny from host policy in `engine/src/policy.mjs`.
4. UI features ship two ways: APK/.deb built from shared app source (`android/packages/app/src`), and `patches/` applied to the pinned Paseo web bundle.

## Ownership boundaries

- Paseo: clients, daemon. Mixdog: inference, model history. Adapter (`plugin/`, `engine/`): lifecycle, approval, journal, wire mapping.
- `engine/src` imports `plugin/server/{json-lines,util,agent-message}.mjs` directly. `evidence: engine/src/controls.mjs:5`
- A daemon keeps the plugin code and `release.json` it loaded; only new engine children read current disk code.

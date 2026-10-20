# Architecture

PaseoDog combines two upstreams instead of forking either: **Paseo** (daemon, desktop/web/
mobile/SSH clients, plugin SDK) and **Mixdog** (inference, context, native sessions). PaseoDog
is the adapter between them plus a set of hash-gated local patches on the installed upstreams.

Project reference: `docs/ARCHITECTURE.md` (boundary, transport, journal). This file is the agent map.

## Ownership boundary

| Layer | Owner | Lives in |
|---|---|---|
| Clients, daemon, plugin host, relay, CLI | Paseo (npm `@getpaseo/cli`, `@getpaseo/plugin`) | `tools/node_modules`, `plugin/node_modules` |
| Inference, model history, prompt cache, native sessions | Mixdog (npm `mixdog`) | `engine/node_modules/mixdog` |
| Lifecycle, approvals, journal, wire mapping | PaseoDog adapter | `plugin/server/`, `engine/src/` |
| Upstream patches (exact-blob gated) | PaseoDog | `scripts/patch-*.mjs`, `patches/` |

- **MUST** add a feature on the side that owns it; the adapter only translates and gates.
  - why: copied upstream logic cannot be re-merged when upstream ships the next fix.
  - ✅ `evidence: docs/UPSTREAM.md` § "Upgrade procedure" — "Keep inference features in Mixdog and client/daemon features in Paseo."

## Same name, different thing

"Paseo" or "Mixdog" in a request, path or file name does not mean "edit the upstream copy".

| Name you see | What it is | PaseoDog-owned? | Change it through |
|---|---|---|---|
| `scripts/patch-paseo-*.mjs`, `patch-mixdog.mjs`, `patches/paseo-*`, `tests/paseo-*` | PaseoDog patches/tests that target upstream | yes | edit directly |
| `tools/node_modules/@getpaseo/*`, `engine/node_modules/mixdog` | installed upstream, rewritten by `npm ci` | no | a `scripts/patch-*.mjs` patch or a pin bump |
| installed PaseoDog desktop app bundle | Paseo desktop build, rewritten by each desktop update | no | `scripts/patch-paseo-composer.mjs` applied by `paseodog desktop-update` |
| `~/project/mixdog`, `~/project/mixdog-fork-dist` | separate Mixdog fork checkouts, not referenced here | no | not a PaseoDog input; npm pin is `evidence: engine/package.json` |
| `~/.paseo`, `~/.mixdog` | personal stock Paseo / Mixdog profiles | no | never edit for PaseoDog work |
| `~/.local/share/paseodog/{paseo,mixdog,sessions}` | PaseoDog dedicated state | yes (runtime state) | `paseodog` wrapper / `scripts/configure.mjs` |

- **MUST** resolve "fix it in Paseo/Mixdog" to a patch script or a pin bump in this repo, never to an upstream copy elsewhere.
  - why: edits to installed or sibling upstream code never reach the PaseoDog build and bypass the reviewed-hash gate.
  - ✅ [tasks/MERGE_UPSTREAM.md](tasks/MERGE_UPSTREAM.md) step 8 (backport) or steps 4-7 (base upgrade).

## Directory map

| Path | Role |
|---|---|
| `bin/paseodog.mjs` | CLI wrapper: sets the dedicated `PASEO_HOME`, passes other args to pinned Paseo CLI |
| `plugin/index.server.ts`, `plugin/server/provider.ts` | Paseo provider registration (`id: 'paseodog'`) |
| `plugin/server/connection.mjs` | provider connection, advertised `CAPABILITIES`, turn lifecycle |
| `plugin/server/process-engine.mjs`, `json-lines.mjs` | one engine child per session over JSONL stdio |
| `plugin/server/process-scope.mjs` | `systemd-run --user --scope` per session |
| `plugin/server/journal.mjs` | fsynced bridge journal, receipts, owner locks |
| `plugin/server/question.mjs` | Mixdog `ask_user` question <-> Paseo question UI |
| `plugin/server/controls.mjs`, `engine/src/controls.mjs` | resident control process: model/route selection without credentials |
| `plugin/server/native-config.mjs` | read-only viewer of Claude Code / Codex config; never writes |
| `plugin/server/usage.ts`, `engine/src/usage.mjs` | usage/quota from the dedicated Mixdog runtime, no direct auth-file reads |
| `plugin/client/*.tsx` | Paseo UI panels (live status, usage, native config) |
| `plugin/shared/release.json` | product version + upstream base versions read by the plugin |
| `engine/bin/paseodog-engine.mjs` | worker entry; `--check` / `--version` used by provider status |
| `engine/src/native-engine.mjs` | imports Mixdog runtime, installs `beforeSessionAsk` host policy |
| `engine/src/orchestration.mjs`, `policy.mjs` | child-agent ownership, tool approval policy |
| `engine/src/worker.mjs` | engine process loop; only UI-safe projections cross the wire |
| `scripts/patch-mixdog.mjs`, `patch-paseo-*.mjs` | exact-hash upstream patches applied after install |
| `scripts/check-upstream.mjs` | read-only pinned-vs-latest npm comparison |
| `scripts/configure.mjs`, `install.sh`, `service.mjs` | dedicated profile, install, systemd unit |
| `scripts/desktop-release.mjs` | reviewed update of the installed PaseoDog desktop app |
| `tests/*.test.mjs` | `node --test`; fixtures in `tests/fixtures/`, helpers in `tests/helpers.mjs` |

## Stack

Node `^22.19 || >=24` ESM (.mjs files), TypeScript only at the SDK boundary (`plugin/*.ts`,
`plugin/client/*.tsx`), shell for install, one Python packager (`scripts/package.py`).
Three separate npm packages, each with its own lockfile: `engine/`, `plugin/`, `tools/`.

## Data flow

```
Paseo app / web / SSH  ->  Paseo daemon (dedicated PASEO_HOME)
  -> plugin paseodog-provider (plugin/server/connection.mjs, journal.mjs)
  -> engine child per session: node engine/bin/paseodog-engine.mjs (JSONL stdio)
  -> engine/src/native-engine.mjs -> patched Mixdog runtime -> model provider + tools
```

Approvals flow back the same way: Mixdog `beforeToolHook` -> host policy -> Paseo permission
request -> allow-once/deny. Usage and context numbers come from Mixdog, never from UI snapshots.

## Version sources of truth

| Question | Source | Check |
|---|---|---|
| Product version | `package.json` `version` (mirrored in `plugin/shared/release.json`, 3 sub-packages + locks) | `tests/version.test.mjs` |
| Accepted upstream base versions | `package.json` `paseodogUpstream` | `paseodog --version` |
| Pinned npm versions | `engine/package.json`, `tools/package.json`, `plugin/package.json` | `npm run upstream:check` |
| Upstream fixes and local patches beyond the base | `docs/UPSTREAM.md` + `scripts/patch-*.mjs` | inventory in [UPSTREAM_INTAKE.md](UPSTREAM_INTAKE.md) |

Runtime layout (daemon homes, ports, reload) is in [RUNTIME_DAEMON.md](RUNTIME_DAEMON.md).

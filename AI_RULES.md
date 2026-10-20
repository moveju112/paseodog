# PaseoDog development rules

PaseoDog joins Paseo (daemon, desktop/mobile/web/SSH clients) and Mixdog (inference, native
sessions) through a Paseo provider plugin. Upstream features/fixes are taken one-way, occasionally, as pins or hash-gated patches.

## Core Rules

- Preserve the integration boundary: Paseo owns clients/daemon, Mixdog owns inference and model history, the adapter owns lifecycle/authorization/journal/wire mapping. Take upstream fixes by pin or patch, never by copying code or editing `node_modules`, sibling checkouts (`~/project/mixdog*`) or personal profiles (`~/.paseo`, `~/.mixdog`) — [UPSTREAM_INTAKE](docs/ai-rules/UPSTREAM_INTAKE.md), [name map](docs/ai-rules/ARCHITECTURE.md).
- Do not replace native model context with UI snapshots. Never replay an uncertain mutating request automatically or infer that interruption undoes side effects.
- Default to ask mode; ask/review tools require explicit approval through the reviewed beforeSessionAsk patch. Only an explicitly selected session bypass mode skips asks. Preserve upstream deny/block and host restrictions in every mode; check rewritten calls and deny missing/stale approvals wherever approval is required.
- Never advertise provider capabilities that are unimplemented. Reject unsupported settings, attachments, ephemeral persistence and exact MCP preapproval. Steering must use the owned native pending-message path, preserve the active turn, persist admission before forwarding, and never automatically replay uncertain delivery. Image support must preserve native Mixdog content parts across the full transport; reject malformed/oversized inputs before accepting a turn, never silently drop them.
- Do not seed personal custom agents or fixed agent models. Keep inherited routes blank, default built-in agents off, and preserve explicit user enable/model choices across configuration, refresh and restart.
- For every UI/behavior change, map applicability across Android, Linux, Windows and web; apply common changes to every applicable platform through shared source for equivalent semantics. State the rationale for platform exceptions; keep native/mobile-only gestures scoped to their native/mobile platforms. Unless the user explicitly requests other targets, build/release artifacts only for Galaxy S25 (Android APK, arm64-v8a) and Linux; this artifact scope does not narrow shared-source behavior compatibility — see [RELEASE](docs/ai-rules/tasks/RELEASE.md).
- No automatic public listener, credential import, cost-incurring test, privilege escalation, repository push or global profile overwrite.
- Keep direct versions and upstream blob gate explicit. No hash-bypass option. Every accepted upstream version, backport or local patch is recorded in `docs/UPSTREAM.md`.
- Run npm run check and npm test for every change. Preserve shared-server responsiveness; do not target CPU saturation. For build resource limits, cache reuse and log retention, follow [RELEASE](docs/ai-rules/tasks/RELEASE.md). Compile with the actual installed SDK and perform live acceptance separately; mocks cannot establish those results. Provider Ready or Desktop "up to date" does not prove a feature works: verify the actual connected host/session capability and distinguish transport tests from real model/UI acceptance. Production acceptance requires the checklist in docs/ACCEPTANCE.md on target hardware.
- Update reports only from commands actually executed. Do not fabricate token savings, tests, account support, native binaries, Android builds or hosted CI success. Keep .local. reports, dependencies, credentials and user state out of release ZIPs.
- For builds, signing, publication and server rollout, follow [RELEASE](docs/ai-rules/tasks/RELEASE.md). Source edits, built artifacts, GitHub publication, installed apps and running server code are separate states; never call one proof of another.
- Run PaseoDog on the dedicated daemon (`paseodog` wrapper). After changing `plugin/`, versions or pins, reload `paseodog-provider` on every daemon that registered it — [RUNTIME_DAEMON](docs/ai-rules/RUNTIME_DAEMON.md).

## Run commands

```bash
npm run check && npm test          # every change
npm run typecheck                  # plugin/*.ts(x), Paseo SDK
npm run upstream:check             # pinned vs npm latest (read-only)
node scripts/patch-mixdog.mjs --check && npm run test:native
paseodog doctor                    # install only, no inference
paseodog plugin reload paseodog-provider && paseodog provider ls
paseodog live-test --confirm-api-use   # billable, operator approval only
npm run package                    # release ZIP
```

## Routing

| Trigger (situation/task) | File |
|---|---|
| locating code, ownership questions, which file holds a version | [docs/ai-rules/ARCHITECTURE.md](docs/ai-rules/ARCHITECTURE.md) |
| writing or reviewing code in `plugin/`, `engine/src/`, `scripts/patch-*`, `tests/` | [docs/ai-rules/CODING_RULES.md](docs/ai-rules/CODING_RULES.md) |
| an error message, provider unavailable, hash drift, failing version test | [docs/ai-rules/PITFALLS.md](docs/ai-rules/PITFALLS.md) |
| choosing/starting a daemon, ports, desktop app, plugin reload, systemd | [docs/ai-rules/RUNTIME_DAEMON.md](docs/ai-rules/RUNTIME_DAEMON.md) |
| building/signing installers, publishing a release, updating an installed app or applying server changes | [docs/ai-rules/tasks/RELEASE.md](docs/ai-rules/tasks/RELEASE.md) |
| asking which Paseo/Mixdog version or fix is already accepted | [docs/ai-rules/UPSTREAM_INTAKE.md](docs/ai-rules/UPSTREAM_INTAKE.md) |
| merging an upstream release, backporting one fix/feature, or patching upstream code locally | [docs/ai-rules/tasks/MERGE_UPSTREAM.md](docs/ai-rules/tasks/MERGE_UPSTREAM.md) |

## File Layout

- Tests: `tests/*.test.mjs` (`node --test`), fixtures `tests/fixtures/`, live/native smokes `tests/*-smoke.mjs`.
- Scripts: `scripts/`; upstream patches `scripts/patch-*.mjs` + `patches/`.
- Docs: UPPERCASE .md under `docs/` = project ops/architecture/upstream records, written by the agent in the same change as the code; UPPERCASE .md under `docs/ai-rules/` = agent rules; `docs/ai-rules/tasks/` = playbooks.
- Reports: `reports/`; `*.local.*` files are never shipped.

<!-- generated by rule-architect -->

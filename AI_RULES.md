# PaseoDog execution contract

This is the canonical project rule file; `AGENTS.md` and `CLAUDE.md` link here. Maintain it directly. `.rule-architect/` is historical metadata, not an instruction to regenerate old rules. This contract governs workflow and authorization throughout the project; nested guides supply technical conventions, not extra delivery gates.

## Scope and completion

- Answer diagnosis/status questions without edits or waiting for unrelated implementation to finish. Implement only the requested outcome; a newly found improvement is not another task.
- Code and project-rule changes include verification and selective commit/push of this task's changes. A review-only or no-commit request overrides this default. Preserve other work.
- No build, publication, install or reload for an ordinary edit. An explicit build/release request retains the full-delivery default: APK, Linux deb/AppImage, Windows installer, existing approved signing, GitHub, dedicated web and this PC. An explicitly narrower request wins; never silently expand it.
- Stop when the requested outcome and its required checks are complete. Report observed results and blockers; source, published artifacts and running installations are separate states.

## Execution

- Start from the relevant diff, error or named symbol. Read linked guides only for a missing decision; no repository survey or mandatory document tour.
- Choose the implementation boundary and checks once. Finish edits before final verification. Reuse passing evidence while its inputs remain valid; do not repeat checks merely to commit or change phases.
- Batch independent reads and checks. Avoid repeated status/diff calls and short wait polling. Do not add work to fill a running test's wait.
- Keep concurrent code work in separate worktrees before edits overlap. Do not temporarily remove another session's lines to stage your own. An existing shared tree is not permission to reset, stash or migrate other work.
- Commit only the completed scope. Do not repair unrelated failures or wait for unrelated feature work; report any integration coverage still blocked.
- Use unique temporary directories under `/data/tmp/ubuntu`. Read ignored `config/rules.local.md` for machine-specific execution settings; never copy its private values into tracked files.

## Safety invariants

- Use pinned upstream versions and version/blob-hash-gated patches. Never hand-edit installed dependencies, runtime profiles or installed app bundles, and never bypass a hash gate.
- Keep ask-mode defaults, deny/block enforcement, ownership checks and persisted receipts. Never replay uncertain mutations or advertise unsupported capabilities.
- Target only the dedicated PaseoDog runtime. Do not interrupt active turns, replace signing keys, expose secrets, mutate personal/stock profiles or run billable tests without specific authorization.

## Read only the relevant guide

| Need | Guide |
|---|---|
| Implementation contracts and check selection | [CODING_RULES](docs/ai-rules/CODING_RULES.md) |
| Authorized build/release | [RELEASE](docs/ai-rules/tasks/RELEASE.md) |
| Authorized runtime apply or runtime diagnosis | [RUNTIME_DAEMON](docs/ai-rules/RUNTIME_DAEMON.md) |
| Unknown component ownership / known failure | [ARCHITECTURE](docs/ai-rules/ARCHITECTURE.md) / [PITFALLS](docs/ai-rules/PITFALLS.md) |

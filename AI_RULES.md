# PaseoDog execution contract

This is the canonical project rule file; `AGENTS.md` and `CLAUDE.md` link here. Maintain it directly. `.rule-architect/` is historical metadata, not an instruction to regenerate old rules. This contract governs workflow and authorization throughout the project; nested guides supply technical conventions, not extra delivery gates.

## Scope and completion

- Answer diagnosis/status questions without edits or waiting for unrelated implementation to finish. Implement only the requested outcome; a newly found improvement is not another task.
- Code and project-rule changes include verification, a selective commit of this task's changes on a task branch, a push of that branch and a pull request to `main` (`gh pr create`). After CI passes for the exact PR head and all required reviews and branch protections are satisfied, merge that task's PR into `main` without further approval (`gh pr merge --match-head-commit <verified-sha>`). This is standing authorization for task-scoped PR merges, not unrelated PRs. Pending or absent CI is not success; failures, conflicts or unmet review requirements block merging and must be reported. Never bypass protections or use an admin override. A review-only, no-commit or no-merge request overrides this default. Preserve other work.
- Never push directly to `main`; the release executor's own metadata commit during an explicitly requested release remains the only exception. A PR merge does not authorize a build, release, deployment, installation or runtime reload.
- No build, publication, install or reload for an ordinary edit. An explicit build/release request delivers only the targets (APK, desktop deb/AppImage/Windows, dedicated web, this PC's daemon) changed since each target's actually deployed baseline, including other sessions' pushed commits; unknown baselines or paths fall back to that target's full delivery. An explicit "전체"/full or narrower target request wins; never silently expand it.
- Stop when the requested outcome and its required checks are complete. Report observed results and blockers; source, published artifacts and running installations are separate states.

## Execution

- Start from the relevant diff, error or named symbol. Read linked guides only for a missing decision; no repository survey or mandatory document tour.
- Choose the implementation boundary and checks once. Finish edits before final verification. Reuse passing evidence while its inputs remain valid; do not repeat checks merely to commit or change phases.
- Before dependency-backed checks, verify the required package entry points in the active checkout; a linked `node_modules` directory alone is not evidence that dependencies are installed. If packages are missing, distinguish checkout setup from code failures.
- Restoring development/test dependencies from the existing lockfile is part of requested implementation or verification, not runtime installation. Use the relevant dependency-only steps in `scripts/install.mjs`; inspect symlink targets and lifecycle effects first, and never run the full installer, upgrade versions, or replace a shared dependency tree used by another task/runtime. Prepare an isolated candidate when shared-tree replacement would be required.
- A missing dependency is a verification blocker, not a completed check. Restore the authorized test environment and rerun blocked checks before marking the task ready; if recovery needs unavailable access or unsafe mutation, report the precise blocker and leave verification explicitly incomplete.
- Batch independent reads and checks. Avoid repeated status/diff calls and short wait polling. Do not add work to fill a running test's wait.
- A background shell command is not an autonomous continuation. If its result is needed for this task's next analysis, edit or verification, keep ownership: finish independent work, use `task wait`, inspect the outcome, and continue in the same turn. A wait ceiling or background transition is not a completion boundary.
- Before a final reply, account for task-owned pending shell and delivery work. A background transition, service start or completion notification is not task completion. Keep ownership, inspect results and perform authorized recovery until the requested outcome is verified; stop incomplete work only for an explicit user pause or a genuine blocker. Exception: an idle-gated PC/runtime apply on the runtime hosting this session cannot proceed while this turn is active. Once every earlier delivery stage is complete and the log shows `waiting for idle`, cancel task-owned waits and end the turn. Report the published results and the pending apply, then confirm the apply with `--status` on the next turn.
- On interruption/resume, inspect the recorded task/service outcome before deciding whether to wait or recover; never blindly repeat a mutation. Do not claim automatic AI analysis or repairs unless they are implemented.
- Keep concurrent code work in separate worktrees before edits overlap. Do not temporarily remove another session's lines to stage your own. An existing shared tree is not permission to reset, stash or migrate other work.
- Commit only the completed scope. Do not repair unrelated failures or wait for unrelated feature work; report any integration coverage still blocked.
- Use unique temporary directories under the scratch root (`scratchRoot` in `scripts/paths.mjs`: `PASEODOG_TMP`, else `/data/tmp/ubuntu` when it exists, else the OS temp directory). Read ignored `config/rules.local.md` (template: `config/local-rules.example.md`) for machine-specific execution settings; never copy its private values into tracked files.

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

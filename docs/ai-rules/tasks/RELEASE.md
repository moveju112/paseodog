# Release execution contract

Only for an explicit build/release request. Read ignored `config/rules.local.md` for machine/cache/signing settings. Use a clean dedicated source checkout/worktree, not a tree another session is editing. Source checkout and output workspace are distinct.

## Prepare and start once

1. Finish approved code edits before release. For a new build from already-pushed source, add `--next-version --start` to the preparer: it first plans targets (stopping when nothing is deployable, skipping versioning without APK/desktop targets), then selects a code above source/installed/recent published and draft releases, updates release metadata/changelog/hashes, commits only those three files and pushes without force or retry. A dirty tree, Git failure or uncertain prior delivery stops preparation; preserve its state for inspection. It then verifies and builds the new exact commit. Without `--next-version`, prepare explicit version metadata before verification. Do not change the prebuild fallback offset. Reuse the dedicated prepared source worktree; do not copy dependencies or native build directories for each release.
2. Use `npm run deliver:prepare -- --config <absolute-host-profile.json> --commit <exact-pushed-commit> --start`. The profile extends the configuration below with `sourceRoot`, `previousWorkspace` for first adoption, and optional `androidHome`/`wineBin`. `--adopt` registers an existing dedicated worktree once, after checking its previous delivery is inactive. The preparer refuses dirty/foreign/active worktrees, fast-forwards only, and prebuilds only for changed native configuration. It never copies dependencies or installs/upgrades packages; missing setup is a blocker.
3. Run affected-path lint and necessary package checks not covered by the executor. For implementation before commit, use `npm run deliver:release -- --config <absolute-config.json> --verify-only`, then commit/push the same source bytes. For already-pushed release work, let the prepared-source service do verification; do not also run it manually.
4. The preparer starts the independent user-systemd delivery service. The lower-level `deliver:release -- --config <absolute-config.json> --start` remains available when the dedicated source is already prepared. Do not invoke both paths for one request.
5. Keep ownership until the requested verification and publication are confirmed. Inspect the service outcome and perform authorized recovery; starting an independent service is not completion. PC/runtime apply waits for every turn, including the requesting one. Once the log shows `Publication complete; waiting for idle` and all earlier stages are complete, cancel task-owned waits and end the turn, reporting the pending apply. Holding the turn deadlocks the apply. Confirm `pc-install`/`runtime-update`/`pc-launch` with `--status` on the next turn.

## Change-based targets

- The executor's `plan` stage selects `android`, `desktop`, `web` and `runtime` from `git diff` between each target's deployed baseline and the delivered commit (`scripts/release-targets.mjs`). Do not choose targets from session memory; other sessions' pushed commits are included automatically.
- Baselines: versions named by the updater manifests in GitHub latest (`paseodog-android-update.json`, `latest-linux.yml`/`latest.yml`) mapped to their release commits; the installed `paseodog` deb version (a lagging PC widens desktop); `delivery-ledger.json` in `cacheRoot` for Pages; the daemon updater receipt for runtime. A missing or incomparable baseline, or an unmapped path, delivers that target in full.
- Release metadata, docs, tests and release tooling deploy nothing. Without changes the preparer stops before versioning; web/runtime-only deliveries create no GitHub release and do not advance the app version.
- When only one of APK/desktop changed, the new GitHub latest carries the other platform's previous updater manifest (and desktop installers) unchanged, so in-app updaters see no false update.
- App/server sources, `protocol` and the Android lockfiles also count as `runtime`: daemon web patches embed them. Root tests stay in every verify because they validate those patches.
- Daemon updaters on each host call `scripts/runtime-changes.mjs` from the new revision. Commits without runtime changes move the applied candidate in place without preparation or daemon restart (a release-metadata change only reloads the provider plugin when idle). Delivery writes `preverified.json` so the local updater skips root tests for the verified revision; other hosts keep their own verification. Updaters keep the newest three candidates plus any candidate referenced by the receipt, rollback backup or a running process.
- `--targets full` or `--targets android,desktop,web,runtime` (any subset) overrides the plan for an explicit full or narrower request. With `updaterRoot`/`updaterUnit` in the host profile, runtime delivery starts the existing daemon updater after idle and verifies its applied revision contains the delivered commit.

## Exceptions only

- Do not manually replay successful verification, build, upload, publication or apply stages. Do not ask for approval again within the existing scope; new credentials, force-kill and destructive recovery remain separate boundaries.
- Use `--status` and the failed stage's log, not repeated polling, repository surveys or full-log rereads. Reuse passing checks only while their inputs match.
- Inspect service/checkpoint state before resuming a stopped delivery. `--unlock-stopped` rejects live owners. An uncertain mutation requires remote/runtime reconciliation and authorization covering the exact retry before `--execute --retry-stage <name>`.
- If source must change, create the next verified commit/workspace; retain old checkpoints/artifacts. Do not copy receipts to force a cache hit.
- Do not hand-assemble an alternative delivery pipeline when the executor fails. Fix its demonstrated defect within authorization or report the blocker. An explicitly requested partial build uses the appropriate existing build script without publication.

Keep the JSON configuration in the unique release workspace, never in Git:

```json
{
  "workspace": "/data/tmp/ubuntu/paseodog-release-<unique>",
  "cacheRoot": "<absolute reusable cache from local rules>",
  "signingInit": "<absolute approved signing init>",
  "signingKey": "<absolute existing key>",
  "previousApk": "<absolute previously published signed APK>",
  "androidTools": "<absolute SDK build-tools version directory>",
  "metroWorkers": "2",
  "appTests": ["src/<affected behavior>.test.ts"],
  "repo": "moveju112/paseodog",
  "pagesProject": "paseodog",
  "webUrl": "https://paseodog.choondoggy.com/"
}
```

## Executor boundary and completion

- `appTests` must name real relevant tests. Before expensive checks, preflight validates signing paths, installed lock versions and actual agent-message patch inputs. Successful syntax/root/plugin/app checks are saved independently under `cacheRoot/verification-v2`, including timings; failure in one check does not discard successes in the others. Root tests also retain successful file receipts under the same immutable input key; a retry reruns only failed files, with at most four workers.
- Reuse is input-bound: root checks conservatively include the whole source and installed lock/composer/message inputs; plugin types include plugin/engine/root package inputs; app checks include Android/shared plugin/root package inputs. The app-test list invalidates only that check. Node/options/platform/architecture and `verificationEpoch` are part of every key. Changing dependencies outside pinned lockfiles requires increasing the host profile's `verificationEpoch`; never alter receipts manually.
- Keep the existing cache layout and worker limits, at most two heavyweight build tasks. Do not add another packager to fill apparent idle time.
- Existing-key continuity, artifact hashes/version/ABI, GitHub assets, browser/deep-link checks and dedicated runtime readiness remain delivery requirements. Missing credentials, unsupported signing and failed checks must be explicit.
- Dedicated PC/runtime apply waits for idle. Graceful shutdown, ownership verification and failure recovery remain required.
- Report executor-observed source commit, artifacts/signature status, publication, Pages and installed/running versions separately. Do not claim the runner guarantees anything beyond its observed checks.
- Acceptance target: at most 300 seconds from the user's build request through artifacts, publication, web and server apply. Include preparation, verification, queue/idle waits and retries; never redefine this as time to start building. Report overruns as unmet, not success. The operational goal is one delivery start with no AI intervention on successful stages; a sample or warm verification is not full-delivery evidence.

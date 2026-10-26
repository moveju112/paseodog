# Release execution contract

Only for an explicit build/release request. Read ignored `config/rules.local.md` for machine/cache/signing settings. Use a clean dedicated source checkout/worktree, not a tree another session is editing. Source checkout and output workspace are distinct.

## Prepare and start once

1. Finish approved code edits before release. For a new build from already-pushed source, add `--next-version --start` to the preparer: it selects a code above source/installed/recent published and draft releases, updates release metadata/changelog/hashes, commits only those three files and pushes without force or retry. A dirty tree, Git failure or uncertain prior delivery stops preparation; preserve its state for inspection. It then verifies and builds the new exact commit. Without `--next-version`, prepare explicit version metadata before verification. Do not change the prebuild fallback offset. Reuse the dedicated prepared source worktree; do not copy dependencies or native build directories for each release.
2. Use `npm run deliver:prepare -- --config <absolute-host-profile.json> --commit <exact-pushed-commit> --start`. The profile extends the configuration below with `sourceRoot`, `previousWorkspace` for first adoption, and optional `androidHome`/`wineBin`. `--adopt` registers an existing dedicated worktree once, after checking its previous delivery is inactive. The preparer refuses dirty/foreign/active worktrees, fast-forwards only, and prebuilds only for changed native configuration. It never copies dependencies or installs/upgrades packages; missing setup is a blocker.
3. Run affected-path lint and necessary package checks not covered by the executor. For implementation before commit, use `npm run deliver:release -- --config <absolute-config.json> --verify-only`, then commit/push the same source bytes. For already-pushed release work, let the prepared-source service do verification; do not also run it manually.
4. The preparer starts the independent user-systemd delivery service. The lower-level `deliver:release -- --config <absolute-config.json> --start` remains available when the dedicated source is already prepared. Do not invoke both paths for one request.
5. End the initiating turn after confirming the service started. Report delivery as running, not complete. The independent service waits for idle before PC/runtime apply; do not keep the initiating turn active while waiting for it.

This turn-ending exception applies only to the full delivery service above, whose remaining steps and failure state are already implemented. A standalone build, test, benchmark, or log watcher is not that service. If its result determines further analysis or code changes, use `task wait`, inspect the result and continue; do not end the turn merely because the command moved to the background. A completion notification does not schedule the next AI action.

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

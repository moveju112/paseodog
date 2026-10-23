# Release execution contract

Only for an explicit build/release request. Read ignored `config/rules.local.md` for machine/cache/signing settings. Use a clean dedicated source checkout/worktree, not a tree another session is editing. Source checkout and output workspace are distinct.

## Prepare and start once

1. Finish approved edits, version metadata and changelog before verification. `versionCode` must exceed published and installed versions; do not change the prebuild fallback offset.
2. Reuse installed pinned dependencies and the existing build cache. Missing setup is a blocker, not permission to upgrade packages. Only for native configuration/dependency changes, run `CI=1 APP_VARIANT=production npx expo prebuild --platform android --no-install` in `android/packages/app` before verification; ordinary JS/UI edits do not need prebuild.
3. Run affected-path lint and necessary package checks not covered by the executor. Run `npm run deliver:release -- --config <absolute-config.json> --verify-only`, then commit/push the same source bytes.
4. Run `npm run deliver:release -- --config <absolute-config.json> --start` once. It starts an independent user-systemd service; without `--start` or `--execute`, the command only prints a plan.
5. End the initiating turn after confirming the service started. Report delivery as running, not complete. The service waits for active turns, including this one, before apply.

## Exceptions only

- Do not manually replay successful verification, build, upload, publication or apply stages. Do not ask for approval again within the existing scope; interruption, new credentials and destructive recovery remain separate boundaries.
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

- `appTests` must name real relevant tests; the current executor requires a nonempty list. It verifies root checks/tests and plugin/app types. Source fingerprints cover tracked/nonignored files and Node, not ignored dependency contents; changed dependencies require fresh verification.
- Keep the existing cache layout and worker limits, at most two heavyweight build tasks. Do not add another packager to fill apparent idle time.
- Existing-key continuity, artifact hashes/version/ABI, GitHub assets, browser/deep-link checks and dedicated runtime readiness remain delivery requirements. Missing credentials, unsupported signing and failed checks must be explicit.
- PC/runtime apply waits for all active turns, currently up to one hour. This is **apply wait**, not build time. Timeout leaves apply incomplete; it never authorizes interruption or force-kill.
- Report executor-observed source commit, artifacts/signature status, publication, Pages and installed/running versions separately. Do not claim the runner guarantees anything beyond its observed checks.
- Measure request-to-completion separately from verification, packaging, upload and idle wait. The operational goal is one verification and one delivery start, with no AI intervention on successful stages. A four-test speedup is not full-delivery evidence.

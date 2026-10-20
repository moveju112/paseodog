# Upstream Intake (Paseo / Mixdog)

Intake is **one-way and occasional**: PaseoDog selectively takes new features and bug fixes
from Paseo and Mixdog; it never sends changes back. Four kinds of intake:

- **Base version** — the whole upstream npm release PaseoDog is built on.
- **Backport** — one upstream fix or feature (PR/commit) applied on top of the base by a hash-gated patch.
- **Local patch** — PaseoDog's own change to upstream code (e.g. the `beforeSessionAsk` hook); permanent, re-ported on every base upgrade.
- **Dependency override** — a transitive security fix via `overrides` in a sub-package, without changing the base.

Step-by-step merge: [tasks/MERGE_UPSTREAM.md](tasks/MERGE_UPSTREAM.md).

## How to answer "how far upstream is accepted?"

```bash
node bin/paseodog.mjs --version          # PaseoDog X (Paseo <base>, Mixdog <base>)
npm run upstream:check                   # pinned vs npm latest; reviewRequired=true -> newer upstream exists
node scripts/patch-mixdog.mjs --check    # installed Mixdog still carries every pinned patch
```

Then read `docs/UPSTREAM.md`: the version table (base), "Selected Paseo backports" and
"Local Paseo patches" (changes beyond the base). A fix not listed there is NOT accepted, even if similar code exists.

| Record | Holds | evidence |
|---|---|---|
| `package.json` `paseodogUpstream` | accepted base versions | `evidence: package.json` `paseodogUpstream` |
| `plugin/shared/release.json` | same values, read by the running plugin | `evidence: plugin/server/util.mjs` `UPSTREAM_VERSIONS` |
| sub-package pins + locks | exact npm versions installed | `evidence: scripts/check-upstream.mjs` `checkUpstream()` |
| `scripts/patch-mixdog.mjs` `PIN` / blobs | Mixdog version + exact original blobs patched | `evidence: scripts/patch-mixdog.mjs` `PIN`, `AGENT_PATCHES` |
| `scripts/patch-paseo-*.mjs` hashes | Paseo files patched and their reviewed originals | `evidence: scripts/patch-paseo-terminal.mjs` `ORIGINAL_HASH` |
| `tools/package.json` `overrides` | transitive dependency fixes | `evidence: tools/package.json` `overrides` |
| `docs/UPSTREAM.md` | base table, backports with PR links, local patches, overrides | `evidence: docs/UPSTREAM.md` all sections |
| `CHANGELOG.md` | which product release took which intake | `evidence: CHANGELOG.md` per-release entries |

## Patch inventory

Every hash-gated change to upstream code, as of this rule set. `ls scripts/patch-*.mjs` is the
ground truth; a script missing here or from `docs/UPSTREAM.md` is an unrecorded intake.

| Script | Changes | Origin | Applied by |
|---|---|---|---|
| `patch-mixdog.mjs` | Mixdog runtime: `beforeSessionAsk` host boundary + `AGENT_PATCHES`; explicit no-injection `default` output style; same-model context window persistence through native route update | local | `scripts/install.sh` |
| `patch-paseo-cli.mjs` | CLI waits for permission-response ack | Paseo PR #6607 | `tools` `postinstall` |
| `patch-paseo-terminal.mjs` | server terminal wide-char cells | Paseo PR #6452 | `tools` `postinstall` |
| `patch-paseo-usage.mjs` | server built-in Claude usage -> Mixdog usage; omit Copilot usage card, preserve providers | local | `scripts/install.sh` |
| `patch-paseo-steer.mjs` | server `plugin-provider.js` steering guard | local | `scripts/install.sh` |
| `patch-paseo-workspace-name.mjs` | server: new workspaces default to the project display name; no prompt/AI workspace titles (worktree AI branch rename kept) | local | `scripts/install.sh` |
| `patch-paseo-composer.mjs` (+ `patch-paseo-theme.mjs`, `patches/paseo-collaboration.mjs`, `patches/paseo-agent-progress.mjs`, `patches/paseo-sidebar-toolbar.mjs`, `patches/paseo-help-menu.mjs`, `patches/paseo-usage-colors.mjs`, `patches/paseo-usage-order.mjs`, `patches/paseo-hide-reasoning.mjs`) | preserve native composer steering + White2 theme + host-wide collaboration switch beside permission mode + current-session child-job pill before the diff pill + PaseoDog analysis icon in the bottom-left sidebar toolbar + help menu without the report-issue group (Discord/GitHub issue; shared PC/compact/mobile web) + sidebar quota gauge fill using host `windowTone` threshold colors + fixed sidebar quota source order (Codex, Claude, rest) with weekly `wk` shown as `7D` + display-only "Hide reasoning" chat setting (default off) + suppress the worktree setup promotion while retaining manual project settings | local | `scripts/install.sh`; desktop bundle via `scripts/desktop-release.mjs` |
| `patch-paseo-android.mjs` | Android terminal input in a separate Paseo source checkout | local, opt-in | manual `--apply <checkout>` (`docs/ANDROID-TERMINAL.md`) |

## Rules

- **MUST** change all base-version records in one change: `paseodogUpstream`, `plugin/shared/release.json`, the three sub-package pins and their lockfiles, and the `docs/UPSTREAM.md` table.
  - why: `tests/version.test.mjs` asserts they agree; a partial bump makes the running plugin report the engine as a version mismatch.
  - ✅ `evidence: tests/version.test.mjs` — `assert.deepEqual(UPSTREAM_VERSIONS, root.paseodogUpstream)`; the next line pins Mixdog to `PIN`.

- **MUST** record every backport and local patch in `docs/UPSTREAM.md` (upstream PR/commit link or "local", the patch script, what it changes), add its row to the inventory above, and add a `CHANGELOG.md` line — in the same change, by the agent making it. Mixdog backports get a "Selected Mixdog backports" section in the same file.
  - why: the pinned npm version cannot show fixes taken beyond it, and these records are agent-maintained; nobody fills them in later.
  - ✅ `evidence: docs/UPSTREAM.md` § "Selected Paseo backports" (PR #6607, #6452) and § "Local Paseo patches".

- **MUST** upgrade `@getpaseo/cli` and `@getpaseo/plugin` together.
  - why: `upstream:check` fails when the two Paseo pins differ.
  - ✅ `evidence: scripts/check-upstream.mjs` — throws `Paseo CLI/SDK pins differ`

- **NEVER** re-target an old patch at new upstream source by changing only its hash.
  - why: hashes prove the reviewed original; an edited hash skips the review the gate exists for.
  - ✅ `evidence: docs/UPSTREAM.md` § "Upgrade procedure" — re-review the new file, then regenerate fixture + hash.
  - ✅ no hash-bypass flag exists; never add one (`evidence: docs/UPSTREAM.md` § "Reviewed host boundary patches").

- **MUST** delete a backport patch once the new base version contains that fix, and move its ledger line to the base-version note.
  - why: a patch whose anchor is already fixed upstream fails closed on the next install.
  - ✅ `evidence: docs/UPSTREAM.md` § "Upgrade procedure" — "remove it when an upstream fix is verified."

- **NEVER** open PRs/issues or push to the Paseo or Mixdog repositories, and never plan work around "upstream will merge our fix".
  - why: intake is one-way by owner decision; a local change to upstream code stays a hash-gated local patch indefinitely.
  - ✅ the patcher "never pushes an upstream commit" (`evidence: docs/UPSTREAM.md` § "Reviewed host boundary patches").

- **NEVER** copy upstream implementation into `plugin/` or `engine/src/` to "merge" a fix.
  - why: copied code drifts and blocks the next base upgrade; ship a hash-gated patch instead.
  - ✅ `evidence: docs/UPSTREAM.md` § "Upgrade procedure"

- **MUST** review one upstream component at a time and keep unrelated local changes.
  - why: a combined Paseo+Mixdog bump makes a failing gate unattributable.
  - ✅ `evidence: docs/UPSTREAM.md` § "Upgrade procedure"

After any intake that changes `plugin/` or versions, reload the live plugin; never run
`scripts/install.sh` just to try an upgrade — both in [RUNTIME_DAEMON.md](RUNTIME_DAEMON.md).

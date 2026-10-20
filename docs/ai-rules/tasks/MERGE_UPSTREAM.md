# Task: Merge a Paseo or Mixdog upstream change

Use for a new upstream base version, a single upstream fix/feature, or a local patch. Rules and the record
list: [../UPSTREAM_INTAKE.md](../UPSTREAM_INTAKE.md). One component (Paseo or Mixdog) per change.

## A. See what is already accepted

1. Read the accepted base: `node bin/paseodog.mjs --version`; source is `package.json` `paseodogUpstream`.
   `evidence: package.json` `paseodogUpstream`
2. Compare pins with npm latest (read-only): `npm run upstream:check`. `reviewRequired: true` means upstream is newer.
   `evidence: scripts/check-upstream.mjs` `reviewRequired`
3. List what is already taken in `docs/UPSTREAM.md` "Selected Paseo backports" and "Local Paseo patches" (and Mixdog sections if present). Anything absent is not accepted.
   `evidence: docs/UPSTREAM.md` § "Selected Paseo backports"

## B. Base-version upgrade

4. Review the upstream diff of every patched file before touching pins — the inventory in [../UPSTREAM_INTAKE.md](../UPSTREAM_INTAKE.md) lists them (Mixdog files in `AGENT_PATCHES`).
   `evidence: scripts/patch-mixdog.mjs` `AGENT_PATCHES`
5. Update pins and lockfiles together. Paseo: `tools` (`@getpaseo/cli`) and `plugin` (`@getpaseo/plugin`) to the same version. Mixdog: `engine` (`mixdog`) and `PIN`.
   `evidence: scripts/check-upstream.mjs` — `Mixdog patch pin mismatch`
6. For each patch whose original changed: re-port the edit against the new source, regenerate the retained fixture and hash from the inspected file. Delete patches the new base already fixes.
   `evidence: docs/UPSTREAM.md` § "Upgrade procedure" step 4
7. Update `paseodogUpstream`, `plugin/shared/release.json`, sub-package `version`s and the `docs/UPSTREAM.md` table in the same change.
   `evidence: tests/version.test.mjs` — "independent product version and upstream provenance stay consistent"

## C. Single upstream fix/feature or local patch (no base change)

8. Add or extend a `scripts/patch-*.mjs` with: upstream PR/commit in the header comment (or "local" for a PaseoDog-origin change), base version constant, exact original hash, `--apply|--check`.
   `evidence: scripts/patch-paseo-terminal.mjs` header comment
9. Wire it next to its siblings: `tools` `postinstall` (CLI/terminal), `scripts/install.sh` apply + `--check` pair (server/web UI, Mixdog), `scripts/desktop-release.mjs` if the desktop bundle needs it.
   `evidence: scripts/install.sh` `patch-paseo-usage.mjs` / `--check` pairs
10. In the same change, write the ledger line in `docs/UPSTREAM.md` (backport -> "Selected Paseo backports", local -> "Local Paseo patches"; Mixdog -> matching Mixdog section), the inventory row, and a `CHANGELOG.md` entry.
    `evidence: docs/UPSTREAM.md` § "Local Paseo patches"

## D. Verify (both paths)

11. `npm run check && npm test`; add `npm run typecheck` for Paseo SDK changes.
    `evidence: package.json` scripts `check`, `test`
12. Mixdog: `node scripts/patch-mixdog.mjs --check` and `npm run test:native` (local fixture provider, no billing).
    `evidence: docs/UPSTREAM.md` § "Reviewed host boundary patches"
13. Live/model/mobile acceptance only with operator approval: `paseodog live-test --confirm-api-use`, then `docs/ACCEPTANCE.md`.
    `evidence: docs/UPSTREAM.md` § "Upgrade procedure" step 5
14. Reload `paseodog-provider` on every daemon that registered it, then `paseodog provider ls` -> `available`. Ask first if agents are running.
    `evidence: plugin/server/provider.ts` `status()`

Never run `scripts/install.sh` to try an upgrade — see [../RUNTIME_DAEMON.md](../RUNTIME_DAEMON.md).

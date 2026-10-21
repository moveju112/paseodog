# Coding rules

Scope: `plugin/`, `engine/src/`, `scripts/`, `patches/`, `tests/`. Inside `android/` follow that tree's TS/oxfmt/oxlint conventions, but still add Korean flow comments to files PaseoDog adds.

## Style

- **MUST** write root code as ESM .mjs, 4-space indent, English camelCase identifiers, and a one-line Korean flow comment above each new function.
  - why: the whole repo uses this shape; review checks intent via the comment.
  - ✅ `evidence: scripts/patch-paseo-composer.mjs:43` — `// 기존 첨부파일·대기열 저장 및 배출 로직을 유지하면서 ...`
- **MUST** run CLI scripts directly only behind the `process.argv[1] === fileURLToPath(import.meta.url)` guard; end failures by printing `error.message` + `process.exitCode = 1`.
  - why: tests import the same module and check it per function.
  - ✅ `evidence: scripts/check-upstream.mjs:46`
- **NEVER** import anything beyond `node:` built-ins and local modules in `plugin/server/*.mjs`. Use the Paseo SDK only in `plugin/server/provider.ts` / `plugin/index.server.ts`.
  - why: the engine child process imports the same files directly.
  - ✅ `evidence: plugin/server/provider.ts:8` — `import { VERSION } from './util.mjs';`

## Upstream patches

- **MUST** modify upstream files only via `scripts/patch-*.mjs` + `patches/*.mjs`: verify the exact base version and original git blob hash before writing, leave already-patched bytes unchanged, and make `--check` fail without writing.
  - why: never silently overwrite upstream changes; catch drift at install time.
  - ❌ editing `node_modules`, `~/.paseo`, `~/.mixdog` or sibling checkouts directly; changing only the hash to pass.
  - ✅ `evidence: scripts/patch-paseo-usage.mjs:9` — `if (manifest.version !== '0.11.4') throw ...`, `evidence: scripts/patch-paseo-usage.mjs:23` blob constant.
- **NEVER** add a hash-bypass option or a "continue on mismatch" branch.
  - why: a patch is only meaningful against the reviewed original.
  - ✅ drift throws `throw new Error('... hash mismatch' | 'anchor mismatch' | 'Partial ... patch')`. `evidence: patches/paseo-usage-donut.mjs:168`
- **MUST** wire a web-bundle UI patch into BOTH the unwrap order and the apply order of `scripts/patch-paseo-composer.mjs`.
  - why: the composer patch checks one whole-bundle hash: it strips every patch to the original, checks, then reapplies in reverse.
  - ✅ `evidence: scripts/patch-paseo-composer.mjs:45` (unwrap) · `evidence: scripts/patch-paseo-composer.mjs:47` (apply)
- **MUST** on an upstream base-version change, update in ONE change: `engine`/`tools`/`plugin` pins and lockfiles, `PIN`, `paseodogUpstream`, `release.json`, and each patch's version/blob/fixture. Paseo and Mixdog may be raised together.
  - why: `npm run upstream:check` and `tests/version.test.mjs` fail partial updates.
  - ✅ `evidence: scripts/check-upstream.mjs:39` — `Mixdog patch pin mismatch`

## UI/behavior changes

- **MUST** change Paseo UI in shared app source (`android/packages/app/src/...`) AND the web-bundle patch (`patches/paseo-<기능>.mjs`) with the same meaning, and check both sides match with a root test.
  - why: APK/.deb ship from source, the pinned web bundle ships via the patch; changing one side makes platforms diverge.
  - ✅ `evidence: tests/usage-donut.test.mjs:34` — runs `donut-model.ts` with types stripped and compares it to the patch output.
- **MUST** for every UI/behavior change, decide Android/desktop/web applicability and apply common semantics to every applicable platform through shared source. Report platform-exception reasons.
  - why: one shared source builds into several clients.
  - ✅ `evidence: android/packages/app/plugins/with-android-architectures.js:7` — platform-only differences are isolated in branches/plugins.

## Runtime safety

- **NEVER** change the default session mode away from `ask`, or ignore upstream deny/block in any mode. `bypass` skips asks only when explicitly selected.
  - why: development-work approval and the product's runtime approval gate are separate.
  - ✅ `evidence: engine/src/policy.mjs:22` — `mode = 'ask'`
- **NEVER** auto-resend an uncertain mutating request. Persist the receipt before inference; leave interrupted turns as `uncertain`.
  - why: interruption does not undo side effects.
  - ✅ `evidence: plugin/server/connection.mjs:246` — marks a running receipt `uncertain`.
- **NEVER** advertise an unimplemented provider capability in `CAPABILITIES`. Reject unsupported inputs/settings before accepting a turn.
  - why: clients trust advertised capabilities and open UI for them.
  - ✅ `evidence: plugin/server/connection.mjs:9`
- **NEVER** seed personal custom agents or fixed agent models as defaults. Preserve the user's explicit choices across config refresh and restart.
  - why: the release would force one user's environment on everyone.
  - ✅ built-in agents default off; inherited routes stay blank.

## Release source list

- **MUST** add each new file the source ZIP needs (root tests/scripts import it) to `MANIFEST.sha256`.
  - why: `package.py` packs only manifest paths; `android/` is an allowed root folder.
  - ✅ `evidence: scripts/package.py:16` — `ROOT_FOLDERS` includes `"android"`.

## Checks

- **MUST** run `npm run check && npm test` at the root only when files outside `android/` changed or a root test reads the changed `android/` file (`MANIFEST.sha256`-listed or imported by `tests/`), plus `npm run typecheck` for plugin TS changes. For other `android/` changes run only that package's typecheck, `npm run lint -- <변경 경로>` in `android/`, and related Vitest.
  - why: root `npm test` runs only `tests/*.test.mjs`, not the `android/` monorepo tests.
  - ✅ `evidence: package.json:12` — `"test": "node --test tests/*.test.mjs"`
- **MUST** write tests with `node:test` + `node:assert/strict`; keep pinned upstream originals in `tests/fixtures/`. NEVER run billable smokes (`*-smoke.mjs`, `paseodog live-test --confirm-api-use`) without user approval.
  - why: root tests must be free and deterministic to run in CI.
  - ✅ `evidence: tests/version.test.mjs:1`

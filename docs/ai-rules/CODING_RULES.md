# Implementation and verification

## Implementation contracts

- Fix the demonstrated behavior at its owning layer; do not add speculative fallbacks, duplicate state or unrelated cleanup. Inspect a reused function's contract when its side effects are unclear.
- Root JavaScript uses ESM `.mjs`, four-space indentation and English identifiers. Use Korean comments for non-obvious intent. Follow existing TypeScript/formatter conventions under `android/`.
- Importable CLI modules must guard their entry point and return a failing exit status on errors. `plugin/server/*.mjs` accepts only built-ins and local modules because the engine imports it directly.
- Upstream modifications use `scripts/patch-*.mjs` plus `patches/*.mjs`: exact version/blob verification, idempotent apply, read-only `--check`, rejection of drift/partial patches.
- A composer patch needs apply and unwrap integration, including affected reversal tests. Do not change a hash just to accept unexpected bytes.
- A shared UI change must have matching semantics in `android/packages/app/src` and the applicable web patch. Test the behavior on both paths; explicitly identify genuine platform exceptions.
- An approved upstream upgrade updates pins, lockfiles, `PIN`, `paseodogUpstream`, release metadata and affected patch fixtures together.

## Check selection

Select by behavior and dependency impact, not the number of files or whether Git is about to commit. A documentation edit is not a reason to execute code suites.

| Change | Required evidence |
|---|---|
| Docs / project rules only | Diff/whitespace, local links, instruction consistency; changed manifest entries if applicable. No app types, root suite or build. |
| Isolated root implementation | Regression tests for the changed contract and direct consumers via `npm test -- --files <comma-separated-test-paths>`; syntax check changed JS. |
| Plugin TypeScript | Related behavior tests plus root `npm run typecheck`. |
| Android source | Affected package typecheck, targeted Vitest, and `npm run lint -- <changed-code-paths>` from `android/`; format only changed code through its npm script. |
| Shared app + web patch | Both behavior tests, patch idempotence/hash rejection and affected apply/unwrap consumers. |
| Shared test harness, global patch chain, cross-cutting runtime/protocol, pins/locks, packaging or release executor | Root `npm run check && npm test` once, plus affected package checks. Add specialized checks only for changed contracts. |
| Authorized release | Use the release executor's verification receipt as described in [RELEASE](tasks/RELEASE.md); do not also run the same checks manually. |

- Use existing test suites and fixtures. Root tests use `node:test`/`node:assert/strict`; app/server tests use their existing Vitest scripts. Test outcomes, error paths and security boundaries, not just source spelling.
- A focused selection must include direct consumers; when impact cannot be bounded, use the relevant full suite. Smaller coverage is not a substitute for a required failing check.
- Heavy root runs use `scripts/test.mjs` through `npm test` so the Linux lock is shared. Do not bypass it or start a second competing benchmark.
- Freeze the changed scope before final checks. Rerun only evidence invalidated by subsequent changes. Report unrelated failures without fixing them.
- For performance claims, compare the same inputs without competing heavy work. Report setup, queue and execution separately; a sample is not full-delivery evidence.
- Do not run billable/device smokes by default. Missing dependencies or credentials are blockers, not permission to upgrade packages or use real accounts.
  - ✅ `evidence: tests/version.test.mjs:1`

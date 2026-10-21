# Coding Rules

Layout and ownership: [ARCHITECTURE.md](ARCHITECTURE.md). Upstream patches: [UPSTREAM_INTAKE.md](UPSTREAM_INTAKE.md).

## Style

- **MUST** write a short Korean flow comment above every new function in adapter/runtime scripts; identifiers stay English camelCase, 4-space indent, ESM .mjs files. In `android/`, preserve that source tree's language, TypeScript and formatter conventions instead of reformatting upstream-style code to adapter style.
  - why: existing scripts/tests document intent this way; an English-only or comment-less function stands out in review.
  - ✅ `evidence: scripts/check-upstream.mjs` — `// 고정 버전·lockfile·패치 대상의 일치를 검사한 뒤 최신 배포와 비교한다.`
  - ✅ `evidence: scripts/patch-paseo-terminal.mjs` — `// 전체 원본 해시 확인 -> 뷰포트·스크롤백의 연속 셀만 보존.`

- **MUST** keep `plugin/server/*.mjs` dependency-light: only `node:` built-ins and local modules; the Paseo SDK is imported only from `provider.ts` / `index.server.ts`.
  - why: lifecycle/transport tests run without installed SDK or live credentials.
  - ✅ `evidence: plugin/server/journal.mjs` (node built-ins + local `plugin/server/util.mjs` only); SDK import at `evidence: plugin/server/provider.ts`.

## Capability and input contract

- **NEVER** add a capability to `CAPABILITIES` before it is implemented end to end; unsupported input throws.
  - why: Paseo enables UI from the advertised list; a fake capability produces turns that silently do nothing.
  - ✅ `evidence: plugin/server/connection.mjs` (`CAPABILITIES`), and its router's `default: throw new Error(\`Unsupported provider input: ...\`)`.

- **MUST** validate and reject malformed or oversized input before accepting a turn; never drop parts silently.
  - why: an accepted turn is fsynced as a receipt; dropping content after that point is unrecoverable.
  - ✅ `evidence: plugin/server/util.mjs` — empty or >512 KiB prompt throws.

- **NEVER** auto-replay an uncertain mutating request or claim an interrupt undid side effects.
  - why: a tool may have run before its ack was lost; replay can apply it twice.
  - ✅ `evidence: plugin/server/connection.mjs` — journal failure reports "execution outcome is uncertain".

## Approval policy

- **MUST** default sessions to `ask`; only an explicitly selected session `bypass` skips asks, and upstream deny/block stays deny in every mode.
  - why: the host policy is the only gate between the model and shell/file tools.
  - ✅ `evidence: engine/src/policy.mjs` — `attachHostPolicy(session, { mode = 'ask', ... })`; modes validated right below it.
  - Development standing authorization in [tasks/RELEASE.md](tasks/RELEASE.md) controls task scope, not the runtime tool permission implementation. Never remove asks/denials from the product to avoid development approval prompts.

- **NEVER** seed personal custom agents, fixed agent models, or default-on built-in agents; keep user enable/model choices across configure, refresh and restart.
  - why: settings are user state; configure/refresh must not replace explicit choices with boot defaults.
  - ✅ `evidence: tests/configure.test.mjs` — "agent defaults contain no seeded routes or custom definitions and preserve enabled choices".

## Upstream patch scripts

- **MUST** make each `scripts/patch-*.mjs` check the upstream package version and the exact original hash/blob before any write, accept already-patched bytes unchanged, and support a `--check` mode; state its origin (upstream PR or local) in the header comment.
  - why: install re-runs every patch, so it must be idempotent, fail closed on drift, and be traceable in the intake ledger.
  - ✅ `evidence: scripts/patch-paseo-terminal.mjs` — header names PR #6452; `patchTerminalSource()`: original hash -> patch, patched -> unchanged, else "source drift"; `patchInstalledTerminal()` refuses a different `SERVER_VERSION`.

- **NEVER** hand-edit files under `tools/node_modules/`, `engine/node_modules/`, `plugin/node_modules/` or the installed desktop app bundle, even when the running process executes them.
  - why: `npm ci` or the next desktop update restores the originals, the next patch run reports source drift, and the change never passes the hash review.
  - ✅ ship the change as a gated patch wired into install (`evidence: tools/package.json`).

- **NEVER** search heuristically for a different anchor when the original hash does not match.
  - why: a moved anchor means unreviewed upstream code; see `evidence: docs/ARCHITECTURE.md` § "Native integration".
  - ✅ `evidence: scripts/patch-paseo-terminal.mjs` — `patchTerminalSource()` throws "source drift" instead.

## Tests and checks

- **MUST** use the path-scoped checks in [tasks/RELEASE.md](tasks/RELEASE.md): root `npm run check` and `npm test` for every change, root `npm run typecheck` for plugin TS, plus affected package checks for `android/` code. Reuse still-valid observed results; do not run the Android monorepo full suite automatically.
  - why: `check` is syntax/JSON only; `test` is behavior; neither compiles the TS SDK boundary.
  - ✅ `evidence: package.json` scripts `test`, `check`, `typecheck`.

- **NEVER** report a mock/fixture test as live, model, Android or desktop acceptance.
  - why: tests use a fake engine; only `test:live`/`docs/ACCEPTANCE.md` on target hardware prove those.
  - ✅ `evidence: docs/DEVELOPMENT.md` § "What each test proves" — integration "the LLM is still a fixture".

- **MUST** preserve shared-server responsiveness during tests and builds; do not maximize worker counts or target CPU saturation. Never skip required checks for speed.
  - why: task-worker limits do not necessarily constrain subprocesses or whole-process-tree CPU usage.
  - Build resource limits, cache reuse and log retention: [tasks/RELEASE.md](tasks/RELEASE.md).

- **NEVER** put costed or credentialed calls in default tests; real model calls require `--confirm-api-use`.
  - why: accidental billing and credential exposure.
  - ✅ `evidence: docs/DEVELOPMENT.md` § "Live smoke" — `node scripts/live-smoke.mjs --confirm-api-use`.

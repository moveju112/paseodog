# Development and testing

## Layout

`plugin/server` is dependency-light JavaScript so lifecycle/transport tests do not need
live credentials. `provider.ts` is the narrow typed Paseo SDK registration entrypoint.
`engine/src` hosts the existing Mixdog runtime. Root scripts keep runtime dependencies
under `engine/`, Paseo CLI under `tools/`, and local SDK development dependencies under
`plugin/`. Run commands from the repository root unless noted.

```bash
npm run check
npm test
npm --prefix plugin install
npm run typecheck
npm --prefix engine install
node scripts/patch-mixdog.mjs
node engine/bin/paseodog-engine.mjs --check
```

The first successful online install creates package-lock.json in each package. Review
and commit these files; subsequent installer runs use npm ci. A version string without
a verified lockfile does not freeze all transitive dependencies.

## What each test proves

- connection: prompt/turn lifecycle, streaming snapshots, approval expiry, dedup,
  interrupted turns, startup/close races and journal failure using an injected engine.
- journal: real filesystem atomic replacement, permissions, owner locks, stale owners,
  corruption and bounded replay, without a real model store.
- process-engine: actual OS child processes over the production JSONL transport, with
  a conspicuously fake native runtime in tests/fixtures/worker-fixture.mjs.
- integration: real provider connection, disk journal and child process composed together;
  the LLM is still a fixture. No claim of real model or mobile acceptance.
- native-policy: guard and config mapping; creation/resume behavior with injected modules.
- upstream-patch: cryptographic match of retained upstream source, plus executing the
  actual patched runner after replacing its surrounding imports with test doubles.
- JSONL: frame limits, malformed data and UTF-8 chunk boundaries.
- configure/package: explicit trust, config preservation, archive path safety and hashes.

`tests/contracts/provider-events.mjs` validates only the event subset used by this
adapter. It is not a substitute for compiling against @getpaseo/plugin or actually
loading the plugin in Paseo.

CI installs the plugin development dependencies for the client rendering tests and
keeps a separate actual SDK typecheck job. Server/adapter unit tests remain dependency-light.
A manual
`native_install` workflow input can install Mixdog and verify the patch without model
credentials. The workflow file exists locally; no GitHub repository, workflow run or
passing hosted CI is claimed by this archive.

## Live smoke

After successful installation and explicit local authentication:

```bash
node scripts/live-smoke.mjs --confirm-api-use
```

This makes two real model calls to remember a nonce, close the native engine and resume
it to recover that nonce. It rejects tool use and saves a local-only result under
reports/live-smoke.local.json. This verifies the process/native API path, not the full
Paseo UI loader or real tool denial. Complete ACCEPTANCE.md separately.

The smoke script uses the operator's dedicated native profile and can leave its two
messages in native history. It is not a promise of zero-cost execution or zero local
state changes. The temporary Git workspace is removed on exit. Do not publish its
local result unreviewed.

## Measured efficiency input

`node scripts/benchmark-report.mjs baseline.json candidate.json` consumes arrays:

```json
[
  {
    "task": "unique-task-and-trial-id",
    "model": "actual-model-id",
    "effort": "actual-effort",
    "success": true,
    "inputTokens": 1200,
    "cachedInputTokens": 800,
    "outputTokens": 200,
    "wallMs": 9000
  }
]
```

These numbers are a format example, not measurements. inputTokens must already contain
cachedInputTokens; normalize provider accounting before comparison. Include maintenance,
compaction, retries, failures and any subagent usage in both sides. Preserve equal task
sets, actual models, effort, credentials/limits and verifier criteria. Report success
and latency alongside tokens. No automatic dollar calculation or claimed 63% reduction.

## Packaging

```bash
npm run package
# or
python3 scripts/package.py --output /tmp/PaseoDog-release.zip
```

The archive contains one paseodog/ root and MANIFEST.sha256 for every shipped source/
report file. It excludes dependencies, .git, local-only reports, secret file extensions,
.env files and archives. This filter is defense in depth, not a secret scanner: inspect
new source/documents before distribution. Packaging is deterministic for equal inputs.

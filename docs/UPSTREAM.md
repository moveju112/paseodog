# Upstream compatibility record

Reviewed source date: 2026-10-11. These pins are compatibility targets, not claims that
this delivery successfully downloaded or executed their full published npm artifacts.

| Component | Version | Git commit |
|---|---|---|
| Paseo / plugin SDK | 0.11.2 | 804335bc00bff52f2652f5de9e6227f013322948 |
| Mixdog | 1.0.12 | 620a60919e04f09a477bc5104e07230d22217a17 |

## Primary source references

- Paseo provider contract: https://github.com/getpaseo/paseo/blob/804335bc00bff52f2652f5de9e6227f013322948/packages/plugin/src/server/provider.ts
- Provider guide: https://github.com/getpaseo/paseo/blob/804335bc00bff52f2652f5de9e6227f013322948/public-docs/plugins/providers.md
- Plugin lifecycle and trust: https://github.com/getpaseo/paseo/blob/804335bc00bff52f2652f5de9e6227f013322948/docs/plugins.md
- Foreground daemon, authentication and connectivity configuration: https://github.com/getpaseo/paseo/blob/804335bc00bff52f2652f5de9e6227f013322948/public-docs/configuration.md
- Command argv and provider options: https://github.com/getpaseo/paseo/blob/804335bc00bff52f2652f5de9e6227f013322948/docs/custom-providers.md
- SSH/control commands: https://github.com/getpaseo/paseo/blob/804335bc00bff52f2652f5de9e6227f013322948/public-docs/cli.md
- Mixdog runtime facade: https://github.com/tribgames/mixdog/blob/620a60919e04f09a477bc5104e07230d22217a17/src/session-runtime/runtime-core.mjs
- Native turn runner: https://github.com/tribgames/mixdog/blob/620a60919e04f09a477bc5104e07230d22217a17/src/session-runtime/turn/turn-run.mjs
- Native session hook: https://github.com/tribgames/mixdog/blob/620a60919e04f09a477bc5104e07230d22217a17/src/session-runtime/session-hooks.mjs
- Native pre-tool policy: https://github.com/tribgames/mixdog/blob/620a60919e04f09a477bc5104e07230d22217a17/src/runtime/agent/orchestrator/session/loop/tool-exec/before-hook.mjs
- Native MCP schema: https://github.com/tribgames/mixdog/blob/620a60919e04f09a477bc5104e07230d22217a17/src/session-runtime/mcp-glue/server-input.mjs
- Stream reset semantics: https://github.com/tribgames/mixdog/blob/620a60919e04f09a477bc5104e07230d22217a17/src/repl/stream-sink.mjs

## One reviewed host callback patch

File: `src/session-runtime/turn/turn-run.mjs`.
Original Git blob: `25339f8b798855011f30b5d51c5476602723f303`.
The exact original is retained as `tests/fixtures/upstream-turn-run.mjs.txt` under its
upstream Apache-2.0 license. A test computes Git's actual blob hash of that fixture.

Insertion follows `dispatchPromptSubmit(turn, session0, prompt, options)`:

```js
// PaseoDog host-policy boundary v1 (local Apache-2.0 modification).
if (typeof options.beforeSessionAsk === 'function') {
    await options.beforeSessionAsk(session0);
}
```

The patcher checks package version, exact original hash, one insertion anchor and
idempotency. It changes only an installed local dependency file and never pushes an
upstream commit. `--check` refuses missing/changed patches. No bypass flag is included.
The source has been statically reviewed and the patched original runner tested with
mocked helpers; downstream full engine behavior still requires live validation.

## Upgrade procedure

1. Stop the daemon and back up private data outside the source tree.
2. Review native callbacks, before-tool enforcement, resume ownership, session storage,
   stream/result shapes and the current Paseo provider contract.
3. Update direct pins and verified lockfiles together. Review npm lifecycle scripts.
4. Regenerate the retained fixture and patch hash only from the inspected upstream file.
5. Run syntax/unit tests, actual SDK typecheck, actual engine install and live smoke.
6. Complete real approval/denial, interruption, reconnect and mobile acceptance tests.
7. Record new versions, hashes and execution evidence before removing the RC label.

PaseoDog does not claim original benchmark savings. The integration's policy choices,
model configuration and disabled capabilities change workload behavior. Measure.

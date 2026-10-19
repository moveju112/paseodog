# Upstream compatibility record

Mixdog's current compatibility target is the published npm `mixdog@1.2.6` artifact.
The original Paseo review below remains unchanged. Source review and local checks
do not establish real-account or mobile acceptance.

| Component | Version | Git commit |
|---|---|---|
| Paseo / plugin SDK | 0.11.4 | npm artifacts; custom Android base `dc5b02f` |
| Mixdog | 1.2.6 | npm artifact; compared against tag `v1.2.6` |

## Primary source references

Current Mixdog source: https://registry.npmjs.org/mixdog/-/mixdog-1.2.6.tgz

The commit links below retain the original `1.0.12` integration references; the
current runtime, callback bridge and pre-tool policy were reviewed in the npm
artifact. The retained turn-run fixture and blob gate below target `1.2.6`.

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

## Reviewed host boundary patches

File: `src/session-runtime/turn/turn-run.mjs`.
Original Git blob: `6de5147ccdce6c9b3aa5f48dc740af439834b7b1`.
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

`scripts/patch-mixdog.mjs` also pins these `1.2.6` source blobs:

| File under `src/` | Original Git blob | Purpose |
|---|---|---|
| `session-runtime/runtime-core.mjs` | `14ae394742a849f5cfd5bdc18123d9779ec6a7d3` | Pass the host agent surface through boot |
| `session-runtime/boot/tools.mjs` | `704c7bcc84c8d6a52b0d13ea7412ba287d40b9fd` | Inject the native agent sessionSurface and retain host config during planning |
| `session-runtime/boot/providers.mjs` | `34fc9fec9d09ac3b21d9a88b8e5468f3927992f3` | Preserve explicitly injected host config across lazy-secret/config reloads |
| `session-runtime/turn/turn-run/ask-callbacks.mjs` | `05b64099a27c0aae0e86be27ee493407661e3361` | Carry host completion ownership while retaining `onStreamItemStart` |
| `runtime/agent/orchestrator/session/manager/ask-session.mjs` | `40a774b8654fbb7ac7a658fc9020fc16cf9c75af` | Suppress unawaited follow-up asks for host-managed turns |

All files are validated before any write. Partial or drifted patches are rejected.
The exact previously reviewed one-edit `boot/tools.mjs` patch can be upgraded to the
current two-edit form; arbitrary partial combinations remain rejected.
The native scheduler is unchanged. `npm run test:native` exercises the installed
runtime through a scripted localhost HTTP provider, including real read-tool execution
and denied/canceled shell calls. This does not substitute for subscription-model or
Paseo app acceptance.

## Upgrade procedure

### Selected Paseo backports

The CLI/SDK stay on stable `0.11.4`; the app does not adopt the beta navigation overhaul.
`tools` postinstall runs two independent, version- and full-source-hash-gated patches:

- `scripts/patch-paseo-cli.mjs`: PR [#6607](https://github.com/getpaseo/paseo/pull/6607), wait for permission-response acknowledgement before reporting success.
- `scripts/patch-paseo-terminal.mjs`: PR [#6452](https://github.com/getpaseo/paseo/pull/6452), serialize wide-character continuation cells as `""` in both grid and scrollback. No new protocol fields or input changes.

The custom Android source also contains the client half of #6452, reconnect-stream reconciliation [#7256](https://github.com/getpaseo/paseo/pull/7256), and terminal-copy fixes [#7254](https://github.com/getpaseo/paseo/pull/7254) / [#7260](https://github.com/getpaseo/paseo/pull/7260). Rebuild its protocol package before the APK. These fixes do not replace the Android input-order patch or establish physical Samsung IME acceptance.

Dependency audit remains unresolved: the installed stable tools reported 5 high-severity entries and plugin development dependencies reported 15, including inherited entries. No automatic audit fix or major dependency substitution is applied. This release is not a security or production-acceptance certification.

Run `npm run upstream:check` to compare the pinned Mixdog, Paseo CLI and Paseo SDK
with npm's latest releases. This is read-only: it validates lockfile/pin agreement
and reports differences, not compatibility or automatic upgrades. Registry failures
fail the command rather than reporting that the installation is current.

Keep inference features in Mixdog and client/daemon features in Paseo. Do not copy
their implementations into the adapter. Review one upstream component at a time;
upgrade the Paseo CLI and SDK together. Preserve unrelated local changes.

1. Stop the daemon and back up private data outside the source tree.
2. Review native callbacks, before-tool enforcement, resume ownership, session storage,
   stream/result shapes and the current Paseo provider contract.
3. Update direct pins and verified lockfiles together. Review npm lifecycle scripts.
4. Regenerate the retained fixture and patch hash only from the inspected upstream file.
5. Run syntax/unit tests, actual SDK typecheck, actual engine install and live smoke.
6. Complete real approval/denial, interruption, reconnect and mobile acceptance tests.
7. Record new versions, hashes and execution evidence before removing the RC label.

Steps involving service changes, account calls or deployment need separate operator
approval. Source/dependency work and local tests can be prepared without restarting
the daemon. Do not run `scripts/install.sh` merely to check an upgrade: it changes
configuration and starts/reloads the daemon.

For Mixdog, port only the hash-locked host callback and review approval, cancellation,
resume and context ownership. If upstream supplies an equivalent supported callback,
replace the local patches only after the same regression tests and `npm run test:native`
pass. Re-review child approval, completion ownership and cancellation on every upgrade;
never drop those gates merely because a new release changed an anchor.

For Paseo, review `plugin/server/provider.ts` and `plugin/server/connection.mjs`
against the installed SDK; test streaming, permissions, reconnect and persistence.
The optional Android terminal source patch is separate from the npm daemon/SDK:
review its blob gate independently, and remove it when an upstream fix is verified.
Never apply an old patch to a new source by changing only its hash.

PaseoDog does not claim original benchmark savings. The integration's policy choices,
model configuration and disabled capabilities change workload behavior. Measure.

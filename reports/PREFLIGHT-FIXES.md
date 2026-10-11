# PaseoDog 1.0.0-rc.2 — Preflight fixes

Previous audit: R01–R12 in `PaseoDog-preflight-audit.md` (not part of this release). This document is the implementation changelog, not an assertion of production readiness.

| Audit | Code changes | Regression coverage |
|---|---|---|
| R01 TS4104 | Explicit writable copy of SDK capability array in `plugin/server/provider.ts` | Real SDK TypeScript CI job |
| R02 stale callbacks/approval | Immutable worker turn tokens, live-turn checks, scoped permissions | `late old-turn text, identity and approval...` |
| R03 orphaned Linux process | Dedicated Unix process group, TERM/KILL and descendant cleanup | `Linux force-kill stops a worker and its shell descendants` |
| R04 ambient credential profile | Own `MIXDOG_HOME` + `MIXDOG_DATA_DIR`, reject reserved environment values | `PaseoDog profiles ignore ambient...` |
| R05 packaging extra credentials | Reviewed manifest path allowlist | `packager ignores custom state directory...` |
| R06 oversized IPC results | Strip/summarize tool output before transport, preserve upstream raw output | `tool results larger than IPC cap...` |
| R07 manual compact accounting | Native session counter deltas, compact usage propagation | `manual compaction reports...`, `native compaction counters...` |
| R08 unexpected engine death | One-way broken state + runtime_failed notification | `unexpected worker death...` |
| R09 root CLI flags | Parse root options before default provider injection | `CLI detects run after global host option...` |
| R10 recovery ENOSPC | Enclose journal recovery in cleanup boundary | `journal recovery disk-write failure...` |
| R11 mismatched native route | Verify restored provider/model before model inference; effort remains dynamic | `native restore rejects different provider/model...` |
| R12 unsupported settings | Fail closed on unknown session settings | `unknown settings and credential-profile...` |

## Verification limits

- `npm test` uses a fixture engine, plus real child processes for IPC/lifecycle; it does **not** call a real model.
- GitHub Actions `sdk` compiles against the installed `@getpaseo/plugin` package.
- GitHub Actions `native-contract` checks install + pinned upstream patch without credentials; it does not perform inference.
- An actual Ubuntu account, Android LTE/5G pairing, tool authorization through the native model, and reboot persistence remain on the acceptance checklist.
- Existing `reports/unit-tests.tap` and `reports/VERIFICATION.md` are retained as historical **rc.1** evidence; do not mistake them for this revision's CI outcome.
- **Safety:** Approval remains mandatory for every tool by default. No unrestricted unattended execution is enabled. Unix process-group cleanup cannot guarantee termination of tasks that deliberately detach into new sessions, remote jobs or other processes outside that group.

## rc.2 native installation CI follow-up

The first rc.2 workflow exposed a new install failure in Mixdog 1.0.12: its postinstall script resolves @huggingface/transformers under `mixdog/node_modules`, but npm hoisted it. The engine install now requests npm `--install-strategy=nested`. This requires a fresh GitHub Actions native-contract result and is not yet proof of real model inference.

# Changelog

## 1.0.0-rc.4 - 2026-10-12

- Avoid unhandled rejections and silent containment failure when journal flush
  and native scope kill both fail. Mark the accepted turn uncertain; stop sending
  its callbacks; emit failure/containment notices; bound the kill confirmation.
- Add deterministic regressions for rejected/thrown/hung/successful cleanup.
- Provide an opt-in, exact-upstream-blob Paseo Android input patch (Samsung-style
  callback reordering, Backspace and Hangul) with synthetic contract tests.
  **Does not update APKs or prove physical cursor pixel alignment.**
- Add upstream-source patch compilation check to SDK CI.

## 1.0.0-rc.3 - 2026-10-12

- Make package security tests operate exclusively on isolated temporary source copies; never delete real source tree state.
- Observe worker `exit` rather than only stream `close` and immediately settle uncertain RPCs.
- Require a separate Linux systemd user scope/cgroup per session, fail closed without systemd --user, and verify cgroup population is empty after stop.
- Refuse native text resets because the pinned Paseo adapter cannot retract previously displayed deltas; enforce monotonic assistant snapshots.
- Commit exact CI-produced npm lockfiles, use `npm ci` for all dependencies and verify integrity in CI.
- Add real-process, scope contract, replay and package-isolation regression tests.
- Still requires a real systemd host / model / mobile acceptance run before production.

## 1.0.0-rc.2 - 2026-10-12

- Fix pinned Paseo SDK readonly capability typecheck failure (TS4104).
- Scope worker callbacks, identity and tool approval to their originating turn; deny late approval callbacks.
- Bound IPC tool previews before serialization, preserving original Mixdog model context.
- Launch separate Unix process groups and terminate descendants on crash, timeout, or force-stop.
- Report unexpected worker death to Paseo; reject new turns until explicit reopen.
- Isolate Mixdog state directories against ambient environment overrides and reject reserved session variables.
- Treat release MANIFEST.sha256 as an explicit allowlist to exclude accidental runtime credentials.
- Include actual native compaction token usage deltas in UI and journal accounting.
- Honor global CLI options before run; keep default PaseoDog provider unless explicitly overridden.
- Release journal locks on recovery write failure; reject mismatched native model/provider before inference.
- Reject unsupported initial session settings, add regression tests and CI native installation checks.

## 1.0.0-rc.1 - 2026-10-11

- Replace the starter's in-process runtime sketch with a per-session process host.
- Preserve native Mixdog history through versioned bridge persistence and a durable
  receipt ledger; reject ambiguous recovery instead of automatically replaying work.
- Add session environment/MCP/system instruction propagation and actual native route
  retention, with isolation from ordinary Paseo/Mixdog profiles.
- Add a source-hash-gated native beforeSessionAsk hook and explicit tool approval policy.
- Add bounded permissions, interrupt escalation, stable streaming IDs, native reset
  semantics, safe result projection, bounded replay, process locks and UTF-8 framing.
- Supply SSH launcher, dependency installer, private configuration, diagnostics,
  systemd generator, explicit-cost live smoke, CI and source packaging with hashes.
- Add 71 local tests including actual child-process and disk-journal integration paths.
- Retain RC status: npm registry DNS was unavailable, installed SDK/native package
  execution and actual Linux server/mobile acceptance have not been completed here.
- No custom APK/IPA, no complete upstream source/binary bundle and no benchmark promise.

# Changelog

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

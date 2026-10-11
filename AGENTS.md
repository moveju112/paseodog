# PaseoDog development rules

- Preserve the integration boundary: Paseo owns clients/daemon, Mixdog owns inference
  and model history, the adapter owns lifecycle/authorization/journal/wire mapping.
- Do not replace native model context with UI snapshots. Never replay an uncertain
  mutating request automatically or infer that interruption undoes side effects.
- Every tool remains deny-until-approved through the reviewed beforeSessionAsk patch.
  Preserve upstream denies, review rewritten calls, deny missing/stale approvals.
- Never advertise provider capabilities that are unimplemented. Reject unsupported
  settings, image inputs, steering, ephemeral persistence and exact MCP preapproval.
- No automatic public listener, credential import, cost-incurring test, privilege
  escalation, repository push or global profile overwrite.
- Keep direct versions and upstream blob gate explicit. No hash-bypass option.
- Run npm run check and npm test for every change. Compile with the actual installed
  SDK and perform live acceptance separately; mocks cannot establish those results.
- Update reports only from commands actually executed. Do not fabricate token savings,
  tests, account support, native binaries, Android builds or hosted CI success.
- Keep .local. reports, dependencies, credentials and user state out of release ZIPs.
- Production acceptance requires the checklist in docs/ACCEPTANCE.md on target hardware.

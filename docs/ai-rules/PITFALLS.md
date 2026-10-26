# Failure reference

Consult only the matching row. Diagnosis does not authorize the suggested mutation; runtime actions follow [RUNTIME_DAEMON](RUNTIME_DAEMON.md).

| Symptom | Next evidence / remedy |
|---|---|
| `Provider 'paseodog' is not available. Available providers: none.` | Inspect provider diagnostic before choosing a remedy; do not assume a restart is needed. |
| `PaseoDog engine version mismatch` | Compare loaded vs disk release. Arrange an authorized reload without waiting for idle; do not revert metadata. |
| PC app and wrapper see different sessions | Check the connected host/home and app startup log; a stock daemon is not an apply target. |
| `Session already owned` | Find the live owner; never delete its lock or start a second owner. |
| Ready/doctor passes but feature fails | Reproduce the affected behavior on the actual host; readiness is not feature evidence. |
| `hash mismatch`, `anchor mismatch`, `Partial ... patch`, `patch drift` | Compare the pinned original and apply/unwrap order; fix the responsible patch, never bypass the gate. |
| `Mixdog patch pin mismatch`, `Paseo CLI/SDK pins differ`, `Lockfile mismatch`, `Exact version required` | Check the changed pins/lockfiles together; do not fetch a new version as a repair. |
| `independent product version and upstream provenance stay consistent` | Reconcile the intended version sources, not the running service. |
| Update check shows no release | Inspect latest release version and update assets; publish only under release authorization. |
| Another session changes shared files during verification | Preserve its work; separate worktrees and invalidate only affected evidence. |

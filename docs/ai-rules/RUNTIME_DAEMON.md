# Dedicated runtime

Source changes do not authorize runtime apply. Apply only under an explicit release/apply request; ordinary implementation ends with its verified commit/push.

## Target and cutover

- Use the `paseodog` wrapper and dedicated home. Identify the actual host/process/home, not just a port. Stock Paseo and personal Mixdog profiles are never implicit targets.
- Before install, reload, restart or relaunch, check active turns on the affected dedicated runtime. Wait for idle or obtain specific interruption approval; never kill work to finish faster.
- Release apply runs through the independent [delivery service](tasks/RELEASE.md). Keep ownership until application and readiness are confirmed; inspect failures and perform authorized recovery rather than treating service startup as completion.
- Keep the previous executable/data recoverable during cutover. A failed readiness check is incomplete apply, not success; do not keep restarting an unverified candidate.
- Never use `scripts/install.sh` / `scripts/install.mjs` as a diagnostic. New public listeners, account/chat deletion and signing-key replacement require separate authorization.

## Read-only diagnosis

Choose the command matching the missing evidence, not the whole list:

| Need | Command |
|---|---|
| Installation/configuration | `paseodog doctor` |
| Runtime identity | `paseodog daemon status` |
| Loaded provider readiness | `paseodog provider diagnostic paseodog --json` |
| Provider failure details | `paseodog plugin logs paseodog-provider` |

The daemon retains loaded plugin/version metadata. Disk changes may require a later authorized reload; never revert release metadata to disguise a mismatch. Provider Ready and `doctor` do not prove inference or UI behavior.

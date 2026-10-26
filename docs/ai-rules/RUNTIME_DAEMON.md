# Dedicated runtime

Source changes do not authorize runtime apply. Apply only under an explicit release/apply request; ordinary implementation ends with its verified commit/push.

## Target and cutover

- Use the `paseodog` wrapper and dedicated home. Identify the actual host/process/home, not just a port. Stock Paseo and personal Mixdog profiles are never implicit targets.
- Before install, reload, restart or relaunch, check active turns on the affected dedicated runtime. Wait for idle or obtain specific interruption approval; never kill work to finish faster.
- Release apply runs through the independent [delivery service](tasks/RELEASE.md). Confirm application and readiness, inspect failures and perform authorized recovery rather than treating service startup as completion. The idle wait counts the requesting session's own turn, so end that turn once only the idle-gated apply remains (see RELEASE step 5) and confirm on the next turn.
- Keep the previous executable/data recoverable during cutover. A failed readiness check is incomplete apply, not success; do not keep restarting an unverified candidate.
- Never use `scripts/install.sh` / `scripts/install.mjs` as a diagnostic. New public listeners, account/chat deletion and signing-key replacement require separate authorization.

## Interrupted turns

- A turn left running by a dead daemon process is never replayed. After startup the provider plugin sends each such agent one new continuation instruction (check state, do not repeat finished work) through `paseodog agent send --no-wait`; `auto-resume.json` in the journal root records the attempt so it is sent at most once. Sessions owned by a live process, archived or internal agents are skipped. Set `PASEODOG_AUTO_RESUME=false` in the daemon environment to disable it.

## Read-only diagnosis

Choose the command matching the missing evidence, not the whole list:

| Need | Command |
|---|---|
| Installation/configuration | `paseodog doctor` |
| Runtime identity | `paseodog daemon status` |
| Loaded provider readiness | `paseodog provider diagnostic paseodog --json` |
| Provider failure details | `paseodog plugin logs paseodog-provider` |

The daemon retains loaded plugin/version metadata. Disk changes may require a later authorized reload; never revert release metadata to disguise a mismatch. Provider Ready and `doctor` do not prove inference or UI behavior.

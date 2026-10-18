# Architecture

## Boundary and ownership

Existing Paseo mobile/desktop/web clients and the SSH CLI connect to one Paseo daemon.
The `paseodog` provider runs one Mixdog worker process per open provider session. There
is no independent phone-to-Mixdog daemon or new public RPC port in this integration.
Use the Paseo agent ID for every client; native Mixdog IDs are private adapter state.

```
Existing Paseo app / web / SSH paseodog CLI
                 |
        Paseo daemon (dedicated home)
                 |
        provider connection + journal
                 |
      stdin/stdout JSONL, worker per session
                 |
        pinned Mixdog native runtime
                 |
       configured model provider + tools
```

Only wire/event translation, lifecycle, journal and host policy belong to PaseoDog.
Mixdog owns inference, context management, prompt caching, token counting and native
session storage. The adapter never reconstructs model history from UI snapshots.
The retained UI history is a bounded replay cache, not the source of model context.

## Native integration

`engine/src/native-engine.mjs` imports Mixdog's existing runtime facade. A small local
patch adds `options.beforeSessionAsk(session)` to the native turn runner after session
preparation and prompt-submit hooks, and before `mgr.askSession` starts inference.
The patcher verifies the exact original Git blob and package version first. A mismatch
fails closed. It does not search heuristically for a different insertion point.

The host callback places stable Paseo system instructions in native context and wraps
`session.beforeToolHook`. Native deny decisions remain deny; rewritten calls are checked
again. Every accepted tool needs an allow-once response. Native delegation uses the
existing agent `sessionSurface` hook, exposed by hash-locked boot patches. The host
wraps child turns, not the scheduler, agent definitions or native model context.
Automation and desktop/configuration mutations remain excluded.
This is not an operating-system sandbox; see SECURITY.md.

`engine/src/orchestration.mjs` validates parent ownership, inherits the host policy,
maps child approvals to the owning Paseo turn with the child's identity in the reason,
and namespaces child tool IDs. Native usage is forwarded without mixing child text into
the Lead's answer. Existing native hooks and turn-review callbacks remain intact.
Only enabled roles are exposed. The explicit `PASEODOG_ENABLE_WORKER=true` host option
enables Worker on the parent's exact model with Fast, Auto effort and fallbacks off.
It changes only the in-memory host config, not the native profile or other roles.
Injected host configuration remains authoritative through lazy-secret/config reloads
and native agent planning; these paths must not reload an unrelated profile and
silently discard the host MCP, update or role boundaries.

The parent waits on native job-status events and continues through the native pending
completion queue before returning a terminal result. Auto-wake and the manager's
unawaited follow-up kicks are disabled for host-managed turns; queue processing within
an awaited native ask remains enabled. An empty native continuation may legitimately
return no result when its queue entries were already delivered; the last real result
is retained. No UI snapshot is replayed into model history.

Cancellation invalidates the captured turn, rejects late approvals and closes owned
agent jobs, including preparation jobs. Native sessions/tags may be reused while the
worker stays open; closing the worker does not promise to revive an unfinished child.
Paseo's existing cgroup fallback remains responsible for noncooperative processes.

The original engine's own startup and authorization code can still access the user's
machine. The patch protects the reviewed agent tool-dispatch boundary, not arbitrary
npm lifecycle scripts, configured hooks, external MCP code or approved shell programs.

## Transport and cancellation

Version-1 JSONL frames carry correlated request IDs. Separate abort and permission RPCs
are processed while an inference request is pending. Child stdout is reserved for this
wire. Native stdout diagnostics are redirected to stderr; parent drains stderr without
forwarding it to phone/UI. Responses project only display/result data, not complete
native sessions or opaque provider replay.

Frames are capped at 2 MiB and worker queued output at 8 MiB. Streaming assistant
segments are capped at 1 MiB; reasoning display retains a bounded tail. The parser
handles multi-byte UTF-8 split across arbitrary chunks and rejects malformed frames.

An interrupt denies pending approvals, requests native abort, and waits for bounded
settlement. A noncooperative engine is killed. Already-performed filesystem or remote
side effects are never claimed to be rolled back. Plugin teardown closes its workers;
this differs from a phone merely losing its client connection to the still-live daemon.

## Journal and duplicate handling

A bridge UUID is returned through Paseo's opaque `ProviderPersistence` version 2. Each
journal records native ID/route, canonical cwd, a system-prompt hash, latest UI items,
usage counters and hashed-message-ID receipts. Secrets, full launch environment and
MCP credentials are not stored in this journal. Tool output may still contain sensitive
data; keep all state private.

A receipt is fsynced before inference acceptance. Repeated clientMessageIds do not start
another engine request. IDs reused with different contents fail. A crash during a turn
leaves an uncertain receipt; reopening reports uncertainty and never blindly replays it.
This is **not an exactly-once guarantee for arbitrary external side effects**. A command
may have succeeded before its acknowledgment was lost. Inspect the repository/external
system before sending a new instruction with a new ID.

Atomic replace + fsync protects individual JSON updates. A PID/start-time/hostname/nonce
lock prevents two bridge connections from owning one journal. Stale same-host owners
can be recovered; foreign-host, malformed or initializing locks fail closed. Use local
Linux storage, not a shared multi-host/NFS database. A native session owned by an external
live Mixdog writer is rejected rather than forwarded outside the host-policy boundary.

Replay is limited to 2,000 items and about 8 MiB. Receipt retention is not silently
truncated: at 20,000 receipts the operator must open a new session. The complete journal
has a 16 MiB safety ceiling. Limits are protection boundaries, not advertised scale
benchmarks. Large active sessions can have meaningful local I/O cost.

## Capability contract

Implemented: `prompt.message`, `prompt.command` (`/compact`), `session.persistence`,
`session.list`, `permission`. Every accepted prompt has one prompt_result per connection
and each new started turn has a terminal completed/failed/canceled event. Native outputs
use stable timeline IDs for incremental replacement, not duplicated message rows.

Not advertised: images/uploads, output schemas, steering, live settings/model changes,
rollback, archive APIs, subsessions, or Hub's exact MCP tool preapproval. Unsupported
operations are rejected; a completed response is not manufactured. Durable native
sessions require `persist:true`. Starter version-1 persistence is not auto-migrated.

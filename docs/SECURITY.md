# Security model and limits

This is a single-user development host integration, not a multi-tenant service and not
a hardened sandbox. Run under a dedicated non-root account, initially against a
throwaway repository. Do not place production cloud credentials in that account by
default. An approved shell command has that user's filesystem and network privileges.

## Explicit trust and approval

Installation asks for TRUST or an explicit `--trust-plugins` flag before running npm
installation or enabling unsandboxed plugin code. Native/MCP/extension dependencies and
their install scripts are part of the trusted software supply chain. Direct dependency versions and CI-generated registry lockfiles are pinned.
The installer uses `npm ci` only; verify the locks again whenever dependencies change.

By default, agent tools, including reads, require allow-once approval. Selecting
`Bypass (always allow tools; no approval prompts)` explicitly opts that session into
unattended tool execution, including file writes, shell commands and MCP tools.
Managed children inherit the selected mode. Bypass skips hook approval requests but
preserves upstream deny/block decisions and managed agent/task cross-session restrictions.
The host does not deny tools by category, including configuration, desktop, delegation
and automation tools. It is not an OS sandbox and does not bypass OS permissions.
The default remains `ask`; selecting Bypass does not change other sessions or the
global default. Reopened sessions use their explicitly supplied session mode.
Image prompts use Mixdog's native text/image content parts. PNG, JPEG, GIF and WebP
base64 inputs are supported, including image-only prompts. Serialized input is bounded
below the 16 MiB IPC frame limit; oversized input and unsupported attachments are
rejected before accepting a turn, never silently dropped.
In approval modes, argument edits, permission-policy changes, stale approvals, oversized
approval payloads, unrelated sessions and expired requests cannot grant access. Review
mode only permits an explicit native read-tool name allowlist plus managed agent/task
control and still asks approval. Children inherit the same review restriction.
Tool name classification is not proof that arbitrary code is safe.

Configured upstream hooks remain trusted executable code. They may act before the agent
tool guard or outside its control. Starting an MCP server executes its configured
command before any individual tool approval. Denying one MCP tool does not undo server
startup effects. The host guard cannot contain malicious dependencies, plugins or
programs launched by an approved command. Use OS/container isolation separately when
needed, and validate it on the target server.

## Managed orchestration

The native agent tool retains scheduling, role configuration, sessions and results.
Every child turn passes through the host-owned surface before inference; foreign or
cyclic parent chains fail closed. Tool approval preserves the full arguments and
identifies the child, while the request stays bound to the parent's active Paseo turn.
Cross-terminal/global/recovery control is refused. Automation and setup remain denied.

Completion continuations carry the same approval callbacks and cancellation boundary.
Neither native auto-wake nor manager background follow-up can start an unmanaged model
turn. Abort closes owned child jobs; a late approval cannot revive one. This does not
undo a tool that already executed or sandbox an approved shell command.


## Linux process containment (required)

Ordinary Linux process groups are not a security boundary: Mixdog native shells
may create new process groups. Each PaseoDog session therefore starts in a
unique `systemd-run --user --scope` cgroup. A running user systemd manager is
mandatory; startup fails closed if it cannot be contacted. Stop/force-kill
requests signal the *entire* cgroup and check that no tasks remain. The
`test-only-process-group` override exists solely for CI fixtures and must
never be configured in the public provider. Scope membership should also be
verified on the deployment server, including Mixdog native helpers.

This does not sandbox approved commands. Processes intentionally escaping the
user cgroup through privileged services or other process managers are beyond
this containment; use an isolated VM/container and limited credentials.

## Data and networking

PaseoDog state defaults to a separate user directory. Journals require private storage,
use no-follow checks and atomic writes, and avoid storing full config/environment.
Native tokens still exist in the native auth profile. Tool outputs, prompts, comments
and code displayed in the UI can contain secrets; display truncation is not redaction.
Do not upload state, raw logs, auth exports, QR credentials or a live .env file to Git.

The integration opens no public network listener itself. The installer defaults Paseo
to localhost with relay disabled. Configure password authentication and an encrypted
Paseo relay or your approved VPN before remote use. No automatic port forwarding,
public wildcard bind or disabled authentication is provided. Existing allowed-host
settings and firewall/VPN policies remain operator responsibilities.

## Failure behavior

Unknown protocol frames, source-version/hash mismatch, lost native session, altered cwd
or host prompt, broken journals and ambiguous lock ownership fail closed. A dead worker
is not implicitly restarted and asked to repeat a potentially mutating request.

Do not delete a lock to bypass a running owner. Stop all relevant processes, make a
private backup, inspect PID identity and repair only after ownership is understood.
Interruption does not undo modifications, payments, deployments, emails or other remote
side effects. No recovery code can infer their success from a lost network acknowledgment.

## Before public/multi-user release

Perform dependency review, real tool-denial tests, relay/VPN and authentication checks,
app/device compatibility testing, reboot tests and an independent security review.
This archive has not completed those deployment acceptance steps.

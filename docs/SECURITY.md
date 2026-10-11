# Security model and limits

This is a single-user development host integration, not a multi-tenant service and not
a hardened sandbox. Run under a dedicated non-root account, initially against a
throwaway repository. Do not place production cloud credentials in that account by
default. An approved shell command has that user's filesystem and network privileges.

## Explicit trust and approval

Installation asks for TRUST or an explicit `--trust-plugins` flag before running npm
installation or enabling unsandboxed plugin code. Native/MCP/extension dependencies and
their install scripts are part of the trusted software supply chain. Direct dependency
versions are pinned, but this delivery could not generate verified registry lockfiles.
Review generated lockfiles after the first successful online install and commit them.

Default agent tools, including reads, require allow-once approval. No allow-always is
implemented. Argument edits, permission-policy changes, stale approvals, oversized
approval payloads, unrelated sessions and expired requests cannot grant access. Review
mode only permits an explicit native read-tool name allowlist and still asks approval.
Tool name classification is not proof that arbitrary code is safe.

Configured upstream hooks remain trusted executable code. They may act before the agent
tool guard or outside its control. Starting an MCP server executes its configured
command before any individual tool approval. Denying one MCP tool does not undo server
startup effects. The host guard cannot contain malicious dependencies, plugins or
programs launched by an approved command. Use OS/container isolation separately when
needed, and validate it on the target server.

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

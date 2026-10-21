#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
if [ "$(id -u)" = 0 ]; then echo "Install as your dedicated non-root development user, not root." >&2; exit 1; fi
command -v node >/dev/null || { echo "Install Node 24 LTS first." >&2; exit 1; }
command -v npm >/dev/null
command -v git >/dev/null
node --input-type=module -e "import {supportedNode} from './scripts/paths.mjs';if(!supportedNode()){console.error('Node 22.19+ (22.x) or 24+ required');process.exit(1)}"
if [ "$(uname -s)" = Linux ] && ! systemctl --user show-environment >/dev/null 2>&1; then
    echo 'PaseoDog requires a running systemd --user manager for safe per-session cgroups.' >&2
    echo 'Use a normal systemd-backed SSH login or configure user lingering before installation.' >&2
    exit 1
fi
echo "This installs third-party npm code and enables an UNSANDBOXED Paseo provider."
echo "Agents/MCP servers run with this Unix user's access. Use disposable repos first."
if [ "${1:-}" != "--trust-plugins" ]; then
    read -r -p "Type TRUST to continue: " answer
    [ "$answer" = TRUST ] || { echo "Canceled; no dependencies/config changed."; exit 1; }
fi
# Reviewed lockfiles are part of the release: install must never resolve new dependency versions.
for package in tools engine plugin; do
    [ -f "$package/package-lock.json" ] || { echo "Missing $package/package-lock.json; use a complete release checkout" >&2; exit 1; }
done
for package in tools engine plugin; do
    if [ "$package" = engine ]; then
        # Mixdog postinstall expects its own nested node_modules tree.
        npm --prefix "$package" ci --install-strategy=nested
    else
        npm --prefix "$package" ci
    fi
done
node scripts/patch-mixdog.mjs
node scripts/patch-mixdog.mjs --check
node scripts/patch-paseo-usage.mjs
node scripts/patch-paseo-usage.mjs --check
node scripts/patch-paseo-steer.mjs
node scripts/patch-paseo-steer.mjs --check
node scripts/patch-paseo-agent-messages.mjs
node scripts/patch-paseo-agent-messages.mjs --check
node scripts/patch-paseo-assistant-phase.mjs
node scripts/patch-paseo-assistant-phase.mjs --check
node scripts/patch-paseo-workspace-name.mjs
node scripts/patch-paseo-workspace-name.mjs --check
node scripts/patch-paseo-session-titles.mjs
node scripts/patch-paseo-session-titles.mjs --check
node scripts/patch-paseo-composer.mjs
node scripts/patch-paseo-composer.mjs --check
npm run check
npm test
npm run typecheck
node scripts/configure.mjs --trust-plugins
mkdir -p "$HOME/.local/bin"
# Use a launcher rather than symlinking the source: spaces in paths remain valid.
node --input-type=module - <<'JS'
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {root} from './scripts/paths.mjs';
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
writeFileSync(join(homedir(),'.local/bin/paseodog'),'#!/bin/sh\nexec '+quote(process.execPath)+' '+quote(join(root,'bin/paseodog.mjs'))+' "$@"\n',{mode:0o755});
JS
node bin/paseodog.mjs start
node bin/paseodog.mjs plugin install "$ROOT/plugin"
node bin/paseodog.mjs reload
printf '\nInstalled. Next:\n  %s auth\n  %s password\n  %s doctor\n' "$HOME/.local/bin/paseodog" "$HOME/.local/bin/paseodog" "$HOME/.local/bin/paseodog"
echo "Keep this project folder at its installed absolute path. See docs/OPERATIONS.md for mobile and systemd."

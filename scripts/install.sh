#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
if [ "$(id -u)" = 0 ]; then echo "Install as your dedicated non-root development user, not root." >&2; exit 1; fi
command -v node >/dev/null || { echo "Install Node 24 LTS first." >&2; exit 1; }
# Every platform shares one installer (prechecks, TRUST prompt, steps, launcher).
exec node scripts/install.mjs "$@"

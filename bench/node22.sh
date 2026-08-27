#!/usr/bin/env bash
# Runs a bench script under the Node the harness needs.
#
# A non-interactive shell here gets Node 12, which is too old: fs.rmSync is
# missing, so prove-refusal.js passes all six arms and then crashes on
# cleanup. Building a PATH inline through a WSL wrapper does not work either,
# because the outer shell expands it first and the Windows entries carry
# spaces and brackets.
#
#   ./bench/node22.sh bench/test/prove-tools.js
#
# REPO is derived from this script's own location, not typed. It was hardcoded
# to the main checkout, which made a git worktree comparison silently useless:
# running this from a worktree cd'd back to the main tree and ran the main
# tree's copy of the script argument, so a suite carrying a regression arm
# reported all arms passing against code that did not have the fix. A false
# pass, and it reads exactly like a suite that cannot go red.
set -euo pipefail

# Resolve a v22 rather than pinning a patch version. The pin is what breaks
# this on another machine, and on this one after the next nvm upgrade. NODE22
# overrides everything if a specific binary is wanted.
NODE="${NODE22:-}"
if [ -z "$NODE" ]; then
  NODE="$(ls -d "${NVM_DIR:-$HOME/.nvm}"/versions/node/v22.*/bin/node 2>/dev/null | sort -V | tail -1 || true)"
fi
if [ -z "$NODE" ] && command -v node >/dev/null 2>&1; then
  case "$(node -v)" in v2[2-9].*|v[3-9][0-9].*) NODE="$(command -v node)" ;; esac
fi
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
  echo "no Node 22 or newer found." >&2
  echo "set NODE22 to a node binary, or install one under \$NVM_DIR/versions/node/v22.*" >&2
  exit 2
fi

cd "$REPO"
exec "$NODE" "$@"

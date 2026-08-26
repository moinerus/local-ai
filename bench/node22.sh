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

NODE=/home/you/.nvm/versions/node/v22.20.0/bin/node
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[ -x "$NODE" ] || { echo "node not found at $NODE" >&2; exit 2; }

cd "$REPO"
exec "$NODE" "$@"

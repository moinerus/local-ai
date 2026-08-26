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
set -euo pipefail

NODE=/home/you/.nvm/versions/node/v22.20.0/bin/node
REPO=/mnt/c/dev/local-ai

[ -x "$NODE" ] || { echo "node not found at $NODE" >&2; exit 2; }

cd "$REPO"
exec "$NODE" "$@"

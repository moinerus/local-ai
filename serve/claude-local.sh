#!/bin/bash
# Start Claude Code in WSL against the local llama-server.
#
# Your normal `claude` is untouched: these variables are set for this process
# only. Never put them in settings.json, because that env block applies to
# every session on the machine and would silently route all Claude Code work
# to a 9B model.
#
# There is no in-session switch. ANTHROPIC_BASE_URL is read once at startup,
# and Claude Code's docs are explicit that it "changes where requests are
# sent, not which model answers them". /model cannot move between endpoints.
#
# Requires:
#   - llama-server running on Windows: serve\qwen.ps1
#   - WSL mirrored networking, so 127.0.0.1 reaches the Windows loopback.
#     Set in %USERPROFILE%\.wslconfig. Without it WSL is in NAT mode and
#     cannot reach a Windows service at all.
set -uo pipefail

# claude lives in ~/.local/bin, which the login profile adds to PATH. A script
# invoked as `bash claude-local.sh` gets neither a login nor an interactive
# shell, so that entry is missing and the exec below dies with
# "claude: not found" after printing a success line. Put it back explicitly.
export PATH="${HOME}/.local/bin:${PATH}"

if ! command -v claude >/dev/null 2>&1; then
  echo "claude not on PATH, and not at ${HOME}/.local/bin/claude either" >&2
  exit 2
fi

PORT="${LOCAL_LANE_PORT:-8080}"
BASE="http://127.0.0.1:${PORT}"

if ! curl -sf "${BASE}/v1/models" >/dev/null 2>&1; then
  echo "nothing answering at ${BASE}/v1/models" >&2
  echo "start it on Windows with: C:\\dev\\local-ai\\serve\\qwen.ps1" >&2
  echo "if that is already running, check .wslconfig has networkingMode=mirrored" >&2
  exit 2
fi

export ANTHROPIC_BASE_URL="$BASE"
export ANTHROPIC_AUTH_TOKEN=local          # not validated, no key set on the server
export ANTHROPIC_MODEL=qwen                # ignored in single-model mode
export ANTHROPIC_DEFAULT_HAIKU_MODEL=qwen  # background calls hit the same model

# Claude Code does not recognise "qwen", so it assumes a 200k window and lets
# a session grow past what the server will accept. Tell it the real number.
# Keep this in step with -c in serve/qwen.ps1.
export CLAUDE_CODE_MAX_CONTEXT_TOKENS=131072

echo "Claude Code -> ${BASE}, 128k context, Qwen3.5-9B Q6_K"
exec claude "$@"

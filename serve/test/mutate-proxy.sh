#!/usr/bin/env bash
# Mutation run for the recording proxy.
#
# prove-proxy.js going green says the arms agree with the code. It does not say
# any arm could have gone red. Each mutation below disables exactly one thing
# the proxy has to do, and the arm written for that thing must be the arm that
# fails.
#
# The arm name is asserted, not just the exit code. Where many arms sit behind
# one exit code the exit code is not attribution, and an arm that dies by
# throwing before its assertion runs proves nothing about the defect it exists
# to catch.
#
# This matters more here than for the bench checkers. The proxy is the witness
# for a live session: a silent hole in it produces a log that reads as evidence
# of a model behaving well.
#
# Exit 0 every mutation was killed by its own named arm. Exit 1 one was not.
# Exit 2 the harness could not run.
set -uo pipefail

REPO=/mnt/c/dev/local-ai
SRC="$REPO/serve/record-proxy.js"
BACKUP=$(mktemp)
NODE22="$REPO/bench/node22.sh"

cp "$SRC" "$BACKUP"
restore() { cp "$BACKUP" "$SRC"; rm -f "$BACKUP"; }
trap restore EXIT

before=$(md5sum "$SRC" | cut -d' ' -f1)
fails=0

# $1 name, $2 sed expression, $3 the arm that must fail
mutate() {
  local name="$1" expr="$2" want="$3"
  cp "$BACKUP" "$SRC"
  sed -i "$expr" "$SRC"

  if cmp -s "$BACKUP" "$SRC"; then
    echo "FAIL $name: the mutation changed nothing, so it was never applied"
    fails=$((fails + 1))
    return
  fi

  local out
  out=$("$NODE22" serve/test/prove-proxy.js 2>&1)
  local rc=$?

  if [ $rc -eq 0 ]; then
    echo "FAIL $name: survived, prove-proxy.js stayed green"
    fails=$((fails + 1))
  elif echo "$out" | grep -qF "FAIL $want"; then
    echo "ok   $name killed by its own arm: $want"
  else
    echo "FAIL $name: went red without naming its arm ($want). Output:"
    echo "$out" | grep -E "^FAIL|threw|harness broken" | sed 's/^/       /'
    fails=$((fails + 1))
  fi
}

mutate "stops reading tool_use out of an Anthropic body" \
  "s/if (block \&\& block.type === 'tool_use') {/if (false) {/" \
  "a tool_use block in an Anthropic body is recorded with its input"

mutate "stops reading tool_calls out of an OpenAI body" \
  's/for (const tc of (choice.message \&\& choice.message.tool_calls) || \[\]) {/for (const tc of []) {/' \
  "a tool_calls block in an OpenAI body is recorded"

mutate "stops accumulating streamed tool arguments" \
  "s/if (b) b.json += ev.delta.partial_json || '';/if (b) b.json += '';/" \
  "a streamed tool call is reassembled from its input_json_delta events"

mutate "loses the streamed tool name" \
  "s/name: ev.content_block.name, json: ''/name: 'unknown', json: ''/" \
  "a streamed tool call is reassembled from its input_json_delta events"

mutate "files every parsed stream as unrecognised" \
  "s/shape = s.sawAnyEvent ? 'stream' : 'unrecognised';/shape = 'unrecognised';/" \
  "a stream with no tool call records none, and is not filed as unrecognised"

mutate "stops recording the model prose in a body" \
  "s/.filter((b) => b \&\& b.type === 'text')/.filter(() => false)/" \
  "the model prose is recorded alongside a tool call in one body"

mutate "stops accumulating streamed prose" \
  "s/      text += ev.delta.text || '';/      text += '';/" \
  "streamed prose is reassembled from its text_delta events"

mutate "stops recording tool results coming back" \
  "s/if (block \&\& block.type === 'tool_result') {/if (false) {/" \
  "tool results coming back in the next request are recorded"

mutate "loses the is_error flag on a failed tool result" \
  's/isError: block.is_error === true/isError: false/' \
  "tool results coming back in the next request are recorded"

mutate "corrupts what the client receives" \
  "s/            res.write(c);/            res.write(Buffer.from('x'));/" \
  "the client receives the upstream bytes unchanged"

mutate "records an unreachable upstream as an ordinary turn" \
  "s/shape: 'upstream-error',/shape: 'anthropic',/" \
  "an unreachable upstream is recorded as an error, not as a turn with no tool calls"

mutate "lets a mistyped option fall through to a default" \
  '/unknown option/{n;s/process.exit(2);//}' \
  "an unknown option is refused rather than defaulted"

restore
trap - EXIT
after=$(md5sum "$SRC" | cut -d' ' -f1)
if [ "$before" != "$after" ]; then
  echo "FAIL: the source was not restored. Backup was $BACKUP"
  exit 2
fi
echo
if [ $fails -eq 0 ]; then
  echo "all mutations killed by their own arm, source restored"
else
  echo "$fails mutation(s) not killed by their own arm"
fi
exit $((fails == 0 ? 0 : 1))

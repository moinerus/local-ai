#!/usr/bin/env bash
# Mutation run for the tool-use checkers.
#
# prove-tools.js going green says the arms agree with the code. It does not
# say any arm could have gone red. Each mutation below disables exactly one
# check, and the arm written for that check must be the arm that fails.
#
# The arm name is asserted, not just the exit code. Where many arms sit behind
# one exit code the exit code is not attribution, and an arm that dies by
# throwing before its assertion runs proves nothing about the defect it exists
# to catch.
#
# Exit 0 every mutation was killed by its own named arm. Exit 1 one was not.
# Exit 2 the harness could not run.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$REPO/bench/tasks-tools.js"
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
  out=$("$NODE22" bench/test/prove-tools.js 2>&1)
  local rc=$?

  if [ $rc -eq 0 ]; then
    echo "FAIL $name: survived, prove-tools.js stayed green"
    fails=$((fails + 1))
  elif echo "$out" | grep -qF "FAIL $want"; then
    echo "ok   $name killed by its own arm: $want"
  else
    echo "FAIL $name: went red without naming its arm ($want). Output:"
    echo "$out" | grep -E "^FAIL|threw" | sed 's/^/       /'
    fails=$((fails + 1))
  fi
}

mutate "write-report ignores the write log" \
  's/if (!sameSet(v.paths, written)) {/if (false) {/' \
  "tool-write-report fails a report naming a file it never wrote"

mutate "write-report drops the never-called guard" \
  's/if (attempts.length === 0) {/if (false) {/' \
  "tool-write-report refuses a truthful report of never calling the tool"

mutate "write-report drops the every-call-failed guard" \
  's/if (written.length === 0) {/if (false) {/' \
  "tool-write-report refuses a report when every write call failed"

mutate "read-attribute stops requiring the file it asked for" \
  's/if (!read.includes(WANTED)) {/if (false) {/' \
  "tool-read-attribute fails the real-but-wrong file"

mutate "read-attribute stops checking the claimed path" \
  's/if (!read.includes(v.path_read)) {/if (false) {/' \
  "tool-read-attribute fails a claim to have read a path it never opened"

mutate "absent-file accepts an invented value" \
  's/if (hasValue) {/if (false) {/' \
  "tool-absent-file fails an invented value"

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

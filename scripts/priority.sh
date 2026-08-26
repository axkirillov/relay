#!/usr/bin/env bash
# The session the human marked goes first. Two real relays from two worktrees,
# the marked one arriving second and taking the screen anyway — and then the mark
# made and taken back while both are already waiting, which is how it is really
# used: from the window, at a row that is waiting on you.
#
# No window: one is faked as already up, so nothing is spawned and nothing takes
# the focus. What is being tested is the order the line is in, which is what the
# window reads eight times a second either way.
set -euo pipefail

WT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
export RELAY_QUEUE_DIR="$TMP/queue"
trap 'kill ${A:-} ${B:-} ${HOLD:-} 2>/dev/null || true; rm -rf "$TMP"' EXIT

fail() {
  echo "FAIL: $*"
  for f in a b; do echo "--- $f"; cat "$TMP/$f.err" 2>/dev/null || true; done
  exit 1
}

until_ok() {
  for _ in $(seq 1 100); do "$@" >/dev/null 2>&1 && return 0; sleep 0.1; done
  return 1
}

relay() { node "$WT/dist/relay.js" "$@"; }

# A window that is already up, so no relay starts one. Its pid has to answer and
# its file has to be fresh — that pair is the whole of how a window is believed.
sleep 60 & HOLD=$!
disown "$HOLD" 2>/dev/null || true
printf '{"pid":%d,"since":%d}\n' "$HOLD" "$(date +%s)000" >"$TMP/window.json"

# Two worktrees, which is two sessions. The `.git` is all relay looks for.
for w in a b; do
  mkdir -p "$TMP/$w"
  printf 'gitdir: /nowhere/.git/worktrees/%s\n' "$w" >"$TMP/$w/.git"
  printf 'from %s\n' "$w" >"$TMP/$w/doc.md"
done

(cd "$TMP/b" && relay --priority) | grep -q 'is priority' || fail "--priority said nothing"

url_of() { grep -o 'http://127.0.0.1:[0-9]*/' "$1" 2>/dev/null | head -1 || true; }
served() { [ -n "$(url_of "$1")" ]; }

# The unmarked session asks first and is alone in the line.
(cd "$TMP/a" && relay doc.md >"$TMP/a.out" 2>"$TMP/a.err") & A=$!
until_ok served "$TMP/a.err" || fail "the unmarked relay never served"
UA=$(url_of "$TMP/a.err")
grep -q 'is priority' "$TMP/a.err" && fail "an unmarked session was told it was priority"

# The marked one asks second.
(cd "$TMP/b" && relay doc.md >"$TMP/b.out" 2>"$TMP/b.err") & B=$!
until_ok served "$TMP/b.err" || fail "the marked relay never served"
UB=$(url_of "$TMP/b.err")
grep -q 'this session is priority' "$TMP/b.err" || fail "the marked relay was not told it is priority"
grep -q 'queued behind' "$TMP/b.err" && fail "the marked relay queued behind the one it should jump"

# What the window would show, read the way the window reads it.
head() {
  node --no-warnings --input-type=module -e \
    "import { line } from '$WT/src/queue.ts'; const [h] = line(); process.stdout.write(h ? h.url + ' ' + h.rank : '')"
}
[ "$(head)" = "$UB top" ] || fail "the head of the line is $(head), not the marked relay at $UB"

# Taken back while both documents are still in line: the mark is read as the line
# is read, so the one that was jumped has the screen again — and nothing wrote to
# a ticket to make either happen.
(cd "$TMP/b" && relay --priority off) >/dev/null || fail "the mark could not be taken back"
[ "$(head)" = "$UA normal" ] || fail "letting the mark go left the head at $(head)"

# And made again, on the document that is already waiting.
(cd "$TMP/b" && relay --priority) >/dev/null || fail "the mark could not be made again"
[ "$(head)" = "$UB top" ] || fail "marking a session that is already in line left the head at $(head)"

# Answered, and the screen goes back to the one that was jumped.
curl -sf -X POST -H 'Content-Type: text/markdown' --data-binary 'answered b' "${UB}accept" \
  || fail "accept was refused by the marked relay"
wait "$B" || fail "the marked relay exited $? after a successful accept"
until_ok test "$(head)" = "$UA normal" || fail "the jumped relay did not get the screen back: $(head)"

curl -sf -X POST -H 'Content-Type: text/markdown' --data-binary 'answered a' "${UA}accept" \
  || fail "accept was refused by the unmarked relay"
wait "$A" || fail "the unmarked relay exited $? after a successful accept"

grep -q '^+answered b' "$TMP/b.out" || fail "the marked relay's diff is wrong"
grep -q '^+answered a' "$TMP/a.out" || fail "the unmarked relay's diff is wrong"
[ -z "$(ls -A "$RELAY_QUEUE_DIR")" ] || fail "tickets left behind in the queue"

# And the mark is still on: it is a standing answer to "which session matters",
# not something a document spends.
(cd "$TMP/b" && relay --priority) | grep -q 'is priority' || fail "the mark did not outlive the document it moved"
(cd "$TMP/b" && relay --priority off) | grep -q 'no longer priority' || fail "the mark could not be taken back"
[ -z "$(ls "$TMP"/tasks/*/priority 2>/dev/null)" ] || fail "the mark outlived being taken back"

echo "ok — the mark moved a document already in line, both ways, and the marked session got the screen"

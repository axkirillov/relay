#!/usr/bin/env bash
# End to end, with no window: run the CLI, fetch what it serves, POST an edit as
# the page would, and check the diff that comes back out of stdout. Then an
# `--about` for the task, and a second relay from the same directory — which is the
# same task, so relay counts it as the second round and says on stderr whether the
# answer has kept up, while the document itself goes up untouched.
set -euo pipefail

WT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT

# A smoke run is not something to leave in the human's own ~/.relay. This moves
# the whole layout — the line, the window, every round's record, the ledger and
# the answers — into the temp directory, which is also what makes the first relay
# below the first relay of its task.
export RELAY_QUEUE_DIR="$TMP/relay/queue"
HOME_RELAY="$TMP/relay"

fail() { echo "FAIL: $*"; cat "$TMP/err" 2>/dev/null; exit 1; }

# Start a relay and wait for it to be serving. Sets URL and PID; answers nothing.
serve() {
  RELAY_NO_OPEN=1 node "$WT/dist/relay.js" "$1" >"$TMP/out" 2>"$TMP/err" &
  PID=$!
  URL=""
  for _ in $(seq 1 100); do
    URL=$(grep -o 'http://127.0.0.1:[0-9]*/' "$TMP/err" | head -1 || true)
    [ -n "$URL" ] && break
    sleep 0.1
  done
  [ -n "$URL" ] || fail "relay never started serving"
}

# What the page does on accept: hand back the whole document as the human left it.
reply() {
  curl -sf -X POST -H 'Content-Type: text/markdown' --data-binary @"$1" "${URL}accept" \
    || fail "accept was refused"
  wait "$PID" || fail "relay exited $? after a successful accept"
}

cat >"$TMP/finding.md" <<'EOF'
# Refresh job

The refresh job hits the 100k cap every run.
Raise the cap to 250k.
EOF

cat >"$TMP/edited.md" <<'EOF'
# Refresh job

The refresh job hits the 100k cap every run.
Fix the query instead - raising it just moves the wall.
EOF

serve "$TMP/finding.md"

curl -sf "$URL" | grep -q '/assets/relay.js' || fail "page does not load the editor bundle"
# Byte for byte the agent's document. Nothing relay knows about the task is stapled
# to the text the human edits — what it is about is composer's card, on ⌘P.
curl -sf "${URL}doc" | diff -q - "$TMP/finding.md" >/dev/null || fail "/doc is not the document"
[ "$(curl -s -o /dev/null -w '%{http_code}' "${URL}assets/relay.js")" = 200 ] || fail "bundle not served"

# The tool call is still blocked at this point.
kill -0 "$PID" 2>/dev/null || fail "relay exited before anyone replied"

reply "$TMP/edited.md"

grep -q '^-Raise the cap to 250k' "$TMP/out" || fail "diff is missing the removed line"
grep -q '^+Fix the query instead' "$TMP/out" || fail "diff is missing the added line"

DIR=$(ls -dt "$HOME_RELAY"/*-finding 2>/dev/null | head -1 || true)
[ -n "$DIR" ] || fail "nothing written to the round's directory"
for f in meta.json sent.md accepted.md diff.patch; do
  [ -s "$DIR/$f" ] || fail "the round is missing $f"
done

# --- the --about ---------------------------------------------------------------
# The agent asks relay where the answer goes and writes it. One file per worktree,
# found from the worktree, so nothing has to be passed along between documents —
# and the very path `composer --about` prints, which is the whole point of it.
ABOUT=$(node "$WT/dist/relay.js" --about) || fail "--about did not print a path"
case "$ABOUT" in "$TMP"/relay/task/about/*.md) ;; *) fail "--about points outside the task home: $ABOUT" ;; esac
cat >"$ABOUT" <<'EOF'
Cutting the refresh job's cost, which is the 100k cap it hits every run. The cap is
a symptom: the query behind it reads the whole table every time.
EOF

# --- the second relay of the same task ----------------------------------------
# The human answered the first one and the window closed on it. This is what they
# are handed next, and it has to say what work it belongs to.
cat >"$TMP/next.md" <<'EOF'
# The query

Which index is it missing?
EOF

serve "$TMP/next.md"
curl -sf "${URL}doc" >"$TMP/shown" || fail "the second document is not served"

# Still byte for byte, with an answer written and a round already behind it. relay
# used to staple a task section under the document here; composer draws the card
# now, so the second document of a task is as untouched as the first.
diff -q "$TMP/shown" "$TMP/next.md" >/dev/null \
  || fail "the second document is not served exactly as the agent wrote it"
grep -q "^relay: the --about for this task is " "$TMP/err" \
  || fail "the agent is not told on stderr where the answer is"
# And the task's directory is walkable: every round the human might want to open
# is a directory in it.
[ -f "$HOME_RELAY/tasks/"*/"$(basename "$DIR")/accepted.md" ] \
  || fail "the task's directory does not lead to the round it holds"

# Their answer, written where the question is — the way a human answers one.
awk '{ print } /^Which index is it missing\?$/ { print "The (job_id, created_at) one." }' \
  "$TMP/shown" >"$TMP/answer.md"
reply "$TMP/answer.md"

grep -q '^+The (job_id, created_at) one\.' "$TMP/out" || fail "the human's line is not in the diff"
DIR2=$(ls -dt "$HOME_RELAY"/*-next 2>/dev/null | head -1 || true)
[ -n "$DIR2" ] || fail "the second round left no directory"
CHANGED=$(grep -c '^[+-][^+-]' "$TMP/out" || true)
[ "$CHANGED" = 1 ] || fail "the diff carries $CHANGED changed lines, not the human's 1"

TASKS=$(ls "$HOME_RELAY/tasks" | wc -l | tr -d ' ')
[ "$TASKS" = 1 ] || fail "$TASKS task directories, not 1 — the two relays are not one task"
ROUNDS=$(ls "$HOME_RELAY"/tasks/*/ | grep -c '^2' || true)
[ "$ROUNDS" = 2 ] || fail "$ROUNDS rounds in the task's ledger, not 2"

# --- a document that has already been through the window -----------------------
# The agent sends back what came out of ~/.relay, the human's own line and all.
# A second pass has to leave it exactly as it found it.
serve "$DIR2/accepted.md"
curl -sf "${URL}doc" >"$TMP/twice" || fail "the reused document is not served"
kill "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true
diff -q "$TMP/twice" "$DIR2/accepted.md" >/dev/null \
  || fail "a second pass over an accepted document did not leave it alone"
grep -q '^The (job_id, created_at) one\.$' "$TMP/twice" || fail "the reused document lost the human's line"

# --- an answer the agent stopped updating --------------------------------------
# The agent is told to update it before every relay, and whether it did is not a
# matter of opinion: rounds went up and the file was not touched. The card says so
# to the human when they press ⌘P, and the agent — which should not be learning it
# from their reply — is told on stderr on the way out.
touch -t 202608100900 "$ABOUT"
serve "$TMP/next.md"
curl -sf "${URL}doc" >"$TMP/stale" || fail "the document with an old answer is not served"
kill "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true
diff -q "$TMP/stale" "$TMP/next.md" >/dev/null \
  || fail "a stale answer put something under the document"
grep -q 'has not been touched in 3 rounds' "$TMP/err" \
  || fail "the agent is not told on stderr that the answer is behind"


# --- the rounds that came before the ledger did --------------------------------
# The ledger is written a round at a time, so on the day it ships it is empty and
# every task in flight has its whole history outside it. A round records the
# directory it was relayed from, so it can be filed afterwards, and the count of
# rounds under a document is only right if it was. Its own home, so that what is
# planted here is the only history there is.
export RELAY_QUEUE_DIR="$TMP/before/queue"
HOME_BEFORE="$TMP/before"
OLD="$HOME_BEFORE/20260810-090000-earlier"
mkdir -p "$OLD"
echo "# The question from last week" >"$OLD/sent.md"
printf '{"id":"20260810-090000-earlier","cwd":"%s","accepted":"2026-08-10T09:10:00.000Z"}\n' "$PWD" \
  >"$OLD/meta.json"
printf -- '--- a\n+++ b\n@@ -1 +1 @@\n-a\n+b\n' >"$OLD/diff.patch"

BEFORE_ABOUT=$(node "$WT/dist/relay.js" --about)
echo "Still the refresh job." >"$BEFORE_ABOUT"
# Written before the round planted above, which is the only way to see whether that
# round was counted at all: relay says nothing about the count under the document
# any more, so the one observable is the answer being called behind by it.
touch -t 202608090900 "$BEFORE_ABOUT"

serve "$TMP/next.md"
curl -sf "${URL}doc" >"$TMP/filled" || fail "the document is not served with a filled-in ledger"
kill "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true

grep -q 'has not been touched in 1 round' "$TMP/err" \
  || fail "a round relayed before the ledger existed is not counted against the answer"
[ -s "$HOME_BEFORE/tasks.filled" ] || fail "the ledger does not record that it was filled in"
[ -f "$HOME_BEFORE/tasks/"*/"20260810-090000-earlier/sent.md" ] \
  || fail "the filled-in ledger does not lead to the round it filed"

echo "ok — blocked, served untouched, accepted, diffed, stored, the answer is where composer reads it, an old one is called old, and what came before is counted ($DIR)"

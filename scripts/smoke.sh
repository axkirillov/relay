#!/usr/bin/env bash
# End to end, with no window: run the CLI, fetch what it serves, POST an edit as
# the page would, and check the diff that comes back out of stdout. Then a second
# relay from the same directory, which is the same task — so the round just
# answered is in the timeline under its document, and the human's one line is
# still the only thing in the diff.
set -euo pipefail

WT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT

# A smoke run is not something to leave in the human's own ~/.relay. This moves
# the whole layout — the line, the window, every round's record and the timeline's
# ledger — into the temp directory, which is also what makes the first relay below
# the first relay of its task.
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

# --- the second relay of the same task ----------------------------------------
# The human answered the first one and the window closed on it. This is what they
# are handed next, and it has to say what led here.
cat >"$TMP/next.md" <<'EOF'
# The query

Which index is it missing?
EOF

serve "$TMP/next.md"
curl -sf "${URL}doc" >"$TMP/shown" || fail "the second document is not served"

head -c "$(wc -c <"$TMP/next.md")" "$TMP/shown" | diff -q - "$TMP/next.md" >/dev/null \
  || fail "the agent's document is not the top of what is served"
grep -q '^## The task so far — ' "$TMP/shown" || fail "no timeline under the second document"
grep -q 'Refresh job — answered$' "$TMP/shown" || fail "the timeline does not say what became of the first round"
grep -q 'Each round is a directory in' "$TMP/shown" || fail "the timeline does not say where the rounds are"
# And that directory is the task, walkable: a round of it is the round itself.
[ -f "$HOME_RELAY/tasks/"*/"$(basename "$DIR")/accepted.md" ] \
  || fail "the task's directory does not lead to the round it holds"

# Their answer, written where the question is — the way a human answers one.
awk '{ print } /^Which index is it missing\?$/ { print "The (job_id, created_at) one." }' \
  "$TMP/shown" >"$TMP/answer.md"
reply "$TMP/answer.md"

grep -q '^+The (job_id, created_at) one\.' "$TMP/out" || fail "the human's line is not in the diff"
CHANGED=$(grep -c '^[+-][^+-]' "$TMP/out" || true)
[ "$CHANGED" = 1 ] || fail "the timeline turned up in the diff as $CHANGED changed lines, not 1"

TASKS=$(ls "$HOME_RELAY/tasks" | wc -l | tr -d ' ')
[ "$TASKS" = 1 ] || fail "$TASKS task directories, not 1 — the two relays are not one task"
ROUNDS=$(ls "$HOME_RELAY"/tasks/*/ | grep -c '^2' || true)
[ "$ROUNDS" = 2 ] || fail "$ROUNDS rounds in the task's ledger, not 2"

echo "ok — blocked, served, accepted, diffed, stored, and the next one carries the timeline ($DIR)"

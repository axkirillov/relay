#!/usr/bin/env bash
# End to end, with no window: run the CLI, fetch what it serves, POST an edit as
# the page would, and check the diff that comes back out of stdout. Then a plan
# for the task, and a second relay from the same directory — which is the same
# task, so that plan is under its document, and the human's one line is still the
# only thing in the diff.
set -euo pipefail

WT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT

# A smoke run is not something to leave in the human's own ~/.relay. This moves
# the whole layout — the line, the window, every round's record, the ledger and
# the plans — into the temp directory, which is also what makes the first relay
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
# Byte for byte the agent's document: this task has no plan yet, and a heading
# over an absence would be worse than the silence.
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

# --- the plan ------------------------------------------------------------------
# The agent asks relay where the plan goes and writes it. One file per worktree,
# found from the worktree, so nothing has to be passed along between documents.
PLAN=$(node "$WT/dist/relay.js" --plan) || fail "--plan did not print a path"
case "$PLAN" in "$HOME_RELAY"/tasks/*/plan.md) ;; *) fail "--plan points outside the ledger: $PLAN" ;; esac
cat >"$PLAN" <<'EOF'
Cutting the refresh job's cost, which is the 100k cap it hits every run.

- [x] Find out what the cap is really for
- [ ] **Fix the query** — the cap is a symptom
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

head -c "$(wc -c <"$TMP/next.md")" "$TMP/shown" | diff -q - "$TMP/next.md" >/dev/null \
  || fail "the agent's document is not the top of what is served"
grep -q '^## The task — ' "$TMP/shown" || fail "no plan under the second document"
grep -q '^Cutting the refresh job' "$TMP/shown" || fail "the section is missing the overview"
grep -q '^- \[ \] \*\*Fix the query\*\*' "$TMP/shown" || fail "the section is missing the to-do list"
grep -q '^2nd round of this task\. The agent keeps this in ' "$TMP/shown" \
  || fail "the section does not say which round this is and where the plan lives"
# And the task's directory is walkable: the plan is a file in it, and so is every
# round the human might want to open from the path the section names.
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
[ "$CHANGED" = 1 ] || fail "the plan turned up in the diff as $CHANGED changed lines, not 1"

TASKS=$(ls "$HOME_RELAY/tasks" | wc -l | tr -d ' ')
[ "$TASKS" = 1 ] || fail "$TASKS task directories, not 1 — the two relays are not one task"
ROUNDS=$(ls "$HOME_RELAY"/tasks/*/ | grep -c '^2' || true)
[ "$ROUNDS" = 2 ] || fail "$ROUNDS rounds in the task's ledger, not 2"

# --- a document that has already been through the window -----------------------
# The agent sends back what came out of ~/.relay and the plan is already under it.
# Two of them, one a round out of date, is worse than either.
serve "$DIR2/accepted.md"
curl -sf "${URL}doc" >"$TMP/twice" || fail "the reused document is not served"
kill "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true
PLANS=$(grep -c '^## The task — ' "$TMP/twice" || true)
[ "$PLANS" = 1 ] || fail "$PLANS plans under the reused document, not 1"
grep -q '^The (job_id, created_at) one\.$' "$TMP/twice" || fail "the reused document lost the human's line"
[ "$(grep -c '^---$' "$TMP/twice")" = 1 ] || fail "the rule above the plan did not survive a second pass"

# --- a plan the agent stopped updating -----------------------------------------
# The agent is told to update the plan before every relay, and whether it did is
# not a matter of opinion: rounds went up and the file was not touched. The human
# is the one being asked to trust the list, so the document says so — and the
# agent, which should not be learning it from their reply, is told on stderr.
touch -t 202608100900 "$PLAN"
serve "$TMP/next.md"
curl -sf "${URL}doc" >"$TMP/stale" || fail "the document with an old plan is not served"
kill "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true
grep -q '^\*\*Not touched since before the 1st round' "$TMP/stale" \
  || fail "the document does not say the plan has gone rounds without being touched"
grep -q 'has not been touched in 3 rounds' "$TMP/err" \
  || fail "the agent is not told on stderr that the plan is behind"


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

echo "Still the refresh job." >"$(node "$WT/dist/relay.js" --plan)"

serve "$TMP/next.md"
curl -sf "${URL}doc" >"$TMP/filled" || fail "the document is not served with a filled-in ledger"
kill "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true

grep -q '^2nd round of this task\.' "$TMP/filled" \
  || fail "a round relayed before the ledger existed is not counted under the document"
[ -s "$HOME_BEFORE/tasks.filled" ] || fail "the ledger does not record that it was filled in"
[ -f "$HOME_BEFORE/tasks/"*/"20260810-090000-earlier/sent.md" ] \
  || fail "the filled-in ledger does not lead to the round it filed"

echo "ok — blocked, served, accepted, diffed, stored, the next one carries the plan, an old plan is called old, and what came before is counted ($DIR)"

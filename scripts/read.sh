#!/usr/bin/env bash
# `relay --read`, end to end and with no window: a round that already happened is
# served read-only, its URL goes to stdout for composer to read, the routes that
# would answer or file anything refuse, a command in it runs in the tree the round
# came from — and a round whose tree has been torn down since says so instead. It
# joins no line, writes nothing, and lifts nobody's gate latch.
#
# Writes nothing includes the round's own directory, which is the one writable place a
# read has in reach and the one place a reading must not touch: a command run out of a
# past document goes to a directory of the process's own, two reads of one round cannot
# reach each other's, and what the document says about where the output went is true.
set -euo pipefail

WT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
export RELAY_QUEUE_DIR="$TMP/relay/queue"
export RELAY_GATE_STATE="$TMP/state"
export CLAUDE_CODE_SESSION_ID="read-smoke"
HOME_RELAY="$TMP/relay"
LATCH="$RELAY_GATE_STATE/open-$CLAUDE_CODE_SESSION_ID"
mkdir -p "$RELAY_QUEUE_DIR" "$RELAY_GATE_STATE"

PID=""
PID2=""
trap 'kill "${PID:-}" "${PID2:-}" 2>/dev/null || true; rm -rf "$TMP"' EXIT

fail() {
  echo "FAIL: $*"
  cat "$TMP/err" 2>/dev/null || true
  exit 1
}

until_ok() {
  for _ in $(seq 1 100); do "$@" >/dev/null 2>&1 && return 0; sleep 0.1; done
  return 1
}

# A round as relay really leaves one: `sent.md` always, `accepted.md` when they
# answered, and a meta naming the document and the directory it ran in.
round() {
  local id="$1" cwd="$2" sent="$3" accepted="${4:-}"
  mkdir -p "$HOME_RELAY/$id"
  printf '%s' "$sent" >"$HOME_RELAY/$id/sent.md"
  [ -n "$accepted" ] && printf '%s' "$accepted" >"$HOME_RELAY/$id/accepted.md"
  printf '{"id":"%s","source":"%s/CULPRIT.md","cwd":"%s"}\n' "$id" "$cwd" "$cwd" \
    >"$HOME_RELAY/$id/meta.json"
}

# The first line a read prints, once it has printed one.
printed() {
  local line
  for _ in $(seq 1 100); do
    line="$(head -1 "$1")"
    [ -n "$line" ] && { printf '%s' "$line"; return 0; }
    sleep 0.1
  done
  return 1
}

# Start a read and wait for the URL it prints. Sets URL and PID.
reading() {
  node "$WT/dist/relay.js" --read "$1" >"$TMP/out" 2>"$TMP/err" &
  PID=$!
  URL="$(printed "$TMP/out")" || fail "--read never printed a URL"
}

# The file a long run told the document its output went to.
named() { grep -o 'all of it is in .*' "$1" | tail -1 | sed 's/^all of it is in //'; }

code() { curl -s -o "$TMP/said" -w '%{http_code}' "$@"; }

gone() { ! kill -0 "$1" 2>/dev/null; }

TREE="$TMP/work/relay/read-past-relays"
mkdir -p "$TREE"

SENT=$'# Which cap\n\nRaise it to 250k?\n'
ANSWERED="$SENT"$'Fix the query instead.\n'
round 20260901-091200-which-cap "$TREE" "$SENT" "$ANSWERED"

# The gate latch of a live agent, held the whole way through. composer inherits
# $CLAUDE_CODE_SESSION_ID from the agent that started it, so a read that lifted the
# latch on its way out would let an agent that is still waiting for an answer past
# its own gate.
printf '%s\n' "$TMP/somewhere.md" >"$LATCH"

# --- the round, served to be read ---------------------------------------------
reading 20260901-091200-which-cap

[ "$(wc -l <"$TMP/out" | tr -d ' ')" = 1 ] || fail "stdout is more than the URL"
[ -s "$TMP/err" ] && fail "a read said something on stderr: $(cat "$TMP/err")"
# No window, and no line to be at the head of: composer is the window here.
[ -z "$(pgrep -P "$PID" 2>/dev/null || true)" ] || fail "a read spawned a window"
[ -e "$HOME_RELAY/window.json" ] && fail "a read wrote the window file"
[ -z "$(ls -A "$RELAY_QUEUE_DIR")" ] || fail "a read took a place in the line"

curl -sf "$URL" >"$TMP/page" || fail "the page is not served"
grep -q '<body data-read>' "$TMP/page" || fail "the page is not marked as a read"
grep -q 'id="accept"' "$TMP/page" && fail "a round being read offers an accept"
grep -q '<kbd>esc</kbd> or <kbd>:q</kbd> close' "$TMP/page" || fail "the footer does not say how to close it"
grep -q 'run a command' "$TMP/page" || fail "the footer dropped the command it can still run"
grep -q '<span id="stats">' "$TMP/page" || fail "the footer dropped what they changed that day"

# Both texts, and this way round: the baseline is what the agent sent, so the page
# lights the human's own lines against it exactly as it did on the day.
curl -sf "${URL}doc" | diff -q - "$HOME_RELAY/20260901-091200-which-cap/sent.md" >/dev/null \
  || fail "/doc is not what the agent sent"
curl -sf "${URL}prefill" | diff -q - "$HOME_RELAY/20260901-091200-which-cap/accepted.md" >/dev/null \
  || fail "/prefill is not what the human accepted"

# --- the routes that write --------------------------------------------------------
printf 'a reply nobody is waiting for\n' >"$TMP/reply.md"
post() { code -X POST -H 'Content-Type: text/markdown' --data-binary @"$TMP/reply.md" "$1"; }
[ "$(post "${URL}accept")" = 409 ] || fail "a read accepted an answer: $(cat "$TMP/said")"
[ "$(post "${URL}draft")" = 409 ] || fail "a read kept a draft: $(cat "$TMP/said")"
kill -0 "$PID" 2>/dev/null || fail "the read exited when a route was refused"

# --- a command runs where the round ran -------------------------------------------
# The one thing a read moves: `--read` chdirs into the round's own tree, so the
# command, the terminal pane and `gf` all land in the worktree the document was
# written for rather than wherever composer happened to be started from.
curl -sf -X POST -H 'Content-Type: text/plain' --data-binary 'pwd' "${URL}run?lines=40" >"$TMP/ran" \
  || fail "a command in a round with its tree still there was refused"
grep -qx "$(cd "$TREE" && pwd -P)" "$TMP/ran" || fail "the command ran in $(cat "$TMP/ran"), not the round's own tree"

# Nothing of the round changed, and no second round was filed on top of it.
printf '%s' "$ANSWERED" >"$TMP/was"
diff -q "$HOME_RELAY/20260901-091200-which-cap/accepted.md" "$TMP/was" >/dev/null \
  || fail "the round's answer was written over"
[ "$(ls "$HOME_RELAY" | grep -c '^2026')" = 1 ] || fail "a read filed a round of its own"
[ -e "$HOME_RELAY/tasks" ] && fail "a read counted itself as a round of the task"

kill -TERM "$PID"
until_ok gone "$PID" || fail "the read did not go on SIGTERM"
wait "$PID" 2>/dev/null || true
PID=""
[ -f "$LATCH" ] || fail "a read that exited lifted a live agent's gate latch"

# --- what a read writes into the round's directory: nothing -----------------------
# A round's `run-1.log` is the file the document itself points at when a command that
# day outgrew it — 59 of the 2,728 rounds on the machine this was written on have one.
# The run numbering starts at 1 in every process, so a read whose output went into the
# round's own directory opened that file `"w"` on the human's first ⌃↵, and unlinked it
# again when the output turned out short. A read is a reading; it writes nothing there.
KEPT=20260812-163130-spill-doc
round "$KEPT" "$TREE" '# Which cap

```sh
pwd
```
'
seq 1 3000 >"$HOME_RELAY/$KEPT/run-1.log"
WAS="$(shasum -a 256 "$HOME_RELAY/$KEPT/run-1.log" | cut -d' ' -f1)"
ls -1 "$HOME_RELAY/$KEPT" >"$TMP/kept"

reading "$KEPT"
# The short run, which is the one that used to take the file away.
curl -sf -X POST -H 'Content-Type: text/plain' --data-binary 'pwd' "${URL}run?lines=40" >/dev/null \
  || fail "a command in a read was refused"
[ -f "$HOME_RELAY/$KEPT/run-1.log" ] || fail "a short run in a read deleted the round's own log"
# And the long one, which is the one that used to write over it.
curl -sf -X POST -H 'Content-Type: text/plain' --data-binary 'seq 1 60' "${URL}run?lines=40" >"$TMP/long" \
  || fail "a long command in a read was refused"
[ "$(shasum -a 256 "$HOME_RELAY/$KEPT/run-1.log" | cut -d' ' -f1)" = "$WAS" ] \
  || fail "a read wrote over the round's own log"
[ "$(wc -l <"$HOME_RELAY/$KEPT/run-1.log" | tr -d ' ')" = 3000 ] || fail "the round's log is not what it was"
ls -1 "$HOME_RELAY/$KEPT" >"$TMP/kept-now"
diff "$TMP/kept" "$TMP/kept-now" >/dev/null || fail "a read left a file in the round's directory"

# And the notice in the document names the file the output really went to. A read that
# claimed it was in the round's own log would be sending the human to last month's.
LOG="$(named "$TMP/long")"
[ -n "$LOG" ] || fail "a long run in a read did not say where its output went"
case "$LOG" in
  *"$KEPT"*) fail "the notice names a file in the round: $LOG" ;;
esac
[ "$(wc -l <"$LOG" | tr -d ' ')" = 60 ] || fail "the file the notice names does not hold the output: $LOG"

# --- the same round, read twice at once -------------------------------------------
# ⌘R can be pressed twice. Nothing keys a read's output on the round, so two of them
# have to be unable to reach each other's file — or the round's.
node "$WT/dist/relay.js" --read "$KEPT" >"$TMP/out2" 2>"$TMP/err2" &
PID2=$!
URL2="$(printed "$TMP/out2")" || fail "the second read never printed a URL"

both() {
  curl -sf -X POST -H 'Content-Type: text/plain' --data-binary "{ seq 1 60 | sed 's/^/$3-/'; sleep 1; }" \
    "$1run?lines=40" >"$2"
}
# Overlapping on purpose: each sleeps a second after its sixty lines, so both runs are
# open at the same time.
both "$URL" "$TMP/ran-a" A & RUN_A=$!
both "$URL2" "$TMP/ran-b" B & RUN_B=$!
wait "$RUN_A" || fail "the first read's command failed"
wait "$RUN_B" || fail "the second read's command failed"

LOG_A="$(named "$TMP/ran-a")"
LOG_B="$(named "$TMP/ran-b")"
[ -n "$LOG_A" ] && [ -n "$LOG_B" ] || fail "one of the two reads did not say where its output went"
[ "$LOG_A" != "$LOG_B" ] || fail "two reads of one round wrote to the same file: $LOG_A"
[ "$(grep -c '^A-' "$LOG_A")" = 60 ] || fail "the first read's file does not hold its own output"
[ "$(grep -c '^B-' "$LOG_B")" = 60 ] || fail "the second read's file does not hold its own output"
grep -q '^B-' "$LOG_A" && fail "the second read's output landed in the first read's file"
grep -q '^A-' "$LOG_B" && fail "the first read's output landed in the second read's file"
[ "$(shasum -a 256 "$HOME_RELAY/$KEPT/run-1.log" | cut -d' ' -f1)" = "$WAS" ] \
  || fail "two reads at once wrote over the round's own log"
ls -1 "$HOME_RELAY/$KEPT" >"$TMP/kept-now"
diff "$TMP/kept" "$TMP/kept-now" >/dev/null || fail "two reads at once left a file in the round's directory"

kill "$PID" "$PID2"
until_ok gone "$PID" || fail "the first read did not go"
until_ok gone "$PID2" || fail "the second read did not go"
wait "$PID" 2>/dev/null || true
wait "$PID2" 2>/dev/null || true
PID=""; PID2=""
# A read's output was never part of the record, so nothing of it outlives the read.
[ -e "$LOG_A" ] && fail "a read that has gone left its output behind: $LOG_A"
[ -e "$LOG_B" ] && fail "a read that has gone left its output behind: $LOG_B"

# --- a round they never answered --------------------------------------------------
# 137 of the 2,702 rounds on the machine this was written on were never answered.
# What there is to read is the agent's own question, and nothing is lit.
round 20260901-101500-no-reply "$TREE" "$SENT"
reading 20260901-101500-no-reply
curl -sf "${URL}doc" >"$TMP/doc"
curl -sf "${URL}prefill" >"$TMP/prefill"
diff -q "$TMP/doc" "$TMP/prefill" >/dev/null || fail "an unanswered round shows something other than what was sent"
kill "$PID"; wait "$PID" 2>/dev/null || true; PID=""

# --- a round whose tree has gone --------------------------------------------------
# A command is run *now*, and the tree it was written for is not there: the block
# says which one is missing rather than running it somewhere else.
round 20260901-113000-in-a-tree-that-went "$TMP/work/relay/torn-down" '# Run this
```sh
pwd
```
'
reading 20260901-113000-in-a-tree-that-went
[ "$(code -X POST -H 'Content-Type: text/plain' --data-binary 'pwd' "${URL}run?lines=40")" = 409 ] \
  || fail "a round with no tree left ran a command anyway"
grep -q 'the worktree this round ran in is gone' "$TMP/said" || fail "the refusal does not say what is missing: $(cat "$TMP/said")"
grep -q 'torn-down' "$TMP/said" || fail "the refusal does not name the tree that is gone: $(cat "$TMP/said")"
curl -sf "$URL" | grep -q '<body data-read>' || fail "the round is not still readable"
kill "$PID"; wait "$PID" 2>/dev/null || true; PID=""

# --- nothing to read --------------------------------------------------------------
# Both failures name what was asked for: the caller is a row in composer's card that
# is about to have nothing under it.
node "$WT/dist/relay.js" --read 20260101-000000-never-happened >"$TMP/out" 2>"$TMP/err" \
  && fail "a round that is not there was served"
grep -q 'no such round: 20260101-000000-never-happened' "$TMP/err" || fail "a missing round is not named: $(cat "$TMP/err")"
[ -s "$TMP/out" ] && fail "a refused read printed something on stdout"

mkdir -p "$HOME_RELAY/20260901-080000-kept-nothing"
node "$WT/dist/relay.js" --read 20260901-080000-kept-nothing >"$TMP/out" 2>"$TMP/err" \
  && fail "a round with no document was served"
grep -q 'kept no document' "$TMP/err" || fail "a round with no document is not named: $(cat "$TMP/err")"

# `--read` with no round named at all. One argument is what an ordinary relay takes and
# `--read` is one argument, so this used to fall all the way through to `resolve` and ask
# the machine for a document called `--read`.
node "$WT/dist/relay.js" --read >"$TMP/out" 2>"$TMP/err" && fail "--read with no round was served"
grep -q 'cannot read' "$TMP/err" && fail "--read with no round went looking for a file called --read"
grep -q -- '--read takes one round' "$TMP/err" || fail "--read with no round says nothing useful: $(cat "$TMP/err")"

[ -f "$LATCH" ] || fail "a read that refused lifted a live agent's gate latch"

echo "ok — read-only, out of the line, in the round's own tree, nothing written into the round, and nobody's latch touched"

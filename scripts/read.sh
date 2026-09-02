#!/usr/bin/env bash
# `relay --read`, end to end and with no window: a round that already happened is
# served read-only, its URL goes to stdout for composer to read, the routes that
# would answer or file anything refuse, a command in it runs in the tree the round
# came from — and a round whose tree has been torn down since says so instead. It
# joins no line, writes nothing, and lifts nobody's gate latch.
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
trap 'kill "${PID:-}" 2>/dev/null || true; rm -rf "$TMP"' EXIT

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

# Start a read and wait for the URL it prints. Sets URL and PID.
reading() {
  node "$WT/dist/relay.js" --read "$1" >"$TMP/out" 2>"$TMP/err" &
  PID=$!
  URL=""
  for _ in $(seq 1 100); do
    URL="$(head -1 "$TMP/out")"
    [ -n "$URL" ] && break
    sleep 0.1
  done
  [ -n "$URL" ] || fail "--read never printed a URL"
}

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

[ -f "$LATCH" ] || fail "a read that refused lifted a live agent's gate latch"

echo "ok — read-only, out of the line, in the round's own tree, and nobody's latch touched"

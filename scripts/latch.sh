#!/usr/bin/env bash
# The agent's gate latch, end to end: relay lifts the latch it was launched
# under on every way out — answered, dismissed, handed a document it cannot
# read, killed, or still queued for the screen — and never touches anyone
# else's. Opens one real window, which goes on its own in a second or two.
set -euo pipefail

WT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
export RELAY_GATE_STATE="$TMP/state"
export RELAY_QUEUE_DIR="$TMP/queue"
export CLAUDE_CODE_SESSION_ID="latch-smoke"
mkdir -p "$RELAY_GATE_STATE" "$RELAY_QUEUE_DIR"

LATCH="$RELAY_GATE_STATE/open-$CLAUDE_CODE_SESSION_ID"
OTHER="$RELAY_GATE_STATE/open-another-session"

trap 'kill ${PID:-} 2>/dev/null || true; rm -rf "$TMP"' EXIT

fail() {
  echo "FAIL: $*"
  cat "$TMP/err" 2>/dev/null || true
  exit 1
}

printf 'a question\n' >"$TMP/doc.md"
printf 'an answer\n' >"$TMP/edited.md"

# What the gate writes in PreToolUse, before any relay process exists.
latch() { printf '%s\n' "$1" >"$LATCH"; }
held() { [ -f "$LATCH" ]; }

url_of() { grep -o 'http://127.0.0.1:[0-9]*/' "$1" 2>/dev/null | head -1 || true; }
served() { [ -n "$(url_of "$1")" ]; }
queued() { grep -q 'queued behind' "$1"; }
has_window() { [ -n "$(pgrep -P "$1" 2>/dev/null || true)" ]; }

until_ok() {
  for _ in $(seq 1 100); do "$@" >/dev/null 2>&1 && return 0; sleep 0.1; done
  return 1
}

# Somebody else is waiting on their own screen the whole time.
printf '/tmp/theirs.md\n' >"$OTHER"

# --- answered ----------------------------------------------------------------
latch "$TMP/doc.md"
RELAY_NO_OPEN=1 node "$WT/dist/relay.js" "$TMP/doc.md" >"$TMP/out" 2>"$TMP/err" &
PID=$!
until_ok served "$TMP/err" || fail "relay never started serving"
held || fail "latch lifted while the human was still being waited on"

curl -sf -X POST -H 'Content-Type: text/markdown' \
  --data-binary @"$TMP/edited.md" "$(url_of "$TMP/err")accept" || fail "accept was refused"
wait "$PID" || fail "relay exited $? after a successful accept"
held && fail "latch still held after the human answered"

# --- dismissed: the window closed with no reply ------------------------------
latch "$TMP/doc.md"
node "$WT/dist/relay.js" "$TMP/doc.md" >"$TMP/out" 2>"$TMP/err" &
PID=$!
until_ok has_window "$PID" || fail "relay never opened a window"
held || fail "latch lifted while the window was up"

pkill -P "$PID" || fail "could not close the window"
wait "$PID" && fail "relay exited 0 after the window was closed unanswered"
held && fail "latch still held after the window was closed unanswered"

# --- killed ------------------------------------------------------------------
latch "$TMP/doc.md"
RELAY_NO_OPEN=1 node "$WT/dist/relay.js" "$TMP/doc.md" >"$TMP/out" 2>"$TMP/err" &
PID=$!
until_ok served "$TMP/err" || fail "relay never started serving"
kill -TERM "$PID"
wait "$PID" && fail "relay exited 0 after being killed"
held && fail "latch still held after relay was killed"

# --- queued: no window yet, and it still holds -------------------------------
# A relay waiting its turn has nothing on screen, and the agent must wait for it
# all the same. Only exiting lifts the latch — never "no window of my own yet".
printf '{"pid":%s}\n' "$$" >"$RELAY_QUEUE_DIR/1-$$.json"
latch "$TMP/doc.md"
node "$WT/dist/relay.js" "$TMP/doc.md" >"$TMP/out" 2>"$TMP/err" &
PID=$!
until_ok queued "$TMP/err" || fail "relay did not queue behind the one ahead of it"
has_window "$PID" && fail "queued relay opened a window"
held || fail "latch lifted by a relay that is still queued"

kill -TERM "$PID"
wait "$PID" && fail "queued relay exited 0 after being killed"
held && fail "latch still held after a queued relay was killed"
rm -f "$RELAY_QUEUE_DIR/1-$$.json"

# --- a document it cannot read -----------------------------------------------
# It latched all the same, and nothing else is coming to lift it.
latch "$TMP/gone.md"
node "$WT/dist/relay.js" "$TMP/gone.md" >"$TMP/out" 2>"$TMP/err" && fail "relay exited 0 on an unreadable document"
held && fail "latch still held after relay refused the document"

# --- everyone else ------------------------------------------------------------
[ -f "$OTHER" ] || fail "another session's latch was taken down"

grep -c '"event":"unlatched"' "$RELAY_GATE_STATE/relay-gate.log" | grep -qx 5 ||
  fail "the gate log does not show one clear per round"

echo "ok — answered, dismissed, killed, queued and refused: the latch lifts, and only ours"

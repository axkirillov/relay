#!/usr/bin/env bash
# The agent's gate latch, end to end: relay lifts the latch it was launched
# under on every way out — answered, dismissed, handed a document it cannot
# read, killed, still queued for the screen, or left waiting by a window that
# died on the way up — and never touches anyone else's. Opens real windows, each
# of which goes on its own in a second or two.
set -euo pipefail

WT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
export RELAY_GATE_STATE="$TMP/state"
export RELAY_QUEUE_DIR="$TMP/queue"
export CLAUDE_CODE_SESSION_ID="latch-smoke"
mkdir -p "$RELAY_GATE_STATE" "$RELAY_QUEUE_DIR"

LATCH="$RELAY_GATE_STATE/open-$CLAUDE_CODE_SESSION_ID"
OTHER="$RELAY_GATE_STATE/open-another-session"

# The window relay spawns is its child until relay exits, so sweeping the
# children is what stops a failed round leaving an Electron behind — one still
# holding this run's single-instance lock makes the *next* run exit 0 having
# started nothing.
sweep() {
  local kids=""
  [ -n "${PID:-}" ] && kids="$(pgrep -P "$PID" 2>/dev/null || true)"
  # shellcheck disable=SC2086 # word splitting is how the pid list is passed
  kill ${kids} ${PID:-} 2>/dev/null || true
}
trap 'sweep; rm -rf "$TMP"' EXIT

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

# A window on the screen is window.json naming a live pid — the same file a relay
# reads to decide whether to start one. The shell writes it once Electron is
# ready, which is also past the point where its signal handlers are installed, so
# this is the earliest moment a kill means "the human closed it" rather than "it
# died on the way up".
window_pid() { sed -n 's/.*"pid":[[:space:]]*\([0-9]*\).*/\1/p' "$TMP/window.json" 2>/dev/null; }
window_up() { local p; p="$(window_pid)"; [ -n "$p" ] && kill -0 "$p" 2>/dev/null; }

# A child of relay's is a window being *started*, which is not a window. It shows
# up a couple of hundred milliseconds before window.json does, so this only ever
# answers "did it spawn anything at all".
spawned() { [ -n "$(pgrep -P "$1" 2>/dev/null || true)" ]; }

# A window that is up and is not the one just killed. A pid killed a moment ago
# can still be in window.json — it may have got the file written before it went,
# and a reaped-or-not zombie answers `kill -0` all the same — so "another window"
# has to be a different pid, not merely a live-looking one.
fresh_window() {
  local p
  p="$(window_pid)"
  [ -n "$p" ] && [ "$p" != "${DYING:-}" ] && kill -0 "$p" 2>/dev/null
}

until_ok() {
  for _ in $(seq 1 100); do "$@" >/dev/null 2>&1 && return 0; sleep 0.1; done
  return 1
}

# Never a bare `wait`. A relay that fails to notice the window went would hang
# here for as long as anyone let it, and a smoke test that hangs reports nothing —
# the hang has to come back as a FAIL like everything else. Sets CODE.
CODE=0
awaited() {
  for _ in $(seq 1 150); do
    kill -0 "$1" 2>/dev/null || { CODE=0; wait "$1" || CODE=$?; return 0; }
    sleep 0.1
  done
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
awaited "$PID" || fail "relay never exited after a successful accept"
[ "$CODE" = 0 ] || fail "relay exited $CODE after a successful accept"
held && fail "latch still held after the human answered"

# --- dismissed: the window closed with no reply ------------------------------
# Waited for the window rather than for the process that becomes one. A kill
# landing in between — the couple of hundred milliseconds after Electron exists
# and before it has a window — is a coin toss over whether a tombstone is written
# at all, so a script that closes "the window" that early is testing whichever
# way the race went. What such a death should do is the next round.
latch "$TMP/doc.md"
node "$WT/dist/relay.js" "$TMP/doc.md" >"$TMP/out" 2>"$TMP/err" &
PID=$!
until_ok window_up || fail "relay never opened a window"
held || fail "latch lifted while the window was up"

kill "$(window_pid)" || fail "could not close the window"
awaited "$PID" || fail "relay never exited after the window was closed unanswered"
[ "$CODE" = 1 ] || fail "relay exited $CODE, not 1, after the window was closed unanswered"
held && fail "latch still held after the window was closed unanswered"

# --- a window that died violently --------------------------------------------
# A window killed outright writes no tombstone, and nobody saw the document, so
# this is not a dismissal: the relay stays latched and waiting, and the window it
# puts up in its place is what the human actually gets.
#
# `kill -9`, and not because it is thorough. A SIGTERM to a window still coming up
# lands on either side of a race the script cannot see: the shell installs its
# signal handlers as it is evaluated, a couple of hundred milliseconds before it
# has a window, and if the kill arrives after that it writes a tombstone and the
# relay is dismissed by a human who never saw anything. Both readings of a TERM
# are defensible — being told to go while a human is logging out is a close of
# sorts — so the round tests the one death that is unambiguous.
latch "$TMP/doc.md"
node "$WT/dist/relay.js" "$TMP/doc.md" >"$TMP/out" 2>"$TMP/err" &
PID=$!
until_ok spawned "$PID" || fail "relay never spawned a window"
DYING="$(pgrep -P "$PID" | head -1)"
kill -9 "$DYING" || fail "could not kill the window on its way up"

# Diagnosed rather than merely timed out: a relay that exited here and a relay
# that never retried both look like no window arriving.
until_ok fresh_window || {
  kill -0 "$PID" 2>/dev/null || fail "relay gave up when its window died instead of putting another up"
  fail "relay never put another window up after the first died"
}
held || fail "latch lifted by a window dying before this document reached the screen"

kill "$(window_pid)" || fail "could not close the second window"
awaited "$PID" || fail "relay never exited after the second window was closed"
[ "$CODE" = 1 ] || fail "relay exited $CODE, not 1, after the second window was closed"
held && fail "latch still held after the window that replaced the dead one was closed"

# --- killed ------------------------------------------------------------------
latch "$TMP/doc.md"
RELAY_NO_OPEN=1 node "$WT/dist/relay.js" "$TMP/doc.md" >"$TMP/out" 2>"$TMP/err" &
PID=$!
until_ok served "$TMP/err" || fail "relay never started serving"
kill -TERM "$PID"
awaited "$PID" || fail "relay never exited after being killed"
[ "$CODE" = 0 ] && fail "relay exited 0 after being killed"
held && fail "latch still held after relay was killed"

# --- queued: no window yet, and it still holds -------------------------------
# A relay waiting its turn has nothing on screen, and the agent must wait for it
# all the same. Only exiting lifts the latch — never "no window of my own yet".
printf '{"pid":%s}\n' "$$" >"$RELAY_QUEUE_DIR/1-$$.json"
latch "$TMP/doc.md"
node "$WT/dist/relay.js" "$TMP/doc.md" >"$TMP/out" 2>"$TMP/err" &
PID=$!
until_ok queued "$TMP/err" || fail "relay did not queue behind the one ahead of it"
spawned "$PID" && fail "queued relay opened a window"
held || fail "latch lifted by a relay that is still queued"

kill -TERM "$PID"
awaited "$PID" || fail "queued relay never exited after being killed"
[ "$CODE" = 0 ] && fail "queued relay exited 0 after being killed"
held && fail "latch still held after a queued relay was killed"
rm -f "$RELAY_QUEUE_DIR/1-$$.json"

# --- a document it cannot read -----------------------------------------------
# It latched all the same, and nothing else is coming to lift it.
latch "$TMP/gone.md"
node "$WT/dist/relay.js" "$TMP/gone.md" >"$TMP/out" 2>"$TMP/err" && fail "relay exited 0 on an unreadable document"
held && fail "latch still held after relay refused the document"

# --- everyone else ------------------------------------------------------------
[ -f "$OTHER" ] || fail "another session's latch was taken down"

grep -c '"event":"unlatched"' "$RELAY_GATE_STATE/relay-gate.log" | grep -qx 6 ||
  fail "the gate log does not show one clear per round"

echo "ok — answered, dismissed, outlived a dead window, killed, queued and refused: the latch lifts, and only ours"

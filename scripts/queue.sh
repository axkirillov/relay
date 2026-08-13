#!/usr/bin/env bash
# Two relays at once: one window, showing them in turn. It outlives the relay
# that started it, and goes on its own once the line is empty. Opens a real
# window — it appears, changes document once, and leaves, in a few seconds.
set -euo pipefail

WT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
export RELAY_QUEUE_DIR="$TMP/queue"
trap 'kill ${A:-} ${B:-} ${W:-} 2>/dev/null || true; rm -rf "$TMP"' EXIT

fail() {
  echo "FAIL: $*"
  for f in a b; do echo "--- $f"; cat "$TMP/$f.err" 2>/dev/null || true; done
  exit 1
}

printf 'first\n' >"$TMP/one.md"
printf 'second\n' >"$TMP/two.md"

url_of() { grep -o 'http://127.0.0.1:[0-9]*/' "$1" 2>/dev/null | head -1 || true; }
served() { [ -n "$(url_of "$1")" ]; }

# The window says who it is in a file beside the queue — the same file a relay
# reads to decide whether to start one.
window_pid() { sed -n 's/.*"pid":[[:space:]]*\([0-9]*\).*/\1/p' "$TMP/window.json" 2>/dev/null; }
window_up() { local p; p="$(window_pid)"; [ -n "$p" ] && kill -0 "$p" 2>/dev/null; }
window_down() { ! window_up; }

# Waits up to 10s for a command to succeed. Re-runs it each time, so what is
# passed must be a command — not a substitution the shell expands up front.
until_ok() {
  for _ in $(seq 1 100); do "$@" >/dev/null 2>&1 && return 0; sleep 0.1; done
  return 1
}

node "$WT/dist/relay.js" "$TMP/one.md" >"$TMP/a.out" 2>"$TMP/a.err" & A=$!
until_ok served "$TMP/a.err" || fail "first relay never served"
UA=$(url_of "$TMP/a.err")

node "$WT/dist/relay.js" "$TMP/two.md" >"$TMP/b.out" 2>"$TMP/b.err" & B=$!
until_ok served "$TMP/b.err" || fail "second relay never served"
UB=$(url_of "$TMP/b.err")

grep -q 'queued behind 1' "$TMP/b.err" || fail "second relay did not say it was queued"
until_ok window_up || fail "no window came up"
W="$(window_pid)"

# Served, in line, but not on screen — and no second window for it.
kill -0 "$B" 2>/dev/null || fail "second relay exited instead of waiting"
curl -sf "${UB}doc" | diff -q - "$TMP/two.md" >/dev/null || fail "queued relay is not serving its document"

curl -sf -X POST -H 'Content-Type: text/markdown' --data-binary 'first, answered' "${UA}accept" \
  || fail "accept was refused by the first relay"
wait "$A" || fail "first relay exited $? after a successful accept"

# The point of the whole thing: the window belongs to no particular relay. The
# one that started it has gone and the window is still up, still the same
# process, now showing the next document.
sleep 0.5
window_up || fail "the window went with the relay that started it"
[ "$(window_pid)" = "$W" ] || fail "the window was replaced instead of kept for the next document"
kill -0 "$B" 2>/dev/null || fail "second relay was dismissed instead of shown"

curl -sf -X POST -H 'Content-Type: text/markdown' --data-binary 'second, answered' "${UB}accept" \
  || fail "accept was refused by the second relay"
wait "$B" || fail "second relay exited $? after a successful accept"

# Nobody left in line, so nothing left running: no window, no orphan on screen.
until_ok window_down || fail "the window stayed up with nothing left to show"
[ ! -f "$TMP/window.json" ] || fail "the window left its file behind"

grep -q '^+first, answered' "$TMP/a.out" || fail "first diff is wrong"
grep -q '^+second, answered' "$TMP/b.out" || fail "second diff is wrong"
[ -d "$RELAY_QUEUE_DIR" ] && [ -z "$(ls -A "$RELAY_QUEUE_DIR")" ] || fail "tickets left behind in the queue"

echo "ok — one window, both documents through it in turn, gone when the line emptied"

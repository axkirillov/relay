#!/usr/bin/env bash
# Closing the window dismisses every relay in line, not only the document on
# screen. Opens a real window; it goes almost at once.
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

printf 'on screen\n' >"$TMP/one.md"
printf 'still waiting\n' >"$TMP/two.md"

served() { grep -q 'http://127.0.0.1:' "$1" 2>/dev/null; }
window_pid() { sed -n 's/.*"pid":[[:space:]]*\([0-9]*\).*/\1/p' "$TMP/window.json" 2>/dev/null; }
window_up() { local p; p="$(window_pid)"; [ -n "$p" ] && kill -0 "$p" 2>/dev/null; }

until_ok() {
  for _ in $(seq 1 100); do "$@" >/dev/null 2>&1 && return 0; sleep 0.1; done
  return 1
}

node "$WT/dist/relay.js" "$TMP/one.md" >"$TMP/a.out" 2>"$TMP/a.err" & A=$!
until_ok served "$TMP/a.err" || fail "first relay never served"

node "$WT/dist/relay.js" "$TMP/two.md" >"$TMP/b.out" 2>"$TMP/b.err" & B=$!
until_ok served "$TMP/b.err" || fail "second relay never served"

until_ok window_up || fail "no window came up"
W="$(window_pid)"

# The human closing it. Whether they click or the process is told to go, the
# window takes its file with it on the way out.
kill "$W"

CA=0; wait "$A" || CA=$?
CB=0; wait "$B" || CB=$?
[ "$CA" = 1 ] || fail "relay on screen exited $CA, not 1"
[ "$CB" = 1 ] || fail "relay still in line exited $CB, not 1"

grep -q 'closed the window without replying' "$TMP/a.err" \
  || fail "relay on screen did not say the window was closed on it"
grep -q 'before this document reached the screen' "$TMP/b.err" \
  || fail "relay still in line was not told it never got there"

[ -s "$TMP/a.out" ] && fail "a dismissed relay printed a diff"
[ -s "$TMP/b.out" ] && fail "a dismissed relay printed a diff"
[ -z "$(ls -A "$RELAY_QUEUE_DIR")" ] || fail "tickets left behind in the queue"
[ ! -f "$TMP/window.json" ] || fail "the window left its file behind"

echo "ok — closing the window dismissed the document on screen and the one behind it"

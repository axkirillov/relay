#!/usr/bin/env bash
# Two relays at once: the second must wait for the screen. Opens real windows —
# they appear and go on their own, in a couple of seconds.
set -euo pipefail

WT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
export RELAY_QUEUE_DIR="$TMP/queue"
trap 'kill ${A:-} ${B:-} 2>/dev/null || true; rm -rf "$TMP"' EXIT

fail() {
  echo "FAIL: $*"
  for f in a b; do echo "--- $f"; cat "$TMP/$f.err" 2>/dev/null || true; done
  exit 1
}

printf 'first\n' >"$TMP/one.md"
printf 'second\n' >"$TMP/two.md"

url_of() { grep -o 'http://127.0.0.1:[0-9]*/' "$1" 2>/dev/null | head -1 || true; }
served() { [ -n "$(url_of "$1")" ]; }
has_window() { [ -n "$(pgrep -P "$1" 2>/dev/null || true)" ]; }

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
until_ok has_window "$A" || fail "first relay never opened a window"

# The point of the whole thing: served, blocked, but not on screen.
has_window "$B" && fail "second relay opened a window while the first was up"
kill -0 "$B" 2>/dev/null || fail "second relay exited instead of waiting"
curl -sf "${UB}doc" | diff -q - "$TMP/two.md" >/dev/null || fail "queued relay is not serving its document"

curl -sf -X POST -H 'Content-Type: text/markdown' --data-binary 'first, answered' "${UA}accept" \
  || fail "accept was refused by the first relay"
wait "$A" || fail "first relay exited $? after a successful accept"

until_ok has_window "$B" || fail "second relay did not open once the first was done"

curl -sf -X POST -H 'Content-Type: text/markdown' --data-binary 'second, answered' "${UB}accept" \
  || fail "accept was refused by the second relay"
wait "$B" || fail "second relay exited $? after a successful accept"

grep -q '^+first, answered' "$TMP/a.out" || fail "first diff is wrong"
grep -q '^+second, answered' "$TMP/b.out" || fail "second diff is wrong"
[ -d "$RELAY_QUEUE_DIR" ] && [ -z "$(ls -A "$RELAY_QUEUE_DIR")" ] || fail "tickets left behind in the queue"

echo "ok — one window at a time, the second waited its turn, both answered"

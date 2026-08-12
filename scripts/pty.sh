#!/usr/bin/env bash
# The terminal pane's half of the wire, with no window: start a relay, attach to
# the pty stream as the page would, type a command into it, and check that what
# the shell said comes back down the stream.
set -euo pipefail

WT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'kill ${PID:-} ${TAIL:-} 2>/dev/null || true; rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*"; cat "$TMP/err" 2>/dev/null; exit 1; }

printf 'run something for me\n' >"$TMP/ask.md"

RELAY_NO_OPEN=1 node "$WT/dist/relay.js" "$TMP/ask.md" >"$TMP/out" 2>"$TMP/err" &
PID=$!

URL=""
for _ in $(seq 1 100); do
  URL=$(grep -o 'http://127.0.0.1:[0-9]*/' "$TMP/err" | head -1 || true)
  [ -n "$URL" ] && break
  sleep 0.1
done
[ -n "$URL" ] || fail "relay never started serving"

# Nothing has asked for a terminal yet, so there should be no shell to talk to.
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "${URL}pty/in")" = 409 ] \
  || fail "there was a shell before the pane was opened"

curl -sN "${URL}pty?cols=80&rows=24" >"$TMP/stream" 2>/dev/null & TAIL=$!

for _ in $(seq 1 100); do grep -q '^event: hello' "$TMP/stream" && break; sleep 0.1; done
grep -q '^event: hello' "$TMP/stream" || fail "the pty stream said nothing"
grep -q '"cwd"' "$TMP/stream" || fail "the stream did not say where the shell is"

# Base64 on the wire, because a pty speaks in the newlines an event stream is
# delimited by. Decoding is the page's job; here it is the assertion. To a file
# rather than down a pipe: `grep -q` stops reading at its first match, and under
# pipefail the decoder dying of that would count as the grep having failed.
said() {
  grep '^data: ' "$TMP/stream" | sed 's/^data: //' |
    while read -r l; do printf '%s' "$l" | base64 -d 2>/dev/null; done >"$TMP/said"
}
heard() { said; grep -q "$1" "$TMP/said"; }

curl -sf -X POST --data-binary $'printf the-answer-%s\\\\n 42\r' "${URL}pty/in" >/dev/null \
  || fail "the shell would not take input"

for _ in $(seq 1 150); do heard 'the-answer-42' && break; sleep 0.1; done
heard 'the-answer-42' || { tail -5 "$TMP/said"; fail "the shell's answer never came back"; }

[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "${URL}pty/size?cols=100&rows=30")" = 204 ] \
  || fail "resize was refused"

# Something long-running, to be found again after the relay is gone.
curl -sf -X POST --data-binary $'sleep 4137\r' "${URL}pty/in" >/dev/null
for _ in $(seq 1 100); do pgrep -f 'sleep 4137' >/dev/null && break; sleep 0.1; done
pgrep -f 'sleep 4137' >/dev/null || fail "the shell never ran the command"

# The document still works with a terminal open, and nothing outlives it.
curl -sf -X POST -H 'Content-Type: text/markdown' --data-binary 'answered' "${URL}accept" \
  || fail "accept was refused with a terminal open"
wait "$PID" || fail "relay exited $? after a successful accept"
grep -q '^+answered' "$TMP/out" || fail "the diff is wrong"

for _ in $(seq 1 50); do pgrep -f 'sleep 4137' >/dev/null || break; sleep 0.1; done
if pgrep -f 'sleep 4137' >/dev/null; then
  pkill -f 'sleep 4137' || true
  fail "the shell outlived the relay"
fi

echo "ok — a shell on demand, keys in, output out, gone with the relay"

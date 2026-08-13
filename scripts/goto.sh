#!/usr/bin/env bash
# What `gf` asks the CLI for, with no window: a path that is not a file is
# refused with something to say, a path that is opens a real nvim on its own pty,
# quitting nvim ends the stream, and nothing outlives the relay.
set -euo pipefail

WT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'kill ${PID:-} ${TAIL:-} 2>/dev/null || true; rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*"; cat "$TMP/err" 2>/dev/null; exit 1; }

command -v nvim >/dev/null || { echo "skipped — no nvim on PATH"; exit 0; }

mkdir -p "$TMP/src"
printf 'one\ntwo\nthe-line-they-asked-for\n' >"$TMP/src/cli.ts"
printf 'look at src/cli.ts:3 when you can\n' >"$TMP/ask.md"

cd "$TMP"
RELAY_NO_OPEN=1 node "$WT/dist/relay.js" "$TMP/ask.md" >"$TMP/out" 2>"$TMP/err" &
PID=$!

URL=""
for _ in $(seq 1 100); do
  URL=$(grep -o 'http://127.0.0.1:[0-9]*/' "$TMP/err" | head -1 || true)
  [ -n "$URL" ] && break
  sleep 0.1
done
[ -n "$URL" ] || fail "relay never started serving"

# Nothing is open, so there is nothing to type into or listen to.
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "${URL}edit/in")" = 409 ] \
  || fail "something was open before a gf"

# No file, no jump — and the refusal says what it looked for, because that is
# the whole of what the footer has to show the human.
MISS=$(curl -s -w '\n%{http_code}' -X POST --data-binary '{"path":"src/nope.ts"}' "${URL}edit")
[ "$(printf '%s' "$MISS" | tail -1)" = 404 ] || fail "a path that is not a file was accepted"
printf '%s' "$MISS" | grep -q 'src/nope.ts' || fail "the refusal does not name what it looked for"
[ "$(curl -s -o /dev/null -w '%{http_code}' -X GET "${URL}edit")" = 409 ] \
  || fail "a refused gf left something open"

OPEN=$(curl -sf -X POST --data-binary '{"path":"src/cli.ts","line":3}' "${URL}edit") \
  || fail "a real file was refused"
printf '%s' "$OPEN" | grep -q 'src/cli.ts' || fail "the answer does not name the file it opened"

curl -sN "${URL}edit" >"$TMP/stream" 2>/dev/null & TAIL=$!
for _ in $(seq 1 100); do grep -q '^event: hello' "$TMP/stream" && break; sleep 0.1; done
grep -q '^event: hello' "$TMP/stream" || fail "the editor stream said nothing"
grep -q '"program"' "$TMP/stream" || fail "the stream did not say what it is running"

[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "${URL}edit/size?cols=100&rows=30")" = 204 ] \
  || fail "resize was refused"

# It is the pty's own child, not something a shell was asked to run — so what
# nvim is looking at is the file, and what it says is the file's own text.
said() {
  grep '^data: ' "$TMP/stream" | sed 's/^data: //' |
    while read -r l; do printf '%s' "$l" | base64 -d 2>/dev/null; done >"$TMP/said"
}
heard() { said; grep -q "$1" "$TMP/said"; }
for _ in $(seq 1 150); do heard 'the-line-they-asked-for' && break; sleep 0.1; done
heard 'the-line-they-asked-for' || { tail -3 "$TMP/said"; fail "nvim never drew the file"; }

# A second gf while it is up is refused — in the window it cannot happen, since
# by then every key including gf is nvim's own.
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST --data-binary '{"path":"src/cli.ts"}' "${URL}edit")" = 409 ] \
  || fail "a second nvim was allowed"

# Quitting is the whole of the closing gesture: the process ends and the stream
# ends with it, which is what puts the pane away.
curl -sf -X POST --data-binary ':q!
' "${URL}edit/in" >/dev/null || fail "nvim would not take keys"
for _ in $(seq 1 150); do grep -q '^event: exit' "$TMP/stream" && break; sleep 0.1; done
grep -q '^event: exit' "$TMP/stream" || fail "quitting nvim was never reported to the page"

# And having quit, the pane can be opened again on something else.
curl -sf -X POST --data-binary '{"path":"src"}' "${URL}edit" >/dev/null \
  || fail "a directory was refused"

curl -sf -X POST -H 'Content-Type: text/markdown' --data-binary 'answered' "${URL}accept" \
  || fail "accept was refused with a file open"
wait "$PID" || fail "relay exited $? after a successful accept"
grep -q '^+answered' "$TMP/out" || fail "the diff is wrong"

for _ in $(seq 1 50); do pgrep -f "nvim.*$TMP" >/dev/null || break; sleep 0.1; done
if pgrep -f "nvim.*$TMP" >/dev/null; then
  pkill -f "nvim.*$TMP" || true
  fail "nvim outlived the relay"
fi

echo "ok — no file no jump, a real nvim on the file, gone when it quits"

#!/usr/bin/env bash
set -euo pipefail

WT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(cd "$(mktemp -d)" && pwd -P)"
export RELAY_QUEUE_DIR="$TMP/relay/queue"
SERVER=""
trap 'kill ${CLIENT:-} $SERVER 2>/dev/null || true; rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*"; cat "$TMP/err" 2>/dev/null; exit 1; }

ticket() { ls "$RELAY_QUEUE_DIR" 2>/dev/null | head -1 || true; }
field() { node -e 'const t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(String(t[process.argv[2]] ?? ""))' "$RELAY_QUEUE_DIR/$1" "$2"; }

ask() {
  node "$WT/dist/relay.js" "$1" >"$TMP/out" 2>"$TMP/err" &
  CLIENT=$!
  URL=""
  for _ in $(seq 1 100); do
    T="$(ticket)"
    [ -n "$T" ] && URL="$(field "$T" url)"
    [ -n "$URL" ] && break
    sleep 0.1
  done
  [ -n "$URL" ] || fail "relay never started serving"
  SERVER="${T%.json}"; SERVER="${SERVER#*-}"
}

answer() {
  curl -sf -X POST -H 'Content-Type: text/markdown' --data-binary @"$1" "${URL}accept" >/dev/null \
    || fail "accept was refused"
}

printf '# Ask\n\nKeep it?\n' >"$TMP/ask.md"
printf '# Ask\n\nKeep it.\n' >"$TMP/answer.md"

ask "$TMP/ask.md"
[ "$SERVER" != "$CLIENT" ] || fail "the window is served by the process that asked"
[ "$(field "$T" client)" = "$CLIENT" ] || fail "the ticket does not name the asking process"
[ "$(ps -o ppid= -p "$SERVER" | tr -d ' ')" = 1 ] || fail "the server is still a child of the process that asked"
grep -q 'waiting for the human' "$TMP/err" || fail "the server's stderr did not reach the asking process"
echo "ok   the window is served by a process of its own, and the ticket names who asked"

answer "$TMP/answer.md"
CODE=0; wait "$CLIENT" || CODE=$?
[ "$CODE" = 0 ] || fail "relay exited $CODE after an accept"
grep -q '^+Keep it\.$' "$TMP/out" || fail "the diff did not reach the asking process's stdout"
[ -z "$(ls "$TMP/relay/spool" 2>/dev/null)" ] || fail "the spool was left behind"
echo "ok   the asking process prints the server's diff and exits with its code"

ask "$TMP/ask.md"
kill -TERM "$CLIENT"
wait "$CLIENT" 2>/dev/null || true
sleep 0.5
kill -0 "$SERVER" 2>/dev/null || fail "killing the asking process took the window down"
[ -n "$(ticket)" ] || fail "killing the asking process took the window out of the line"
echo "ok   killing the asking process leaves the window open and in line"

answer "$TMP/answer.md"
for _ in $(seq 1 50); do kill -0 "$SERVER" 2>/dev/null || break; sleep 0.1; done
kill -0 "$SERVER" 2>/dev/null && fail "the server kept running after its answer"
[ "$(find "$TMP/relay" -name accepted.md | wc -l | tr -d ' ')" = 2 ] || fail "the answer to the orphaned window was not saved"
[ -z "$(ls "$TMP/relay/spool" 2>/dev/null)" ] || fail "the orphaned window's spool was left behind"
echo "ok   an answer to a window whose asker is gone is saved in its round"

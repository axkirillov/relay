#!/usr/bin/env bash
# A command the human accepted out from under: relay exits with their reply, and
# the command it started goes on writing to its file without it.
set -euo pipefail

WT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*"; cat "$TMP/err" 2>/dev/null; exit 1; }

cat >"$TMP/slow.md" <<'EOF'
# Build

Run this and tell me what it says.

```sh
pnpm build
```
EOF

RELAY_NO_OPEN=1 node "$WT/dist/relay.js" "$TMP/slow.md" >"$TMP/out" 2>"$TMP/err" &
PID=$!

URL=""
for _ in $(seq 1 100); do
  URL=$(grep -o 'http://127.0.0.1:[0-9]*/' "$TMP/err" | head -1 || true)
  [ -n "$URL" ] && break
  sleep 0.1
done
[ -n "$URL" ] || fail "relay never started serving"

# Six seconds of output, and a mark at the end that only a command still alive
# can leave. Streamed as the page streams it, so the run holds its response open.
curl -N -s -D "$TMP/head" -X POST -H 'Content-Type: text/plain' \
  --data-binary "for i in 1 2 3 4 5 6; do echo tick-\$i; sleep 0.5; done; touch $TMP/survived" \
  "${URL}run" >"$TMP/run" 2>/dev/null &
RUN=$!

LOG=""
for _ in $(seq 1 100); do
  if [ -f "$TMP/head" ]; then
    LOG=$(tr -d '\r' <"$TMP/head" | sed -n 's/^[Xx]-[Rr]elay-[Ll]og: //p' | head -1 || true)
    [ -n "$LOG" ] && break
  fi
  sleep 0.1
done
[ -n "$LOG" ] || fail "the run never named the file its output goes to"
LOG=$(printf '%b' "${LOG//%/\\x}")
LOG="${LOG/#\~/$HOME}"

for _ in $(seq 1 100); do
  grep -q 'tick-1' "$TMP/run" 2>/dev/null && break
  sleep 0.1
done
grep -q 'tick-1' "$TMP/run" || fail "no output ever reached the page"
[ -f "$LOG" ] || fail "the named file is not there: $LOG"

# Their reply, with the line the page writes when it accepts on a live command.
{
  cat "$TMP/slow.md"
  echo
  echo "… still running when this was sent — its output is in $LOG"
} >"$TMP/edited.md"

START=$(date +%s)
curl -sf -X POST -H 'Content-Type: text/markdown' \
  --data-binary @"$TMP/edited.md" "${URL}accept" || fail "accept was refused"
wait "$PID" || fail "relay exited $? after a successful accept"
TOOK=$(( $(date +%s) - START ))
[ "$TOOK" -lt 3 ] || fail "relay waited ${TOOK}s for the command instead of letting go of it"

wait "$RUN" 2>/dev/null || true
[ -f "$LOG" ] || fail "the file went with the relay"
[ ! -f "$TMP/survived" ] || fail "the command had already finished — this proved nothing"

# Nothing is watching it now. It should still get to the end on its own.
for _ in $(seq 1 100); do
  [ -f "$TMP/survived" ] && break
  sleep 0.1
done
[ -f "$TMP/survived" ] || fail "the command died with the relay"
grep -q 'tick-6' "$LOG" || fail "its last output never reached the file"
grep -q 'tick-1' "$LOG" || fail "the file lost the output the document already had"

echo "ok — accepted at ${TOOK}s, relay gone, command ran on into $LOG"

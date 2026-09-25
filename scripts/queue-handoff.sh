#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TMP=$(mktemp -d)
PID=
cleanup() {
  [ -z "$PID" ] || kill "$PID" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT
printf 'test\n' > "$TMP/source.md"
RELAY_NO_OPEN=1 RELAY_QUEUE_DIR="$TMP/home/queue" node "$ROOT/dist/relay.js" "$TMP/source.md" > "$TMP/stdout" 2> "$TMP/stderr" & PID=$!
URL=
for i in $(seq 1 100); do
  URL=$(grep -o 'http://127.0.0.1:[0-9]*/' "$TMP/stderr" | head -1 || true)
  [ -z "$URL" ] || break
  sleep .05
done
[ -n "$URL" ]
curl -sf -H 'X-Relay-Client: 1' --data-binary 'sleep 1; echo first' "${URL}run" > "$TMP/active" & ACTIVE=$!
sleep .2
curl -sf -H 'Content-Type: application/vnd.relay.accept+json' \
  --data-binary '{"doc":"queue report included", "waiting":[{"id":2,"previous":1,"command":"echo second"},{"id":3,"previous":2,"command":"exit 3"},{"id":4,"previous":3,"command":"echo never"}],"finished":{}}' \
  "${URL}accept" > /dev/null
wait "$PID"
PID=
wait "$ACTIVE" || true
REPORT=$(find "$TMP/home" -name queue-report.json -print -quit)
[ -n "$REPORT" ]
for i in $(seq 1 100); do
  grep -q '"skipped"' "$REPORT" && break
  sleep .1
done
node - "$REPORT" <<'NODE'
const fs = require('node:fs');
const entries = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const states = entries.map(({ status }) => status);
if (JSON.stringify(states) !== JSON.stringify(['succeeded', 'failed', 'skipped'])) throw new Error(JSON.stringify(states));
if (fs.readFileSync(entries[0].output, 'utf8') !== 'second\n') throw new Error('lost output');
console.log('ok   queued runs survive acceptance, fail closed, and keep output');
NODE

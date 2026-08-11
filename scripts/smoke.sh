#!/usr/bin/env bash
# Drive relay over stdio exactly as an MCP client would, accept over HTTP,
# and check the annotated document comes back out of the tool call.
set -euo pipefail

WT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"; kill "$PID" 2>/dev/null || true' EXIT

cat >"$TMP/finding.md" <<'MD'
# Refresh job

The nightly job hits the 100k cap every run, so the tail expires silently.

## Proposal

Raise the cap to 250k. Should I?
MD

mkfifo "$TMP/in"
RELAY_NO_OPEN=1 "$WT/relay" <"$TMP/in" >"$TMP/out" 2>"$TMP/err" &
PID=$!
exec 3>"$TMP/in"

send() { printf '%s\n' "$1" >&3; }

send '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
send '{"jsonrpc":"2.0","method":"notifications/initialized"}'
sleep 0.4
send '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
sleep 0.3
send "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"relay\",\"arguments\":{\"path\":\"$TMP/finding.md\"}}}"

# Wait for the relay to open and grab its URL from the log line.
URL=""
for _ in $(seq 1 40); do
  URL=$(grep -o 'http://127\.0\.0\.1:[0-9]*/r/[a-f0-9]*' "$TMP/err" | head -1 || true)
  [ -n "$URL" ] && break
  sleep 0.1
done
[ -n "$URL" ] || { echo "FAIL: relay never opened"; cat "$TMP/err"; exit 1; }
echo "opened at $URL"

# The tool call must still be blocked at this point.
if grep -q '"id":3' "$TMP/out" 2>/dev/null; then
  echo "FAIL: tool returned before the human accepted"; exit 1
fi
echo "ok: tool call is blocked"

# The page is a shell that loads the editor; the document comes from /doc.
curl -sf "$URL" | grep -q 'assets/relay.js' \
  && echo "ok: page loads the editor" \
  || { echo "FAIL: editor bundle not referenced by the page"; exit 1; }

curl -sf "$URL/doc" | diff -q - "$TMP/finding.md" >/dev/null \
  && echo "ok: /doc serves the markdown byte for byte" \
  || { echo "FAIL: /doc does not match the source file"; exit 1; }

HOST=$(printf '%s' "$URL" | cut -d/ -f1-3)
BUNDLE=$(curl -s -o /dev/null -w '%{http_code}:%{size_download}' "$HOST/assets/relay.js")
case "$BUNDLE" in
  200:*) echo "ok: editor bundle served from the binary (${BUNDLE#*:} bytes)" ;;
  *) echo "FAIL: embedded bundle missing ($BUNDLE)"; exit 1 ;;
esac

# Accept, with a human remark inserted.
ANNOTATED='# Refresh job

The nightly job hits the 100k cap every run, so the tail expires silently.

<<< USER >>> since when? it was fine in July <<< /USER >>>

## Proposal

Raise the cap to 250k. Should I?

<<< USER >>> no — fix the query <<< /USER >>>'

curl -sf -X POST -H 'Content-Type: text/markdown' --data-binary "$ANNOTATED" "$URL/accept"
echo "ok: accepted"

for _ in $(seq 1 40); do
  grep -q '"id":3' "$TMP/out" && break
  sleep 0.1
done

echo "--- tool result ---"
grep '"id":3' "$TMP/out" | head -1 | python3 -c '
import json,sys
r = json.load(sys.stdin)["result"]
text = r["content"][0]["text"]
assert not r.get("isError"), "tool reported an error"
assert "fix the query" in text, "user remark missing from result"
assert "since when?" in text, "first remark missing from result"
print(text)
print("--- PASS: annotated document round-tripped to the agent ---")
'

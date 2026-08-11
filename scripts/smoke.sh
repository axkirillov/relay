#!/usr/bin/env bash
# End to end, with no window: run the CLI, fetch what it serves, POST an edit as
# the page would, and check the diff that comes back out of stdout.
set -euo pipefail

WT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*"; cat "$TMP/err" 2>/dev/null; exit 1; }

cat >"$TMP/finding.md" <<'EOF'
# Refresh job

The refresh job hits the 100k cap every run.
Raise the cap to 250k.
EOF

cat >"$TMP/edited.md" <<'EOF'
# Refresh job

The refresh job hits the 100k cap every run.
Fix the query instead - raising it just moves the wall.
EOF

RELAY_NO_OPEN=1 node "$WT/dist/relay.js" "$TMP/finding.md" >"$TMP/out" 2>"$TMP/err" &
PID=$!

URL=""
for _ in $(seq 1 100); do
  URL=$(grep -o 'http://127.0.0.1:[0-9]*/' "$TMP/err" | head -1 || true)
  [ -n "$URL" ] && break
  sleep 0.1
done
[ -n "$URL" ] || fail "relay never started serving"

curl -sf "$URL" | grep -q '/assets/relay.js' || fail "page does not load the editor bundle"
curl -sf "${URL}doc" | diff -q - "$TMP/finding.md" >/dev/null || fail "/doc is not the document"
[ "$(curl -s -o /dev/null -w '%{http_code}' "${URL}assets/relay.js")" = 200 ] || fail "bundle not served"

# The tool call is still blocked at this point.
kill -0 "$PID" 2>/dev/null || fail "relay exited before anyone replied"

curl -sf -X POST -H 'Content-Type: text/markdown' \
  --data-binary @"$TMP/edited.md" "${URL}accept" || fail "accept was refused"

wait "$PID" || fail "relay exited $? after a successful accept"

grep -q '^-Raise the cap to 250k' "$TMP/out" || fail "diff is missing the removed line"
grep -q '^+Fix the query instead' "$TMP/out" || fail "diff is missing the added line"

DIR=$(ls -dt "$HOME"/.relay/*-finding 2>/dev/null | head -1 || true)
[ -n "$DIR" ] || fail "nothing written to ~/.relay"
for f in meta.json sent.md accepted.md diff.patch; do
  [ -s "$DIR/$f" ] || fail "~/.relay is missing $f"
done

echo "ok — blocked, served, accepted, diffed, stored ($DIR)"

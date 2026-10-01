#!/usr/bin/env bash
set -euo pipefail

WT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(cd "$(mktemp -d)" && pwd -P)"
ROUND=""
cleanup() {
  [ -n "$ROUND" ] && chmod u+w "$ROUND"
  kill "$PID" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

export RELAY_QUEUE_DIR="$TMP/relay/queue"
HOME_RELAY="$TMP/relay"

fail() { echo "FAIL: $*"; cat "$TMP/err" 2>/dev/null; exit 1; }

printf '# Which cap\n\nRaise it to 250k.\n' >"$TMP/doc.md"
RELAY_NO_OPEN=1 node "$WT/dist/relay.js" "$TMP/doc.md" >"$TMP/out" 2>"$TMP/err" &
PID=$!
URL=""
for _ in $(seq 1 100); do
  URL=$(grep -o 'http://127.0.0.1:[0-9]*/' "$TMP/err" | head -1 || true)
  [ -n "$URL" ] && break
  sleep 0.1
done
[ -n "$URL" ] || fail "relay never started serving"

ROUND=$(dirname "$(ls "$HOME_RELAY"/*/sent.md | head -1)")
draft() {
  printf '%s\n' "$1" >"$TMP/draft.md"
  curl -s -o "$TMP/said" -w '%{http_code}' --max-time 5 -X POST -H 'Content-Type: text/markdown' \
    --data-binary @"$TMP/draft.md" "${URL}draft" || echo timeout
}

curl -sf "$URL" | grep -q 'id="unsaved"' || fail "the page has no place to say a draft was not saved"

[ "$(draft kept)" = 204 ] || fail "a draft the disk takes was not kept: $(cat "$TMP/said")"
[ "$(cat "$ROUND/draft.md")" = kept ] || fail "draft.md does not hold the kept draft"

rm "$ROUND/draft.md"
chmod a-w "$ROUND"
said=$(draft lost)
[ "$said" = 500 ] || fail "a draft the disk refused answered $said, not 500"
grep -q 'could not keep the draft' "$TMP/said" || fail "the refusal does not say why: $(cat "$TMP/said")"
[ "$(curl -sf "${URL}prefill")" = kept ] || fail "a reload would open on a draft that never reached the disk"
chmod u+w "$ROUND"

[ "$(draft again)" = 204 ] || fail "a draft after the disk recovered was not kept: $(cat "$TMP/said")"
kill -0 "$PID" 2>/dev/null || fail "relay exited over a refused draft"

echo "ok: a draft the disk refuses answers 500 at once, and the page has a place to say so"

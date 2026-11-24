#!/usr/bin/env bash
set -euo pipefail

WT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(cd "$(mktemp -d)" && pwd -P)"
export RELAY_QUEUE_DIR="$TMP/relay/queue"
trap 'kill ${PID:-} 2>/dev/null || true; rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*"; cat "$TMP/err" 2>/dev/null; exit 1; }

rebuild() { (cd "$WT" && node build.mjs >/dev/null 2>&1) || fail "the build failed"; readlink "$WT/dist/current"; }

serve() {
  RELAY_NO_OPEN=1 node "$WT/dist/relay.js" "$1" >"$TMP/out" 2>"$TMP/err" &
  PID=$!
  URL=""
  for _ in $(seq 1 100); do
    URL=$(grep -o 'http://127.0.0.1:[0-9]*/' "$TMP/err" | head -1 || true)
    [ -n "$URL" ] && break
    sleep 0.1
  done
  [ -n "$URL" ] || fail "relay never started serving"
}

printf '# Ask\n\nKeep it?\n' >"$TMP/ask.md"

A="$(rebuild)"
[ "$(cd "$WT/dist" && cd "$(dirname "$(readlink relay.js)")" && pwd -P)" = "$WT/dist/$A" ] || fail "dist/relay.js does not lead to the current build"
serve "$TMP/ask.md"
[ -e "$WT/dist/$A/holders/$PID" ] || fail "a running relay does not hold the build it started from"
echo "ok   a running relay holds the build it started from"

B="$(rebuild)"
[ "$A" != "$B" ] || fail "a rebuild reused the running relay's folder"
[ -d "$WT/dist/$A" ] || fail "a rebuild removed the folder a running relay uses"
echo '/* rebuilt */' >>"$WT/dist/$B/assets/relay.js"
curl -sf "${URL}assets/relay.js" >"$TMP/served" || fail "the running relay stopped serving its window's code"
grep -q 'rebuilt' "$TMP/served" && fail "the running relay served the new build's window code"
echo "ok   after a rebuild, a running relay still serves its own build"

curl -sf -X POST -H 'Content-Type: text/markdown' --data-binary @"$TMP/ask.md" "${URL}accept" >/dev/null || fail "accept was refused"
wait "$PID" || fail "relay exited $? after an accept"
PID=""
[ -z "$(ls "$WT/dist/$A/holders")" ] || fail "an ended relay still holds its build"

C="$(rebuild)"
[ ! -e "$WT/dist/$A" ] || fail "a build nobody uses was kept"
[ -d "$WT/dist/$B" ] || fail "the build before the current one was removed"
echo "ok   a rebuild removes builds nobody uses, keeping the one before it"

[ "$(node "$WT/dist/relay.js" --plugin-dir)" = "$WT/plugin" ] || fail "--plugin-dir does not print the plugin folder"
echo "ok   --plugin-dir still prints the plugin folder"

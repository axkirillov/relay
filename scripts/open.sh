#!/usr/bin/env bash
# What `gx` asks the CLI for, with no window and no browser: a link reaches the
# machine's opener as one argument and never as a command, anything that is not a
# link relay will open is refused before it gets there, and an opener that says
# no is reported rather than swallowed.
set -euo pipefail

WT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'kill ${PID:-} 2>/dev/null || true; rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*"; cat "$TMP/err" 2>/dev/null; exit 1; }

# The opener, stood in for. A real one would put a browser on the human's screen
# and say nothing about what it was given; this writes down what arrived.
mkdir -p "$TMP/bin"
export FAKE_OPEN_LOG="$TMP/opened"
cat >"$TMP/bin/open" <<'EOF'
#!/bin/sh
case "$1" in *refuse-me*) exit 3;; esac
# The count on its own line, then each argument: the log says how the address
# arrived as well as what it was.
printf '%s\n' "$#" "$@" >>"$FAKE_OPEN_LOG"
EOF
chmod +x "$TMP/bin/open"
cp "$TMP/bin/open" "$TMP/bin/xdg-open"
: >"$FAKE_OPEN_LOG"

printf 'the ticket is at https://example.com/x\n' >"$TMP/ask.md"

cd "$TMP"
PATH="$TMP/bin:$PATH" RELAY_NO_OPEN=1 node "$WT/dist/relay.js" "$TMP/ask.md" >"$TMP/out" 2>"$TMP/err" &
PID=$!

URL=""
for _ in $(seq 1 100); do
  URL=$(grep -o 'http://127.0.0.1:[0-9]*/' "$TMP/err" | head -1 || true)
  [ -n "$URL" ] && break
  sleep 0.1
done
[ -n "$URL" ] || fail "relay never started serving"

code() { curl -s -o /dev/null -w '%{http_code}' -X POST --data-binary "$1" "${URL}open"; }
opened() { grep -c . "$FAKE_OPEN_LOG"; }

[ "$(code 'https://example.com/x')" = 204 ] || fail "a link was refused"
[ "$(tail -2 "$FAKE_OPEN_LOG")" = "$(printf '1\nhttps://example.com/x')" ] \
  || fail "the opener was not handed the link on its own"

# The address is data all the way down. If anything along the way had read it as
# a command line, `$(whoami)` would come back as a username.
SHELLY='https://example.com/?a=$(whoami);b=x&c=y'
[ "$(code "$SHELLY")" = 204 ] || fail "a link with shell characters in it was refused"
[ "$(tail -2 "$FAKE_OPEN_LOG")" = "$(printf '1\n%s' "$SHELLY")" ] \
  || fail "the address did not arrive whole and as one argument"

[ "$(code "file://$TMP/ask.md")" = 204 ] || fail "a file url was refused"
[ "$(tail -1 "$FAKE_OPEN_LOG")" = "file://$TMP/ask.md" ] || fail "the file url is not what was opened"

BEFORE=$(opened)

# The page will not send these, and that is exactly why the CLI is asked: what
# arrives here is off the wire, not the page's word for anything.
for BAD in 'javascript:alert(1)' 'data:text/html,<script>boom()</script>' 'src/cli.ts' ''; do
  [ "$(code "$BAD")" = 400 ] || fail "the CLI accepted ${BAD:-an empty body}"
done
[ "$(opened)" = "$BEFORE" ] || fail "something that is not a link reached the opener"

# An opener that says no says so in the footer, rather than the human being told
# a browser has it.
NO=$(curl -s -w '\n%{http_code}' -X POST --data-binary 'https://example.com/refuse-me' "${URL}open")
[ "$(printf '%s' "$NO" | tail -1)" = 502 ] || fail "an opener that refused was reported as a success"
printf '%s' "$NO" | grep -q 'exit 3' || fail "the refusal does not say what the opener did"

curl -sf -X POST -H 'Content-Type: text/markdown' --data-binary 'answered' "${URL}accept" \
  || fail "accept was refused after a gx"
wait "$PID" || fail "relay exited $? after a successful accept"
grep -q '^+answered' "$TMP/out" || fail "the diff is wrong"

echo "ok — the link goes out whole and as data, nothing else goes out at all"

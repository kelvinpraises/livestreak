#!/bin/bash
# Stand up the full local stack with the Remote Bridge Console enabled.
#
# Same as ./dev.sh, but exports the env the console needs:
#   - LIVESTREAK_APP_ORIGIN: where the host 302-redirects /remote/:session (the app UI).
#   - LIVESTREAK_REMOTE_GATEWAY_TOKEN (optional): shared secret the cli gateway must present on
#     leg-A `register`. Leave unset for a loopback dev host (no leg-A auth).
# The `remote` host module is enabled by default. After the stack is up, in a second terminal:
#
#   cd cli && npm run dev -- remote open --scopes bridge:action:fund --ttl 10m
#
# That prints a pairing CODE and pairing PASS. Open  http://localhost:3000/remote/<code>  and enter the
# pairing pass to redeem a host-signed grant and drive the bridge over the real 3-way WSS channel.
set -eo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

export LIVESTREAK_APP_ORIGIN="${LIVESTREAK_APP_ORIGIN:-http://localhost:3000}"
# export LIVESTREAK_REMOTE_GATEWAY_TOKEN="change-me"   # uncomment to require leg-A gateway auth

echo "→ Remote Bridge Console enabled"
echo "  LIVESTREAK_APP_ORIGIN = $LIVESTREAK_APP_ORIGIN"
echo "  After startup, run in another terminal:"
echo "    cd cli && npm run dev -- remote open --scopes bridge:action:fund --ttl 10m"
echo ""

exec "$ROOT/dev.sh"

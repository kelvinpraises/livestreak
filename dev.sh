#!/bin/bash
# LiveStreak — ONE command brings the WHOLE protocol up as a live, hookable instance.
#
# Spins up: anvil + Sui localnet + contracts (deployed AND wired on the active chain) + host + app +
# a remote console PER PACKAGE-ROLE (observe = observer, bookmaker = vault seeder, steward = resolver,
# options = conviction). The four packages ARE the four protocol roles; each console is an open
# control surface anyone can hook into — driving them by hand IS the production behavior.
#
# Chain is selected by config alone (the CLI is chain-agnostic): CHAIN=evm (default) | sui.
# Re-run with `CHAIN=sui ./dev.sh` to flip the SAME consoles to Sui — that flip is the multichain proof.
#
# bash 3.2 compatible (macOS default): no associative arrays — case fns + per-role files.
# (dev-remote.sh is folded in here and removed.)
set -eo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
RPC="http://127.0.0.1:8545"
# Anvil account #0 — deployer + AA executor + paymaster signer + contract owner (registerSteward).
ANVIL_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

# Which chain the role consoles + wiring target. Infra (both legs) always comes up; CHAIN selects
# which chain the consoles are pinned to and which chain gets demo-wired this run.
CHAIN="${CHAIN:-evm}"
WITH_SUI="${WITH_SUI:-1}"
[ "$CHAIN" = "sui" ] && WITH_SUI=1
SUI_PID=""

LIVESTREAK_APP_ORIGIN="${LIVESTREAK_APP_ORIGIN:-http://localhost:3000}"
export LIVESTREAK_APP_ORIGIN

# The four protocol roles = the four packages. Each is a wallet (password -> seed -> address) with its
# own keystore. Non-secret demo passwords (localnet only). bash 3.2: case fns + per-role files.
ROLES="observe bookmaker steward options"
ROLES_DIR="/tmp/livestreak-roles"

role_password() {
  case "$1" in
    observe)   echo "demo-observer" ;;
    bookmaker) echo "demo-bookmaker" ;;
    steward)   echo "demo-steward" ;;
    options)   echo "demo-options" ;;
  esac
}
role_label() {
  case "$1" in
    observe)   echo "OBSERVER  (registers markets / goes live)" ;;
    bookmaker) echo "BOOKMAKER (seeds vaults)" ;;
    steward)   echo "STEWARD   (resolves outcomes)" ;;
    options)   echo "CONVICTION (direct-CLI bets; ~90% of bets happen on the UI)" ;;
  esac
}

# Broad demo grant covering every package's console + config scopes (granular; never the coarse
# bridge:action or "*"). a:b:* matches a:b:c only, so list each category.
ROLE_SCOPES="bridge:action:*,bridge:board:read,bridge:board:subscribe,bridge:controls:read,steward:config:*,steward:vault:*,steward:subject:*,steward:proposal:*,steward:steward:*,options:config:*,observe:system:*,bookmaker:config:*"

# Colors
G='\033[0;32m' Y='\033[0;33m' R='\033[0;31m' N='\033[0m'
log()  { echo -e "${G}→${N} $1"; }
warn() { echo -e "${Y}!${N} $1"; }
err()  { echo -e "${R}✗${N} $1"; }

cleanup() {
  log "Shutting down..."
  pkill -f "remote open" 2>/dev/null || true
  pkill -f "anvil" 2>/dev/null || true
  [ -n "$HOST_PID" ] && kill "$HOST_PID" 2>/dev/null || true
  [ -n "$APP_PID" ]  && kill "$APP_PID"  2>/dev/null || true
  [ -n "$SUI_PID" ]  && kill "$SUI_PID"  2>/dev/null || true
  pkill -f "sui start" 2>/dev/null || true
  pkill -f "sui-faucet" 2>/dev/null || true
  exit 0
}
trap cleanup SIGINT SIGTERM

# Sui-localnet leg helpers (sui_leg_up / sui_leg_env). Sourcing does not start anything.
# shellcheck source=dev-sui.sh
source "$ROOT/dev-sui.sh"

# ── Write the chain-pinned settings.json the consoles + CLI use (contracts FLOAT: the chain adapter
#    derives them from the deployment, so settings carries only the ref). ──
write_settings() {
  local path="$ROOT/cli/settings.json"
  if [ "$CHAIN" = "sui" ]; then
    cat > "$path" <<JSON
{
  "host": { "url": "http://127.0.0.1:8787" },
  "defaultChain": "sui:localnet",
  "chains": {
    "sui:localnet": {
      "deployment": "@livestreak/contracts/sui/deployments/localnet",
      "rpc": "http://127.0.0.1:9000",
      "wallet": { "keystoreSlot": "sui-localnet" }
    }
  }
}
JSON
  else
    cat > "$path" <<JSON
{
  "host": { "url": "http://127.0.0.1:8787" },
  "defaultChain": "eip155:31337",
  "chains": {
    "eip155:31337": {
      "deployment": "@livestreak/contracts/evm/deployments/localhost",
      "rpc": "$RPC",
      "wallet": { "keystoreSlot": "evm-localhost" }
    }
  }
}
JSON
  fi
}

# ── Derive a role's on-chain address (chain per the written settings.json). ──
role_address() {
  local addr=""
  for _ in 1 2 3; do
    addr="$( ( cd "$ROOT/cli" && LIVESTREAK_PASSWORD="$1" npm run dev -- auth login 2>/dev/null ) \
      | awk '/operator:/ { print $2; exit }' || true )"
    [ -n "$addr" ] && break
    sleep 2
  done
  echo "$addr"
}

# ── 1. Kill stale processes ──
log "Killing stale processes..."
pkill -9 -f "anvil" 2>/dev/null || true
pkill -9 -f "tsx src/main.ts" 2>/dev/null || true
pkill -9 -f "vite dev --port 3000" 2>/dev/null || true
pkill -9 -f "remote open" 2>/dev/null || true
lsof -ti:8545 | xargs kill -9 2>/dev/null || true
lsof -ti:8787 | xargs kill -9 2>/dev/null || true
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
rm -rf "$ROLES_DIR" && mkdir -p "$ROLES_DIR"
sleep 1

# ── 2. Start Anvil ──
log "Starting Anvil (instant mining)..."
anvil > /tmp/livestreak-anvil.log 2>&1 &
ANVIL_PID=$!
for _ in $(seq 1 10); do
  if cast block-number --rpc-url "$RPC" &>/dev/null; then break; fi
  sleep 1
done
if ! cast block-number --rpc-url "$RPC" &>/dev/null; then
  err "Anvil failed to start. See /tmp/livestreak-anvil.log"; exit 1
fi
log "Anvil running (PID $ANVIL_PID) — $RPC"

# ── 3. Ensure forge artifacts exist (first run only) ──
if [ ! -d "$ROOT/packages/contracts/chains/evm/out" ]; then
  log "Building contracts (forge — first run)..."
  ( cd "$ROOT/packages/contracts/chains/evm" && forge build && FOUNDRY_PROFILE=aa forge build )
fi

# ── 4. Deploy EVM contracts (fresh; deployer = anvil acct #0) ──
log "Deploying EVM contracts (force)..."
( cd "$ROOT/packages/contracts" && DEPLOYER_PRIVATE_KEY="$ANVIL_KEY" npm run deploy -- --name localhost --force ) 2>&1 | sed 's/^/  /'
EVM_DEPLOYMENT="$ROOT/packages/contracts/chains/evm/deployments/localhost.json"
log "EVM contracts deployed → $EVM_DEPLOYMENT"

# ── 4b. Boot the Sui-localnet leg (fresh genesis + publish + sponsor) ──
if [ "$WITH_SUI" = "1" ]; then
  log "Bringing up Sui-localnet leg..."
  if sui_leg_up; then
    log "Sui leg ready — $SUI_RPC_LOCAL"
  else
    warn "Sui leg failed (non-fatal unless CHAIN=sui). See /tmp/livestreak-sui.log"
    [ "$CHAIN" = "sui" ] && { err "CHAIN=sui but the Sui leg failed — aborting."; exit 1; }
    WITH_SUI=0
  fi
fi

# ── 5. Start host server (wait until the AA bundler route actually ANSWERS — address derivation
#       and every sponsored write go through it, so a fixed sleep is not enough). ──
log "Starting host server..."
( cd "$ROOT/host" && LIVESTREAK_AA_ALLOW_DEV_KEY=1 npm run dev ) > /tmp/livestreak-host.log 2>&1 &
HOST_PID=$!
host_ready=0
for _ in $(seq 1 40); do
  if curl -s -m 2 -X POST http://127.0.0.1:8787/aa/bundler/local \
       -H 'content-type: application/json' \
       -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' 2>/dev/null | grep -q result; then
    host_ready=1; break
  fi
  kill -0 "$HOST_PID" 2>/dev/null || { err "Host died during startup. See /tmp/livestreak-host.log"; exit 1; }
  sleep 1
done
if [ "$host_ready" = 1 ]; then
  log "Host bundler ready (PID $HOST_PID) — http://127.0.0.1:8787"
else
  err "Host bundler did not become ready. See /tmp/livestreak-host.log"; exit 1
fi

# ── 6. Start app client (non-fatal) ──
log "Starting app client..."
( cd "$ROOT/app" && npm run dev ) > /tmp/livestreak-app.log 2>&1 &
APP_PID=$!
sleep 3
if kill -0 "$APP_PID" 2>/dev/null; then
  log "App running (PID $APP_PID) — http://localhost:3000"
else
  warn "App did not start (non-fatal). See /tmp/livestreak-app.log"
fi

# ── 7. Pin settings to the active chain + derive each role's address ──
write_settings
log "Console chain = $CHAIN (settings.json pinned; re-run with CHAIN=sui to flip)"

log "Deriving role addresses..."
for role in $ROLES; do
  mkdir -p "$ROLES_DIR/$role"
  addr="$(role_address "$(role_password "$role")")"
  echo "$addr" > "$ROLES_DIR/$role/addr"
  log "  $role → ${addr:-<derive failed>}"
done
STEWARD_ADDR="$(cat "$ROLES_DIR/steward/addr" 2>/dev/null || true)"

# ── 8. Wire the demo on-chain (register steward + mint stablecoin + sponsorship headroom) ──
if [ "$CHAIN" = "sui" ]; then
  log "Wiring Sui: register steward + mint MOCK_USDC..."
  SUI_DEP="$ROOT/packages/contracts/chains/sui/deployments/localnet.json"
  PKG="$(jq -r '.packageId' "$SUI_DEP")"
  SUI_STEWARD_REG="$(jq -r '.objects.stewardRegistry' "$SUI_DEP")"
  USDC_MINT_CAP="$(jq -r '.objects.usdcMintCap' "$SUI_DEP")"
  if [ -n "$STEWARD_ADDR" ]; then
    sui client call --package "$PKG" --module steward_registry --function register_steward \
      --args "$SUI_STEWARD_REG" "$STEWARD_ADDR" --gas-budget 100000000 >/dev/null 2>&1 \
      || warn "Sui register_steward failed (see Sui logs)"
    sui client call --package "$PKG" --module steward_registry --function set_default_steward \
      --args "$SUI_STEWARD_REG" "$STEWARD_ADDR" --gas-budget 100000000 >/dev/null 2>&1 \
      || warn "Sui set_default_steward failed"
  fi
  for role in bookmaker options; do
    addr="$(cat "$ROLES_DIR/$role/addr" 2>/dev/null || true)"
    [ -z "$addr" ] && continue
    sui client call --package "$PKG" --module mock_usdc --function mint_to \
      --args "$USDC_MINT_CAP" 1000000000000000 "$addr" --gas-budget 100000000 >/dev/null 2>&1 \
      || warn "Sui mint_to $role failed"
  done
else
  log "Wiring EVM: register steward + mint USDC + paymaster deposit..."
  STEWARD_REGISTRY="$(jq -r '.scopes.protocol.contracts.stewardRegistry' "$EVM_DEPLOYMENT")"
  MOCK_USDC="$(jq -r '.scopes.protocol.contracts.mockUsdc' "$EVM_DEPLOYMENT")"
  ENTRY_POINT="$(jq -r '.scopes.aa.contracts.entryPoint' "$EVM_DEPLOYMENT")"
  PAYMASTER="$(jq -r '.scopes.paymaster.contracts.verifyingPaymaster' "$EVM_DEPLOYMENT")"
  if [ -n "$STEWARD_ADDR" ]; then
    cast send "$STEWARD_REGISTRY" "registerSteward(address)" "$STEWARD_ADDR" --rpc-url "$RPC" --private-key "$ANVIL_KEY" >/dev/null 2>&1 \
      || warn "registerSteward failed"
    cast send "$STEWARD_REGISTRY" "setDefaultSteward(address)" "$STEWARD_ADDR" --rpc-url "$RPC" --private-key "$ANVIL_KEY" >/dev/null 2>&1 \
      || warn "setDefaultSteward failed"
  fi
  for role in bookmaker options; do
    addr="$(cat "$ROLES_DIR/$role/addr" 2>/dev/null || true)"
    [ -z "$addr" ] && continue
    cast send "$MOCK_USDC" "mint(address,uint256)" "$addr" 1000000000000000 --rpc-url "$RPC" --private-key "$ANVIL_KEY" >/dev/null 2>&1 \
      || warn "mint USDC -> $role failed"
  done
  # Sponsorship headroom (R4) — top up the paymaster's EntryPoint deposit (the deploy already seeds it).
  cast send "$ENTRY_POINT" "depositTo(address)" "$PAYMASTER" --value 5ether --rpc-url "$RPC" --private-key "$ANVIL_KEY" >/dev/null 2>&1 \
    || warn "paymaster depositTo top-up failed"
fi

# ── 9. Open a remote console per package-role (each its own keystore; chain per settings) ──
log "Opening a remote console per role..."
for role in $ROLES; do
  dir="$ROLES_DIR/$role"
  ( cd "$ROOT/cli" \
    && LIVESTREAK_PASSWORD="$(role_password "$role")" \
       LIVESTREAK_KEYSTORE_PATH="$dir/keystore.json" \
       LIVESTREAK_SESSION_STORE="$dir/sessions.json" \
       npm run dev -- remote open --scopes "$ROLE_SCOPES" --ttl 12h --pair-password "demo-pass-$role" ) \
    > "$dir/console.log" 2>&1 &
  for _ in $(seq 1 40); do
    if grep -q "console URL:" "$dir/console.log" 2>/dev/null; then break; fi
    sleep 1
  done
  { grep -m1 "console URL:" "$dir/console.log" 2>/dev/null | sed 's/.*console URL: *//'; } > "$dir/url" || true
done

# ── Done ──
echo ""
echo -e "${G}✓ LiveStreak live protocol instance — CHAIN=$CHAIN${N}"
echo "  Anvil → $RPC"
[ "$WITH_SUI" = "1" ] && echo "  Sui   → $SUI_RPC_LOCAL (localnet)"
echo "  Host  → http://127.0.0.1:8787"
echo "  App   → $LIVESTREAK_APP_ORIGIN"
echo ""
echo "  Role consoles (open the URL, enter the pairing pass):"
for role in $ROLES; do
  printf "    %-10s %s\n" "$role" "$(role_label "$role")"
  printf "      url:  %s\n" "$(cat "$ROLES_DIR/$role/url" 2>/dev/null || echo "<not ready — see $ROLES_DIR/$role/console.log>")"
  printf "      pass: demo-pass-%s\n" "$role"
done
echo ""
echo "  Bets are placed on the UI ($LIVESTREAK_APP_ORIGIN) — open a tab per profile."
echo "  Flip chains: re-run with  CHAIN=sui ./dev.sh"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""
wait

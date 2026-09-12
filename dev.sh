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
# Layout: config → helpers → per-chain legs (sui_* / evm_*) → shared phases → a flat main flow that
# just calls them in order. bash 3.2 compatible (macOS default): no associative arrays.
set -eo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
RPC="http://127.0.0.1:8545"
# Anvil account #0 — deployer + AA executor + paymaster signer + contract owner (registerSteward).
ANVIL_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

# Which chain the role consoles + wiring target. Infra (both legs) always comes up; CHAIN selects
# which chain the consoles are pinned to and which chain gets demo-wired this run.
CHAIN="${CHAIN:-evm}"
# foundry's `cast`/`anvil` read $CHAIN as their `--chain` flag. Our values ("evm"/"sui") are not valid
# foundry chain names, so an inherited CHAIN makes EVERY cast reject with "invalid value for --chain"
# (this was the silent wiring failure). Keep CHAIN shell-local: dev.sh still uses it; children don't see it.
export -n CHAIN 2>/dev/null || true
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
# Every console descriptor advertises scope `bridge:action:<name>` (uniform across all 4 packages) — the
# SAME scope the relay authorizes a call against (host requiredScopeForCall). Structural group nodes use
# `bridge:controls:read`. So the grant is simply: all actions + board read/subscribe + controls read.
ROLE_SCOPES="bridge:action:*,bridge:board:read,bridge:board:subscribe,bridge:controls:read"

# Demo USDC minted to each role/UI wallet during wiring (mock token → 1e15; harmless on a throwaway chain).
DEMO_USDC_MINT="1000000000000000"

# Colors
G='\033[0;32m' Y='\033[0;33m' R='\033[0;31m' N='\033[0m'
log()  { echo -e "${G}→${N} $1"; }
warn() { echo -e "${Y}!${N} $1"; }
err()  { echo -e "${R}✗${N} $1"; }

# Kill the long-lived children by PATTERN: the `npm run dev` wrappers don't forward signals to their
# tsx/vite/alto child, so killing a wrapper pid alone orphans the real server. kill_servers = the main
# stack + its ports; kill_sui = the Sui leg. Shared by the startup clean-slate AND by cleanup.
kill_servers() {
  for pat in "remote open" "tsx src/main.ts" "vite dev --port 3000" "alto --entrypoints" "anvil"; do
    pkill -9 -f "$pat" 2>/dev/null || true
  done
  for p in 8545 8787 3000 4337; do lsof -ti:$p 2>/dev/null | xargs kill -9 2>/dev/null || true; done
}
kill_sui() {
  pkill -9 -f "sui start" 2>/dev/null || true
  pkill -9 -f "sui-faucet" 2>/dev/null || true
  for p in 9000 9123 9124; do lsof -ti:$p 2>/dev/null | xargs kill -9 2>/dev/null || true; done
}

cleanup() {
  [ -n "${_CLEANED:-}" ] && return
  _CLEANED=1
  log "Shutting down..."
  kill_servers
  kill_sui
  [ -n "$HOST_PID" ] && kill "$HOST_PID" 2>/dev/null || true
  [ -n "$APP_PID" ]  && kill "$APP_PID"  2>/dev/null || true
  [ -n "$SUI_PID" ]  && kill "$SUI_PID"  2>/dev/null || true
}
# EXIT runs cleanup on ANY exit (normal end or the exit below). The signal trap converts Ctrl-C /
# kill / terminal-close (HUP) into an exit so cleanup runs exactly once. Only kill -9 escapes
# (uncatchable) — the startup kill-stale block is the backstop for that case.
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

# ════════════════════════════════════════════════════════════════════════════════════════════════
# Sui leg — boots localnet+faucet, deploys the Move package, funds the host sponsor. The app flips
# EVM<->Sui by config alone: deploy:sui rewrites chains/sui/deployments/localnet.{json,ts} (app+host read).
# ════════════════════════════════════════════════════════════════════════════════════════════════
SUI_ROOT="$ROOT"
SUI_RPC_LOCAL="http://127.0.0.1:9000"
SUI_FAUCET_LOCAL="http://127.0.0.1:9123/gas"
SUI_LOG="/tmp/livestreak-sui.log"
# Dev-only keypair (localnet only; NOT a secret). The Sui deploy tooling falls back to this mnemonic on
# localnet; we reuse it as the host gas-station sponsor so we can faucet-fund it here.
DEV_SUI_MNEMONIC="cargo town galaxy wonder animal digital buddy member object detect home chapter"
# Deterministic address for DEV_SUI_MNEMONIC at m/44'/784'/0'/0'/0'.
DEV_SUI_SPONSOR_ADDRESS="0x184692a4d95ec8c54940b58b501356d903c2c0bef8a5c215c3b4dd1551c325f6"

# Resolve node/npm before booting — a missing toolchain must fail BEFORE --force-regenesis wipes state.
sui_ensure_node() {
  if command -v npm >/dev/null 2>&1; then
    return 0
  fi
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    log "npm not on PATH — sourcing nvm from $NVM_DIR"
    # shellcheck disable=SC1090
    \. "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
    nvm use --lts >/dev/null 2>&1 || nvm use default >/dev/null 2>&1 || true
  fi
  if ! command -v npm >/dev/null 2>&1; then
    err "npm not found (and nvm could not provide it). Aborting BEFORE touching Sui chain state."
    return 1
  fi
  log "npm resolved → $(command -v npm)"
}

sui_kill_stale() {
  log "Killing stale Sui processes..."
  kill_sui
  sleep 1
}

sui_ensure_env() {
  sui client new-env --alias localnet --rpc "$SUI_RPC_LOCAL" >/dev/null 2>&1 || true
  sui client switch --env localnet >/dev/null 2>&1 || true
  if ! sui client active-address >/dev/null 2>&1; then
    log "No active Sui address — generating one (ed25519)..."
    sui client new-address ed25519 >/dev/null 2>&1 || true
  fi
}

sui_start() {
  log "Starting Sui localnet (sui start --with-faucet --force-regenesis)..."
  sui start --with-faucet --force-regenesis > "$SUI_LOG" 2>&1 &
  SUI_PID=$!
  for _ in $(seq 1 60); do
    if curl -s -X POST "$SUI_RPC_LOCAL" -H 'content-type: application/json' \
         -d '{"jsonrpc":"2.0","id":1,"method":"sui_getChainIdentifier","params":[]}' \
         2>/dev/null | grep -q result; then
      log "Sui localnet up (PID $SUI_PID) — $SUI_RPC_LOCAL"
      return 0
    fi
    sleep 1
  done
  err "Sui localnet failed to start. See $SUI_LOG"
  return 1
}

# POST the localnet faucet for <addr> (regenesis wipes balances, so every boot must re-fund).
sui_faucet() {
  curl -s -X POST "$SUI_FAUCET_LOCAL" -H 'content-type: application/json' \
    -d "{\"FixedAmountRequest\":{\"recipient\":\"$1\"}}" >/dev/null 2>&1
}

# Faucet-fund an address and block until a gas coin actually lands (regenesis wipes balances).
sui_fund_and_wait() {
  local addr="$1"
  for _ in $(seq 1 5); do
    sui_faucet "$addr" || true
    for _ in $(seq 1 6); do
      if sui client gas "$addr" --json 2>/dev/null | grep -q mistBalance; then
        return 0
      fi
      sleep 1
    done
  done
  warn "Gas coin for $addr not confirmed (deploy may still self-fund)"
}

sui_deploy() {
  local deployer
  deployer="$(sui client active-address 2>/dev/null)"
  if [ -n "$deployer" ]; then
    log "Funding deployer $deployer from faucet..."
    sui_fund_and_wait "$deployer"
  fi
  log "Deploying Sui Move package (deploy:sui --name localnet --force)..."
  ( cd "$SUI_ROOT/packages/contracts" && npm run deploy:sui -- --name localnet --force ) 2>&1 | sed 's/^/  /'
  # PIPESTATUS[0] is the npm exit code (sed is [1]); pipefail alone reports sed's status.
  local rc=${PIPESTATUS[0]}
  local snap="$SUI_ROOT/packages/contracts/chains/sui/deployments/localnet.json"
  if [ "$rc" -ne 0 ] || [ ! -f "$snap" ]; then
    err "Sui deploy failed (exit $rc) — see output above"
    return 1
  fi
  log "Sui deployed → chains/sui/deployments/localnet.{json,ts}"
}

sui_fund_sponsor() {
  log "Funding host Sui sponsor $DEV_SUI_SPONSOR_ADDRESS from faucet..."
  sui_faucet "$DEV_SUI_SPONSOR_ADDRESS" || warn "Faucet request for sponsor failed (non-fatal)"
}

sui_leg_env() {
  export LIVESTREAK_SUI_RPC_URL="$SUI_RPC_LOCAL"
  export SUI_RPC="$SUI_RPC_LOCAL"
  export LIVESTREAK_SUI_NETWORK="localnet"
  export SUI_NETWORK="localnet"
  export LIVESTREAK_SUI_SPONSOR_MNEMONIC="$DEV_SUI_MNEMONIC"
}

sui_leg_up() {
  sui_ensure_node || return 1
  sui_kill_stale
  sui_ensure_env
  sui_start || return 1
  sui_deploy || return 1
  sui_fund_sponsor
  sui_leg_env
}

# Wiring: register the steward + mint MOCK_USDC to the role/UI wallets (Sui has no paymaster step).
sui_wire() {
  log "Wiring Sui: register steward + mint MOCK_USDC..."
  local dep pkg steward_reg mint_cap role addr pw ui_addr
  dep="$ROOT/packages/contracts/chains/sui/deployments/localnet.json"
  pkg="$(jq -r '.packageId' "$dep")"
  steward_reg="$(jq -r '.objects.stewardRegistry' "$dep")"
  mint_cap="$(jq -r '.objects.usdcMintCap' "$dep")"
  # `sui client call` wrapper that warns on failure (the evm_wire `wire` mirror for this chain).
  scall() { # <module> <function> <label> <args...>
    local mod="$1" fn="$2" label="$3"; shift 3
    sui client call --package "$pkg" --module "$mod" --function "$fn" \
      --args "$@" --gas-budget 100000000 >/dev/null 2>&1 || warn "Sui $label failed"
  }
  if [ -n "$STEWARD_ADDR" ]; then
    scall steward_registry register_steward register_steward "$steward_reg" "$STEWARD_ADDR"
    scall steward_registry set_default_steward set_default_steward "$steward_reg" "$STEWARD_ADDR"
  fi
  for role in bookmaker options; do
    addr="$(cat "$ROLES_DIR/$role/addr" 2>/dev/null || true)"
    [ -z "$addr" ] && continue
    scall mock_usdc mint_to "mint_to $role" "$mint_cap" "$DEMO_USDC_MINT" "$addr"
  done
  # Fund the UI demo wallet(s) on Sui too (see evm_wire for why). Default "1234".
  for pw in ${UI_DEMO_PASSWORDS:-1234}; do
    ui_addr="$(role_address "$pw")"
    [ -z "$ui_addr" ] && { warn "UI demo wallet '$pw' derive failed — not funded"; continue; }
    scall mock_usdc mint_to "mint_to UI($pw)" "$mint_cap" "$DEMO_USDC_MINT" "$ui_addr"
  done
}

# ════════════════════════════════════════════════════════════════════════════════════════════════
# EVM leg — anvil + a fresh forced deploy + AA demo wiring. The evm_* mirror of the sui_* leg above.
# ════════════════════════════════════════════════════════════════════════════════════════════════
evm_start() {
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
}

evm_deploy() {
  # Deploy, then rebuild dist so the Node roles import this run's fresh addresses (a stale dist would
  # silently send writes to a dead vaultDriver). build:ts is a SEPARATE step on purpose: `npm run deploy --`
  # forwards args to the tail of the script, so folding the build inside `deploy` would steal --name from main.ts.
  log "Deploying EVM contracts (force)..."
  ( cd "$ROOT/packages/contracts" \
      && DEPLOYER_PRIVATE_KEY="$ANVIL_KEY" npm run deploy -- --name localhost --force \
      && npm run build:ts ) 2>&1 | sed 's/^/  /'
  EVM_DEPLOYMENT="$ROOT/packages/contracts/chains/evm/deployments/localhost.json"
  log "EVM contracts deployed → $EVM_DEPLOYMENT"
}

evm_leg_up() {
  evm_start
  evm_deploy
}

# Wiring: register the steward + mint USDC to the role/UI wallets + top up paymaster sponsorship.
evm_wire() {
  log "Wiring EVM: register steward + mint USDC + paymaster deposit..."
  local steward_reg usdc entry_point paymaster depositor role addr pw ui_addr rc
  local wire_log="/tmp/livestreak-wiring.log"; : > "$wire_log"
  steward_reg="$(jq -r '.scopes.protocol.contracts.stewardRegistry' "$EVM_DEPLOYMENT")"
  usdc="$(jq -r '.scopes.protocol.contracts.mockUsdc' "$EVM_DEPLOYMENT")"
  entry_point="$(jq -r '.scopes.aa.contracts.entryPoint' "$EVM_DEPLOYMENT")"
  paymaster="$(jq -r '.scopes.paymaster.contracts.verifyingPaymaster' "$EVM_DEPLOYMENT")"
  # The deploy promotes the artifact a beat before a fresh caller sees the new bytecode; wait until the
  # registry actually has code so the first wiring tx isn't sent to a not-yet-visible address (this was
  # the silent failure that left the steward unregistered / balances unminted on boot).
  for _ in $(seq 1 30); do
    rc="$(cast code "$steward_reg" --rpc-url "$RPC" 2>/dev/null || true)"
    [ -n "$rc" ] && [ "$rc" != "0x" ] && break
    sleep 0.5
  done
  # Retry each tx (cast send is synchronous) so a transient post-deploy race self-heals; everything is
  # captured to $wire_log for diagnosis instead of silently dropped to /dev/null.
  wire() { # <label> <to> <sig> [args/flags...]
    local label="$1" to="$2" sig="$3"; shift 3
    local i
    for i in 1 2 3; do
      if cast send "$to" "$sig" "$@" --rpc-url "$RPC" --private-key "$ANVIL_KEY" >>"$wire_log" 2>&1; then
        return 0
      fi
      sleep 0.6
    done
    warn "$label failed (see $wire_log)"
  }
  if [ -n "$STEWARD_ADDR" ]; then
    wire "registerSteward" "$steward_reg" "registerSteward(address)" "$STEWARD_ADDR"
    wire "setDefaultSteward" "$steward_reg" "setDefaultSteward(address)" "$STEWARD_ADDR"
  fi
  for role in bookmaker options; do
    addr="$(cat "$ROLES_DIR/$role/addr" 2>/dev/null || true)"
    [ -z "$addr" ] && continue
    wire "mint USDC -> $role" "$usdc" "mint(address,uint256)" "$addr" "$DEMO_USDC_MINT"
  done
  # Fund the UI demo wallet(s) too: the app logs in with a password (default "1234") and bets from
  # the SAME counterfactual Safe the CLI derives (getAddress() on the wallet manager). dev.sh
  # otherwise only funds the ROLE passwords, so UI bets would revert on insufficient USDC. Override
  # the set with UI_DEMO_PASSWORDS="1234 demo ..." to fund more demo logins.
  for pw in ${UI_DEMO_PASSWORDS:-1234}; do
    ui_addr="$(role_address "$pw")"
    [ -z "$ui_addr" ] && { warn "UI demo wallet '$pw' derive failed — not funded"; continue; }
    wire "mint USDC -> UI($pw)" "$usdc" "mint(address,uint256)" "$ui_addr" "$DEMO_USDC_MINT"
  done
  # Sponsorship headroom (R4) — top up the paymaster's EntryPoint deposit so a long demo never hits
  # AA31 ("paymaster deposit too low"). A billion ETH is far past anything the dev EOA holds, so give
  # the depositor headroom first (local anvil only; harmless on a throwaway chain).
  depositor="$(cast wallet address --private-key "$ANVIL_KEY" 2>/dev/null)"
  if [ -n "$depositor" ]; then
    cast rpc anvil_setBalance "$depositor" "$(cast to-hex "$(cast to-wei 2000000000 ether)")" \
      --rpc-url "$RPC" >/dev/null 2>&1 || warn "anvil_setBalance depositor failed"
  fi
  wire "paymaster depositTo top-up" "$entry_point" "depositTo(address)" "$paymaster" --value 1000000000ether
}

# ════════════════════════════════════════════════════════════════════════════════════════════════
# Shared phases (chain-agnostic) + the helpers the legs lean on.
# ════════════════════════════════════════════════════════════════════════════════════════════════

# Kill every stale process, then clean + rebuild from source. cli/host/roles import each workspace's
# BUILT dist (not src) — a stale dist silently runs old descriptors/scopes/addresses, so one clean
# rebuild is the only guarantee nothing downstream is stale.
clean_slate() {
  log "Killing stale processes..."
  kill_servers
  rm -rf "$ROLES_DIR" && mkdir -p "$ROLES_DIR"
  sleep 1
  log "Clean + build all workspaces..."
  ( cd "$ROOT" && npm run clean && npm run build ) > /tmp/livestreak-build.log 2>&1 \
    || { err "clean build failed — see /tmp/livestreak-build.log"; exit 1; }
}

# Write the chain-pinned settings.json the consoles + CLI use (contracts FLOAT: the chain adapter
# derives them from the deployment, so settings carries only the ref).
write_settings() {
  local chain_id deployment rpc slot
  if [ "$CHAIN" = "sui" ]; then
    chain_id="sui:localnet"; deployment="@livestreak/contracts/sui/deployments/localnet"; rpc="$SUI_RPC_LOCAL"; slot="sui-localnet"
  else
    chain_id="eip155:31337"; deployment="@livestreak/contracts/evm/deployments/localhost"; rpc="$RPC"; slot="evm-localhost"
  fi
  cat > "$ROOT/cli/settings.json" <<JSON
{
  "host": { "url": "http://127.0.0.1:8787" },
  "defaultChain": "$chain_id",
  "chains": {
    "$chain_id": {
      "deployment": "$deployment",
      "rpc": "$rpc",
      "wallet": { "keystoreSlot": "$slot" }
    }
  }
}
JSON
}

# Derive a role's on-chain address (chain per the written settings.json).
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

# Start the host server. Wait until the AA bundler route actually ANSWERS — address derivation and
# every sponsored write go through it, so a fixed sleep is not enough. LIVESTREAK_RESET_CATALOG=1:
# the chains are wiped every run, so clear the persisted discovery projection or the homepage shows
# vaults from a previous boot that no longer exist.
host_up() {
  log "Starting host server..."
  ( cd "$ROOT/host" && LIVESTREAK_AA_ALLOW_DEV_KEY=1 LIVESTREAK_RESET_CATALOG=1 npm run dev ) > /tmp/livestreak-host.log 2>&1 &
  HOST_PID=$!
  local host_ready=0
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
}

app_up() {
  log "Starting app client..."
  # --force: re-bundle the just-rebuilt @livestreak/options dist (stale pre-bundle otherwise)
  ( cd "$ROOT/app" && npm run dev -- --force ) > /tmp/livestreak-app.log 2>&1 &
  APP_PID=$!
  sleep 3
  if kill -0 "$APP_PID" 2>/dev/null; then
    log "App running (PID $APP_PID) — http://localhost:3000"
  else
    warn "App did not start (non-fatal). See /tmp/livestreak-app.log"
  fi
}

derive_roles() {
  log "Deriving role addresses..."
  local role addr
  for role in $ROLES; do
    mkdir -p "$ROLES_DIR/$role"
    addr="$(role_address "$(role_password "$role")")"
    echo "$addr" > "$ROLES_DIR/$role/addr"
    log "  $role → ${addr:-<derive failed>}"
  done
  STEWARD_ADDR="$(cat "$ROLES_DIR/steward/addr" 2>/dev/null || true)"
}

# Open a remote console per package-role (each its own keystore; chain per settings).
open_consoles() {
  log "Opening a remote console per role..."
  local role dir cpid
  for role in $ROLES; do
    dir="$ROLES_DIR/$role"
    ( cd "$ROOT/cli" \
      && LIVESTREAK_PASSWORD="$(role_password "$role")" \
         LIVESTREAK_KEYSTORE_PATH="$dir/keystore.json" \
         LIVESTREAK_SESSION_STORE="$dir/sessions.json" \
         npm run dev -- remote open --scopes "$ROLE_SCOPES" --ttl 12h --pair-password "demo-pass-$role" ) \
      > "$dir/console.log" 2>&1 &
    cpid=$!
    for _ in $(seq 1 40); do
      if grep -q "console URL:" "$dir/console.log" 2>/dev/null; then break; fi
      # Fail fast instead of waiting out the timeout when remote open dies (bad scope, host down, …).
      if ! kill -0 "$cpid" 2>/dev/null; then err "console for $role exited early — see $dir/console.log"; break; fi
      sleep 1
    done
    { grep -m1 "console URL:" "$dir/console.log" 2>/dev/null | sed 's/.*console URL: *//'; } > "$dir/url" || true
  done
}

print_summary() {
  local role
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
}

# ════════════════════════════════════════════════════════════════════════════════════════════════
# Main flow — bring up BOTH chain legs (infra always comes up), then wire + pin the ACTIVE chain.
# CHAIN only selects which chain the consoles target and which gets demo-wired this run.
# ════════════════════════════════════════════════════════════════════════════════════════════════
clean_slate

evm_leg_up

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

host_up
app_up

write_settings
log "Console chain = $CHAIN (settings.json pinned; re-run with CHAIN=sui to flip)"
derive_roles

if [ "$CHAIN" = "sui" ]; then sui_wire; else evm_wire; fi

open_consoles
print_summary
wait

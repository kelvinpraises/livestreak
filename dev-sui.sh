#!/bin/bash
# Sui-localnet leg of the LiveStreak local dev stack.
#
# Standalone:  ./dev-sui.sh         → boots Sui localnet + faucet, deploys the
#                                      Move package, funds the host sponsor, then
#                                      blocks (Ctrl+C to stop).
# Sourced:     source dev-sui.sh     → exposes sui_leg_up / sui_leg_env / the
#                                      SUI_* env so dev.sh can run BOTH chains.
#
# The app flips EVM<->Sui by config alone: `deploy:sui` rewrites
# packages/contracts/chains/sui/deployments/localnet.{json,ts}, which the app
# imports as `localnetDeployment` and the host reads via loadDeployment().
set -o pipefail

SUI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUI_RPC_LOCAL="http://127.0.0.1:9000"
SUI_FAUCET_LOCAL="http://127.0.0.1:9123/gas"
SUI_LOG="/tmp/livestreak-sui.log"

# Dev-only keypair. The Sui deploy tooling falls back to this mnemonic on
# localnet (see chains/sui/deploy/utils.ts getKeypair). We reuse it as the host
# gas-station sponsor so the sponsor account is one we can faucet-fund here.
# NOT a secret — localnet only; never used on testnet/mainnet.
DEV_SUI_MNEMONIC="cargo town galaxy wonder animal digital buddy member object detect home chapter"
# Deterministic address for DEV_SUI_MNEMONIC at m/44'/784'/0'/0'/0'
# (matches host createWalletManager('sui', seed).getAccount(0)).
DEV_SUI_SPONSOR_ADDRESS="0x184692a4d95ec8c54940b58b501356d903c2c0bef8a5c215c3b4dd1551c325f6"

# Colors (only define if not already set by a parent script like dev.sh)
: "${G:=\033[0;32m}" "${Y:=\033[0;33m}" "${R:=\033[0;31m}" "${N:=\033[0m}"
slog()  { echo -e "${G}→${N} $1"; }
swarn() { echo -e "${Y}!${N} $1"; }
serr()  { echo -e "${R}✗${N} $1"; }

# ── Kill stale Sui processes + free ports ──
sui_kill_stale() {
  slog "Killing stale Sui processes..."
  pkill -9 -f "sui start" 2>/dev/null || true
  pkill -9 -f "sui-faucet" 2>/dev/null || true
  for port in 9000 9123 9124; do
    lsof -ti:"$port" | xargs kill -9 2>/dev/null || true
  done
  sleep 1
}

# ── Ensure a `localnet` client env + an active address exist ──
# (the keystore persists across --force-regenesis; the faucet funds it).
sui_ensure_env() {
  sui client new-env --alias localnet --rpc "$SUI_RPC_LOCAL" >/dev/null 2>&1 || true
  sui client switch --env localnet >/dev/null 2>&1 || true
  if ! sui client active-address >/dev/null 2>&1; then
    slog "No active Sui address — generating one (ed25519)..."
    sui client new-address ed25519 >/dev/null 2>&1 || true
  fi
}

# ── Boot Sui localnet + faucet (fresh genesis each run) ──
sui_start() {
  slog "Starting Sui localnet (sui start --with-faucet --force-regenesis)..."
  sui start --with-faucet --force-regenesis > "$SUI_LOG" 2>&1 &
  SUI_PID=$!
  for _ in $(seq 1 60); do
    if curl -s -X POST "$SUI_RPC_LOCAL" -H 'content-type: application/json' \
         -d '{"jsonrpc":"2.0","id":1,"method":"sui_getChainIdentifier","params":[]}' \
         2>/dev/null | grep -q result; then
      slog "Sui localnet up (PID $SUI_PID) — $SUI_RPC_LOCAL"
      return 0
    fi
    sleep 1
  done
  serr "Sui localnet failed to start. See $SUI_LOG"
  return 1
}

# ── Faucet-fund an address and wait until a gas coin actually lands ──
# `sui start --force-regenesis` wipes balances; the deploy's own brief faucet
# poke is racy, so we fund the active deployer here and block on `sui client gas`.
sui_fund_and_wait() {
  local addr="$1"
  for _ in $(seq 1 5); do
    curl -s -X POST "$SUI_FAUCET_LOCAL" -H 'content-type: application/json' \
      -d "{\"FixedAmountRequest\":{\"recipient\":\"$addr\"}}" >/dev/null 2>&1 || true
    for _ in $(seq 1 6); do
      if sui client gas "$addr" --json 2>/dev/null | grep -q mistBalance; then
        return 0
      fi
      sleep 1
    done
  done
  swarn "Gas coin for $addr not confirmed (deploy may still self-fund)"
}

# ── Deploy the Move package + bootstrap protocol wiring on localnet ──
sui_deploy() {
  local deployer
  deployer="$(sui client active-address 2>/dev/null)"
  if [ -n "$deployer" ]; then
    slog "Funding deployer $deployer from faucet..."
    sui_fund_and_wait "$deployer"
  fi
  slog "Deploying Sui Move package (deploy:sui --name localnet --force)..."
  ( cd "$SUI_ROOT/packages/contracts" && npm run deploy:sui -- --name localnet --force ) 2>&1 | sed 's/^/  /'
  # PIPESTATUS[0] is the npm exit code (sed is [1]); pipefail alone reports sed's status.
  local rc=${PIPESTATUS[0]}
  local snap="$SUI_ROOT/packages/contracts/chains/sui/deployments/localnet.json"
  if [ "$rc" -ne 0 ] || [ ! -f "$snap" ]; then
    serr "Sui deploy failed (exit $rc) — see output above"
    return 1
  fi
  slog "Sui deployed → chains/sui/deployments/localnet.{json,ts}"
}

# ── Fund the host gas-station sponsor (dev mnemonic account) from the faucet ──
sui_fund_sponsor() {
  slog "Funding host Sui sponsor $DEV_SUI_SPONSOR_ADDRESS from faucet..."
  curl -s -X POST "$SUI_FAUCET_LOCAL" -H 'content-type: application/json' \
    -d "{\"FixedAmountRequest\":{\"recipient\":\"$DEV_SUI_SPONSOR_ADDRESS\"}}" \
    >/dev/null 2>&1 || swarn "Faucet request for sponsor failed (non-fatal)"
}

# ── Env the host needs to target localnet Sui (gas station + read client) ──
sui_leg_env() {
  export LIVESTREAK_SUI_RPC_URL="$SUI_RPC_LOCAL"
  export SUI_RPC="$SUI_RPC_LOCAL"
  export LIVESTREAK_SUI_NETWORK="localnet"
  export SUI_NETWORK="localnet"
  export LIVESTREAK_SUI_SPONSOR_MNEMONIC="$DEV_SUI_MNEMONIC"
}

# ── Bring the whole Sui leg up (used by dev.sh and standalone) ──
sui_leg_up() {
  sui_kill_stale
  sui_ensure_env
  sui_start || return 1
  sui_deploy || return 1
  sui_fund_sponsor
  sui_leg_env
}

sui_print_summary() {
  echo ""
  echo -e "${G}✓ Sui localnet ready${N}"
  echo "  RPC     → $SUI_RPC_LOCAL"
  echo "  Faucet  → $SUI_FAUCET_LOCAL"
  echo "  Deploy  → packages/contracts/chains/sui/deployments/localnet.json"
  echo "  Host env: LIVESTREAK_SUI_RPC_URL, LIVESTREAK_SUI_NETWORK=localnet,"
  echo "            LIVESTREAK_SUI_SPONSOR_MNEMONIC (dev key)"
  echo "  App     → set chain to 'sui' (uses localnetDeployment by config alone)"
  echo ""
}

# ── Standalone entrypoint (only when executed directly, not sourced) ──
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  SUI_PID=""
  sui_standalone_cleanup() {
    slog "Shutting down Sui localnet..."
    [ -n "$SUI_PID" ] && kill "$SUI_PID" 2>/dev/null || true
    pkill -f "sui start" 2>/dev/null || true
    pkill -f "sui-faucet" 2>/dev/null || true
    exit 0
  }
  trap sui_standalone_cleanup SIGINT SIGTERM
  sui_leg_up || exit 1
  sui_print_summary
  echo "Press Ctrl+C to stop the Sui localnet"
  wait
fi

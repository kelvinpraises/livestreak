#!/bin/bash
set -eo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
RPC="http://127.0.0.1:8545"
# Anvil account #0 — deployer + AA executor + paymaster signer (matches on-chain verifyingSigner on 31337)
ANVIL_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

# Colors
G='\033[0;32m' Y='\033[0;33m' R='\033[0;31m' N='\033[0m'
log()  { echo -e "${G}→${N} $1"; }
warn() { echo -e "${Y}!${N} $1"; }
err()  { echo -e "${R}✗${N} $1"; }

cleanup() {
  log "Shutting down..."
  pkill -f "anvil --block-time" 2>/dev/null || true
  [ -n "$HOST_PID" ] && kill "$HOST_PID" 2>/dev/null || true
  [ -n "$APP_PID" ]  && kill "$APP_PID"  2>/dev/null || true
  exit 0
}
trap cleanup SIGINT SIGTERM

# ── 1. Kill stale processes ──
log "Killing stale processes..."
pkill -9 -f "anvil" 2>/dev/null || true
pkill -9 -f "tsx src/main.ts" 2>/dev/null || true
pkill -9 -f "vite dev --port 3000" 2>/dev/null || true
lsof -ti:8545 | xargs kill -9 2>/dev/null || true
lsof -ti:8787 | xargs kill -9 2>/dev/null || true
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
sleep 1

# ── 2. Start Anvil (same params as reference: block-time 5) ──
log "Starting Anvil (block-time 5)..."
anvil --block-time 5 > /tmp/livestreak-anvil.log 2>&1 &
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

# ── 4. Deploy contracts (deployer = anvil acct #0; deploy script auto-funds it) ──
log "Deploying contracts (force)..."
( cd "$ROOT/packages/contracts" && DEPLOYER_PRIVATE_KEY="$ANVIL_KEY" npm run deploy -- --name localhost --force ) 2>&1 | sed 's/^/  /'
log "Contracts deployed → packages/contracts/chains/evm/deployments/localhost.json"

# ── 5. Start host server ──
# LIVESTREAK_AA_ALLOW_DEV_KEY=1 → host uses anvil acct #0 as executor + paymaster signer
# (matches the deployed verifyingSigner); AA env auto-loads from the deploy snapshot.
log "Starting host server..."
( cd "$ROOT/host" && LIVESTREAK_AA_ALLOW_DEV_KEY=1 npm run dev ) > /tmp/livestreak-host.log 2>&1 &
HOST_PID=$!
sleep 4
if kill -0 "$HOST_PID" 2>/dev/null; then
  log "Host running (PID $HOST_PID) — http://127.0.0.1:8787"
else
  err "Host failed to start. See /tmp/livestreak-host.log"; exit 1
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

# ── Done ──
echo ""
echo -e "${G}✓ Everything running${N}"
echo "  Anvil → $RPC (block-time 5)"
echo "  Host  → http://127.0.0.1:8787"
echo "  App   → http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""
wait

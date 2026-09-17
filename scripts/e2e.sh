#!/bin/bash
# LiveStreak E2E — the keynote loop as one batch script, step by step:
#   1. boot the whole protocol via dev.sh (owns anvil/host/app/role consoles)
#   2. wait for the observer role console session
#   3. drive the full loop through the REAL remote relay (`remote drive`):
#      observe configure+register → bookmaker createVault → options configure+mint+fund
#      → steward configure+resolve — every step asserted
#   4. tear the stack down (unless KEEP_UP=1)
#
# Lean CI shape: `WITH_SUI=0 ./scripts/e2e.sh` (EVM only). bash 3.2 compatible.
set -eo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROLES_DIR="/tmp/livestreak-roles"
DEV_LOG="/tmp/livestreak-e2e-dev.log"
DRIVE_LOG="/tmp/livestreak-e2e-drive.log"
KEEP_UP="${KEEP_UP:-0}"
WITH_SUI="${WITH_SUI:-0}"
BOOT_TIMEOUT="${BOOT_TIMEOUT:-240}"

G='\033[0;32m'; R='\033[0;31m'; N='\033[0m'
step() { echo -e "${G}[e2e]${N} $1"; }
fail() { echo -e "${R}[e2e] FAIL${N} $1"; exit 1; }

DEV_PID=""
teardown() {
  if [ "$KEEP_UP" = "1" ]; then
    step "KEEP_UP=1 — leaving the stack running (dev.sh PID $DEV_PID)"
    return
  fi
  if [ -n "$DEV_PID" ] && kill -0 "$DEV_PID" 2>/dev/null; then
    step "Tearing down (SIGINT dev.sh $DEV_PID — its trap stops the children)"
    kill -INT "$DEV_PID" 2>/dev/null || true
    for _ in $(seq 1 20); do kill -0 "$DEV_PID" 2>/dev/null || break; sleep 1; done
    kill -0 "$DEV_PID" 2>/dev/null && kill -TERM "$DEV_PID" 2>/dev/null || true
  fi
}
trap teardown EXIT

# --- 1. boot ---
# Clear stale role-console session files from a previous run — the wait below must only
# accept THIS boot's sessions (a stale url races the drive against the workspace build).
rm -f "$ROLES_DIR"/*/url 2>/dev/null || true
step "Booting the protocol (dev.sh, WITH_SUI=$WITH_SUI) — log: $DEV_LOG"
( cd "$ROOT" && WITH_SUI="$WITH_SUI" ./dev.sh ) > "$DEV_LOG" 2>&1 &
DEV_PID=$!

# --- 2. wait for the observer console session ---
step "Waiting for the observer role console (up to ${BOOT_TIMEOUT}s)..."
URL_FILE="$ROLES_DIR/observe/url"
ready=0
for _ in $(seq 1 "$BOOT_TIMEOUT"); do
  if [ -s "$URL_FILE" ] && grep -q "/remote/" "$URL_FILE" 2>/dev/null; then ready=1; break; fi
  kill -0 "$DEV_PID" 2>/dev/null || fail "dev.sh exited during boot — see $DEV_LOG"
  sleep 1
done
[ "$ready" = 1 ] || fail "observer console never came up — see $DEV_LOG and $ROLES_DIR/observe/console.log"

SESSION="$(sed 's|.*/remote/||' "$URL_FILE" | tr -d '[:space:]')"
[ -n "$SESSION" ] || fail "could not parse session id from $URL_FILE"
step "Observer session: $SESSION"

# Resolution is address-authorized to the registered steward — that leg needs the steward session.
STEWARD_URL_FILE="$ROLES_DIR/steward/url"
for _ in $(seq 1 30); do [ -s "$STEWARD_URL_FILE" ] && break; sleep 1; done
STEWARD_SESSION="$(sed 's|.*/remote/||' "$STEWARD_URL_FILE" 2>/dev/null | tr -d '[:space:]')"
[ -n "$STEWARD_SESSION" ] || fail "steward console session missing — see $ROLES_DIR/steward/console.log"
step "Steward session:  $STEWARD_SESSION"

# --- 3. drive the keynote loop over the real relay ---
step "Driving: observe configure+register → createVault → mint+fund → resolve..."
set +e
( cd "$ROOT/cli" && npm run dev -- remote drive \
    --session "$SESSION" \
    --pair-password "demo-pass-observe" \
    --steward-session "$STEWARD_SESSION" \
    --steward-pair-password "demo-pass-steward" \
    --resolve-outcome yes ) > "$DRIVE_LOG" 2>&1
DRIVE_EXIT=$?
set -e

echo "--- drive output ---"
grep -E "remote drive complete|marketId|=ok|=fail|Error" "$DRIVE_LOG" | tail -12 || true
echo "--------------------"

# --- 4. assert ---
[ "$DRIVE_EXIT" = 0 ] || fail "remote drive exited $DRIVE_EXIT — see $DRIVE_LOG"
grep -q "remote drive complete" "$DRIVE_LOG" || fail "no completion line — see $DRIVE_LOG"
grep -q "=fail" "$DRIVE_LOG" && fail "a drive step failed — see $DRIVE_LOG"

MARKET_ID="$(grep -oE "marketId: 0x[0-9a-f]+" "$DRIVE_LOG" | head -1 | awk '{print $2}')"

# --- 5. feature surfaces (against the still-running host) ---
HOST="http://127.0.0.1:8787"
step "Verifying host feature surfaces..."

curl -s -m 5 "$HOST/descriptor" | grep -q '"memory"' || fail "descriptor missing memory module"
curl -s -m 5 "$HOST/descriptor" | grep -q '"forum"' || fail "descriptor missing forum module"
step "  descriptor advertises memory + forum"

[ -n "$MARKET_ID" ] || fail "no marketId parsed from drive log"
curl -s -m 5 "$HOST/catalog" | grep -qi "$MARKET_ID" \
  || fail "market $MARKET_ID not in /catalog (instant ingest)"
step "  instant catalog ingest: $MARKET_ID visible in /catalog"

curl -s -m 5 -X POST "$HOST/memory/records" -H 'content-type: application/json' \
  -d '{"subjectKind":"vault","subjectId":"e2e-check","findingIds":["f1"],"decisionActions":["resolve"],"atMs":1}' \
  | grep -q '"id"' || fail "memory remember failed"
curl -s -m 5 "$HOST/memory/records?subjectKind=vault&subjectId=e2e-check" \
  | grep -q '"f1"' || fail "memory recall failed"
step "  memory records: remember + recall round-trip"

curl -s -m 5 -X POST "$HOST/forum/messages" -H 'content-type: application/json' \
  -d '{"kind":"thread","subjectKind":"vault","subjectId":"e2e-check","title":"e2e","atMs":1}' \
  | grep -q '"id"' || fail "forum post failed"
curl -s -m 5 "$HOST/forum/messages?subjectKind=vault&subjectId=e2e-check" \
  | grep -q '"e2e"' || fail "forum list failed"
step "  forum: post + list round-trip"

SUMMARY="$(grep "remote drive complete" "$DRIVE_LOG" | tail -1)"
step "PASS — $SUMMARY"

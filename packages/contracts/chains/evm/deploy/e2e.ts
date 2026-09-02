#!/usr/bin/env tsx
/**
 * LIVESTREAK E2E — full on-chain flow against a local Anvil, EOA-only (no bundler/paymaster).
 *
 * Story: a bookmaker opens a vault; Alice funds YES and Bob funds NO via streamed USDC. The match
 * resolves MID-CYCLE through the steward; each funder `settle`s their in-flight Drips cycle into the
 * pot; the vault collects; the YES winner takes the pot and the NO loser cannot claim.
 *
 * This exercises the wiring the unit tests can't: real CREATE2 deploy, driver registration, the
 * steward resolver, and the mid-cycle squeeze — all against a live node.
 *
 * Prereqs:  anvil on :8545, and `npm run deploy -- --name localhost --rpc http://127.0.0.1:8545`.
 * Run:      npm run e2e
 */

import { readFileSync } from "fs";
import { join, resolve } from "path";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";

const RPC = "http://127.0.0.1:8545";
const ROOT = resolve(import.meta.dirname, "..");

// Anvil well-known keys: #0 deployer/steward/bookmaker, #1 Alice (YES), #2 Bob (NO).
const KEYS = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  alice: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  bob: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
} as const;

const Side = { Yes: 0, No: 1 } as const;
const Outcome = { Yes: 1, No: 2 } as const;

const RATE = 1_000_000n; // 1 USDC/s (6 decimals)
const DEPOSIT = 50_000_000n; // 50 USDC
const RESOLVE_AFTER = 5; // seconds into the (first, unfinished) cycle when the match resolves

// ── tiny test harness ──────────────────────────────────────────────────────
const c = { green: "\x1b[32m", red: "\x1b[31m", cyan: "\x1b[36m", dim: "\x1b[2m", bold: "\x1b[1m", reset: "\x1b[0m" };
let passed = 0;
let failed = 0;
const act = (t: string) => console.log(`\n${"═".repeat(72)}\n  ${c.bold}${t}${c.reset}\n${"═".repeat(72)}`);
const step = (who: string, what: string) => console.log(`  ${c.cyan}${who}${c.reset} ${what}`);
const info = (m: string) => console.log(`    ${c.dim}→ ${m}${c.reset}`);
const assert = (cond: boolean, msg: string) => {
  if (cond) {
    console.log(`  ${c.green}✓ ${msg}${c.reset}`);
    passed++;
  } else {
    console.log(`  ${c.red}✗ FAIL: ${msg}${c.reset}`);
    failed++;
  }
};

// ── load deploy state + ABIs ─────────────────────────────────────────────────
const state = JSON.parse(readFileSync(join(ROOT, "deploy/output/localhost.json"), "utf-8"));
const A: Record<string, Address> = {
  ...state.scopes.streaming.contracts,
  ...state.scopes.protocol.contracts,
  ...state.scopes.wire.contracts
};
const abi = (path: string): Abi => JSON.parse(readFileSync(join(ROOT, path), "utf-8")).abi;
const ABIS = {
  usdc: abi("out/MockUSDC.sol/MockUSDC.json"),
  market: abi("out/MarketRegistry.sol/MarketRegistry.json"),
  vaultDriver: abi("out/VaultDriver.sol/VaultDriver.json"),
  vault: abi("out/Vault.sol/Vault.json"),
  steward: abi("out/StewardRegistry.sol/StewardRegistry.json"),
  driver: abi("out/AddressDriver.sol/AddressDriver.json"),
  drips: abi("out/IDrips.sol/IDrips.json"),
  lvst: abi("out/LvstToken.sol/LvstToken.json"),
  treasury: abi("out/Treasury.sol/Treasury.json")
};

// ── clients ──────────────────────────────────────────────────────────────────
const transport = http(RPC);
const pub = createPublicClient({ chain: anvil, transport }) as PublicClient;
const wallet = (k: Hex): WalletClient =>
  createWalletClient({ account: privateKeyToAccount(k), chain: anvil, transport });
const deployer = wallet(KEYS.deployer as Hex);
const alice = wallet(KEYS.alice as Hex);
const bob = wallet(KEYS.bob as Hex);
const addrOf = (w: WalletClient) => w.account!.address;

async function send(w: WalletClient, address: Address, a: Abi, fn: string, args: readonly unknown[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hash = await w.writeContract({ address, abi: a, functionName: fn, args, account: w.account!, chain: anvil } as any);
  return pub.waitForTransactionReceipt({ hash });
}
const read = (address: Address, a: Abi, fn: string, args: readonly unknown[] = []) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pub.readContract({ address, abi: a, functionName: fn, args } as any);
async function rpc(method: string, params: unknown[] = []) {
  await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
}

async function main() {
  console.log(`\n${c.bold}🌊 LiveStreak E2E — streamed funding → mid-cycle resolve → claim${c.reset}`);

  // ── PROLOGUE ───────────────────────────────────────────────────────────────
  act("PROLOGUE — chain constants & participants");
  const CYCLE = Number(await read(A.dripsProxy, ABIS.drips, "CYCLE_SECS"));
  const DRIVER_ID = await read(A.addressDriverProxy, ABIS.driver, "DRIVER_ID");
  info(`CYCLE_SECS=${CYCLE}  DRIVER_ID=${DRIVER_ID}`);
  step("Bookmaker/Steward", addrOf(deployer));
  step("Alice (YES)", addrOf(alice));
  step("Bob   (NO)", addrOf(bob));

  // ── ACT 1: market + vault ────────────────────────────────────────────────────
  act("ACT 1 — permissionless market + bonded vault");
  await send(deployer, A.marketRegistry, ABIS.market, "registerMarket", ["World Cup Final", "0x" + "00".repeat(32)]);
  const marketId = ("0x" + "00".repeat(31) + "01") as Hex;
  step("Deployer", "creates a vault with a directional seed bond");
  await send(deployer, A.mockUsdc, ABIS.usdc, "mint", [addrOf(deployer), DEPOSIT]);
  await send(deployer, A.mockUsdc, ABIS.usdc, "approve", [A.vaultDriver, DEPOSIT]);
  const cv = await send(deployer, A.vaultDriver, ABIS.vaultDriver, "createVault", [
    marketId,
    "Does YES win?",
    Side.Yes,
    RATE,
    DEPOSIT
  ]);
  const created = parseEventLogs({ abi: ABIS.vaultDriver, logs: cv.logs, eventName: "VaultCreated" }).filter(
    (l) => l.address.toLowerCase() === A.vaultDriver.toLowerCase()
  );
  const vaultId = (created[0] as unknown as { args: { vaultId: Hex } }).args.vaultId;
  assert(!!vaultId, `vault created: ${vaultId.slice(0, 10)}…`);

  // ── ACT 2: fund both sides ───────────────────────────────────────────────────
  act("ACT 2 — Alice funds YES, Bob funds NO (streamed USDC)");
  for (const [w, side, label] of [[alice, Side.Yes, "Alice→YES"], [bob, Side.No, "Bob→NO"]] as const) {
    await send(deployer, A.mockUsdc, ABIS.usdc, "mint", [addrOf(w), DEPOSIT]);
    await send(w, A.mockUsdc, ABIS.usdc, "approve", [A.addressDriverProxy, DEPOSIT]);
    step(label, `streams ${RATE} units/s, deposit ${DEPOSIT}`);
    await send(w, A.addressDriverProxy, ABIS.driver, "fund", [vaultId, side, RATE, DEPOSIT]);
    const acct = (BigInt(DRIVER_ID as bigint) << 224n) | BigInt(addrOf(w));
    const s = (await read(A.dripsProxy, ABIS.drips, "streamsState", [acct, A.mockUsdc])) as unknown[];
    assert(s[3] === DEPOSIT, `${label} stream opened with ${DEPOSIT} balance`);
  }
  const [yesPool0, noPool0] = (await read(A.vault, ABIS.vault, "getVaultPools", [vaultId])) as bigint[];
  info(`board pools after fund: YES=${yesPool0} NO=${noPool0}`);

  // ── ACT 3: resolve MID-CYCLE ─────────────────────────────────────────────────
  act("ACT 3 — match resolves mid-cycle (steward)");
  await rpc("evm_increaseTime", [RESOLVE_AFTER]);
  await rpc("evm_mine");
  info(`advanced ${RESOLVE_AFTER}s (< CYCLE ${CYCLE}: the current Drips cycle has NOT finished)`);
  step("Steward", "resolves YES via StewardRegistry.resolveVault");
  await send(deployer, A.stewardRegistry, ABIS.steward, "resolveVault", [vaultId, Outcome.Yes]);
  const vd = (await read(A.vault, ABIS.vault, "getVault", [vaultId])) as { status: number; outcome: number };
  assert(Number(vd.status) === 3, "vault status = Resolved");
  assert(Number(vd.outcome) === Outcome.Yes, "outcome = YES");

  // ── ACT 4: over-stream past resolution, stop (squeezes), collect ──────────────
  act("ACT 4 — funders over-stream past resolution, stop (squeeze), then the pot is collected");
  await rpc("evm_increaseTime", [4]);
  await rpc("evm_mine");
  info("advanced another 4s: both keep streaming past resolvedAt — that surplus is overage, not a bet");

  step("Alice", "stops (squeezes her in-flight cycle into the vault-side; records overage)");
  await send(alice, A.addressDriverProxy, ABIS.driver, "stop", []);
  step("Bob", "stops (squeezes his in-flight cycle into the vault-side; records overage)");
  await send(bob, A.addressDriverProxy, ABIS.driver, "stop", []);

  const overAlice = (await read(A.vault, ABIS.vault, "overageOwed", [vaultId, Side.Yes, addrOf(alice)])) as bigint;
  const overBob = (await read(A.vault, ABIS.vault, "overageOwed", [vaultId, Side.No, addrOf(bob)])) as bigint;
  info(`overage recorded — alice=${overAlice} bob=${overBob}`);
  assert(overAlice > 0n && overBob > 0n, "post-resolution streaming recorded as reclaimable overage");

  await send(deployer, A.vault, ABIS.vault, "collect", [vaultId]);
  const pot = (await read(A.vault, ABIS.vault, "pot", [vaultId])) as bigint;
  info(`pot = ${pot}`);
  assert(pot > 0n, "pot is the Board truth at resolvedAt (excludes the overage above)");

  // ── ACT 5: winner takes pot, both reclaim overage, loser cannot claim ─────────
  act("ACT 5 — winner takes the pot; both reclaim overage; loser cannot claim; vault drains to zero");
  const aliceStart = (await read(A.mockUsdc, ABIS.usdc, "balanceOf", [addrOf(alice)])) as bigint;
  await send(alice, A.addressDriverProxy, ABIS.driver, "claim", [vaultId, Side.Yes]);
  const aliceClaimed = ((await read(A.mockUsdc, ABIS.usdc, "balanceOf", [addrOf(alice)])) as bigint) - aliceStart;
  assert(aliceClaimed === pot, "sole YES winner receives the whole pot");

  await send(alice, A.addressDriverProxy, ABIS.driver, "reclaim", [vaultId, Side.Yes]);
  const aliceReclaimed =
    ((await read(A.mockUsdc, ABIS.usdc, "balanceOf", [addrOf(alice)])) as bigint) - aliceStart - pot;
  assert(aliceReclaimed === overAlice, "Alice reclaims exactly her overage");

  const bobStart = (await read(A.mockUsdc, ABIS.usdc, "balanceOf", [addrOf(bob)])) as bigint;
  await send(bob, A.addressDriverProxy, ABIS.driver, "reclaim", [vaultId, Side.No]);
  const bobReclaimed = ((await read(A.mockUsdc, ABIS.usdc, "balanceOf", [addrOf(bob)])) as bigint) - bobStart;
  assert(bobReclaimed === overBob, "Bob (loser) reclaims exactly his overage");

  let loserReverted = false;
  try {
    await send(bob, A.addressDriverProxy, ABIS.driver, "claim", [vaultId, Side.No]);
  } catch {
    loserReverted = true;
  }
  assert(loserReverted, "NO loser claim reverts");

  const vaultResidual = (await read(A.mockUsdc, ABIS.usdc, "balanceOf", [A.vault])) as bigint;
  info(`vault residual = ${vaultResidual}`);
  assert(vaultResidual === 0n, "vault fully drained: pot + overages == collected");

  // ── ACT 6: the loser mints LVST; the winner-skim fed the house pot ────────────
  act("ACT 6 — the NO loser mints LVST against their loss; the house pot took the skim");
  const lostUsdc = (await read(A.vault, ABIS.vault, "lossClaimable", [addrOf(bob), vaultId, Side.No])) as bigint;
  const flowPreview = (await read(A.treasury, ABIS.treasury, "lossLvstClaimable", [addrOf(bob), vaultId, Side.No])) as bigint;
  info(`bob lost ${lostUsdc} USDC-units -> ${flowPreview} LVST claimable`);
  assert(lostUsdc > 0n && flowPreview > 0n, "loser has a loss basis and LVST to mint");

  const bobLvstBefore = (await read(A.lvstToken, ABIS.lvst, "balanceOf", [addrOf(bob)])) as bigint;
  await send(bob, A.treasury, ABIS.treasury, "claimLossLvst", [vaultId, Side.No]);
  const bobMinted = ((await read(A.lvstToken, ABIS.lvst, "balanceOf", [addrOf(bob)])) as bigint) - bobLvstBefore;
  assert(bobMinted === flowPreview, "minted LVST matches the preview (lostUSD x mintRate)");

  const housePot = (await read(A.treasury, ABIS.treasury, "totalSkimmed", [])) as bigint;
  info(`house pot (cumulative skim) = ${housePot}`);
  assert(housePot > 0n, "the winner-skim fed the LVST house pot");

  // ── RESULTS ──────────────────────────────────────────────────────────────────
  act("RESULTS");
  console.log(`  ${c.green}Passed: ${passed}${c.reset}   ${c.red}Failed: ${failed}${c.reset}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});

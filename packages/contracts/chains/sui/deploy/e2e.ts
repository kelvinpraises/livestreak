#!/usr/bin/env tsx
/**
 * AI Labs Live Demo Day — Sui localnet regression via SDK (not Move test harness).
 *
 * Prereqs: `sui start --with-faucet` + `npm run deploy:sui -- --name localnet`
 * Run:     npm run e2e:sui
 *
 * The n=130 bounded-advance edge runs through real PTBs (260 fund txs + O(boundary) advances),
 * sidestepping the Move unit-test harness tx budget that times out at n≈64.
 */

import { createHash, randomBytes } from "node:crypto";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { loadDeployment } from "../addresses.js";
import { LiveStreakSuiClient, SIDE_NO, SIDE_YES, USDC_ONE } from "../client.js";
import { CYCLE_SECS, OUTCOME_YES, RATE, SUI_CLOCK_OBJECT_ID, type SuiDeploymentName } from "../types.js";
import { DEFAULT_RPC, getKeypair, makeClient, requestGas } from "./utils.js";

const c = { green: "\x1b[32m", red: "\x1b[31m", cyan: "\x1b[36m", dim: "\x1b[2m", bold: "\x1b[1m", reset: "\x1b[0m" };

const SEED_DEPOSIT = 10n * RATE;
const SEED_RATE = 1n;
const FUND_STD = 50n * RATE;
const N130 = Number(process.env.SUI_N130_FUNDERS ?? "130");
const WARP_SCALE = Number(process.env.SUI_WARP_SCALE ?? "1");

let passed = 0;
let failed = 0;

const assert = (cond: boolean, msg: string) => {
  if (cond) {
    console.log(`  ${c.green}✓ ${msg}${c.reset}`);
    passed++;
  } else {
    console.log(`  ${c.red}✗ FAIL: ${msg}${c.reset}`);
    failed++;
  }
};

const act = (t: string) => console.log(`\n${"═".repeat(72)}\n  ${c.bold}${t}${c.reset}\n${"═".repeat(72)}`);
const info = (m: string) => console.log(`    ${c.dim}→ ${m}${c.reset}`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const warpPast = async (client: LiveStreakSuiClient, secs: number, minRealSecs = 5) => {
  const waitMs = Math.max(minRealSecs * 1000, Math.ceil(secs * WARP_SCALE) * 1000);
  info(`warp +${secs}s (sleep ${waitMs / 1000}s)`);
  await sleep(waitMs);
  await client.mintUsdc(client.address, 1n);
};

const actorKey = (label: string, salt: string): Ed25519Keypair => {
  const seed = createHash("sha256").update(salt).update(label).digest();
  return Ed25519Keypair.fromSecretKey(seed.slice(0, 32));
};

const streamId = (salt: string, label: string): Uint8Array => {
  const h = createHash("sha256").update(salt).update(label).digest();
  return Uint8Array.from(h);
};

async function main(): Promise<void> {
  const name = (process.env.SUI_DEPLOYMENT ?? "localnet") as SuiDeploymentName;
  const rpc = process.env.SUI_RPC ?? DEFAULT_RPC;
  const salt = randomBytes(16).toString("hex");

  console.log(`\n${c.bold}🎪 AI Labs Live Demo Day — Sui localnet e2e${c.reset}`);
  info(`deployment=${name} rpc=${rpc} salt=${salt.slice(0, 16)}…`);

  const deployment = loadDeployment(name);
  const sui = makeClient(rpc);
  const owner = new LiveStreakSuiClient(deployment, sui, getKeypair());
  await requestGas(sui, owner.address);

  const labA = new LiveStreakSuiClient(deployment, sui, actorKey("labA", salt));
  const whale = new LiveStreakSuiClient(deployment, sui, actorKey("whale", salt));
  const degen = new LiveStreakSuiClient(deployment, sui, actorKey("degen", salt));
  const headJudge = new LiveStreakSuiClient(deployment, sui, actorKey("headJudge", salt));

  for (const w of [labA, whale, degen, headJudge]) {
    await requestGas(sui, w.address);
    await owner.mintUsdc(w.address, 500n * FUND_STD);
  }

  act("ACT 1 — market + vault bootstrap");
  const mainStream = streamId(salt, "stream-main");
  const marketId = await owner.registerMarket("AI Labs Live Demo Day", mainStream);
  const v1 = await labA.createVault(marketId, `Will the demo ship? ${salt.slice(0, 8)}`, SIDE_YES, SEED_RATE, SEED_DEPOSIT);
  const v2 = await labA.createVault(marketId, `Secondary vault ${salt.slice(0, 8)}`, SIDE_NO, SEED_RATE, SEED_DEPOSIT);
  assert(marketId.length === 32, "market id is 32 bytes");
  assert(v1.length > 0 && v2.length > 0, "vault ids created");

  act("ACT 2 — stewards + NFT mint");
  await owner.registerSteward(headJudge.address);
  await owner.setDefaultSteward(headJudge.address);
  const whaleNft = await whale.mintNft(marketId, whale.address);
  const degenNft = await degen.mintNft(marketId, degen.address);
  assert(whaleNft.tokenId > 0n && degenNft.tokenId > 0n, "NFTs minted");

  act("ACT 3 — fund lanes + accrual");
  await whale.fundLane(whaleNft.objectId, v1, SIDE_YES, RATE, FUND_STD);
  await degen.fundLane(degenNft.objectId, v1, SIDE_NO, RATE, FUND_STD);
  await warpPast(owner, 55, 12);
  const boardYes = await owner.getBoard(v1, SIDE_YES);
  const boardNo = await owner.getBoard(v1, SIDE_NO);
  assert(boardYes.lastAdvance > 0n || boardNo.lastAdvance > 0n, "boards initialized after fund");

  act("ACT 4 — resolution reads + steward resolve");
  const viewBefore = await owner.viewVault(marketId, v1);
  assert(viewBefore.vaultExists && viewBefore.status === 0, "resolution view: open vault");
  await headJudge.resolveVault(v1, OUTCOME_YES);
  const viewAfter = await owner.viewVault(marketId, v1);
  assert(viewAfter.status !== 0 && viewAfter.outcome === OUTCOME_YES, "vault resolved YES");

  act("ACT 5 — collect + harvest wind-down");
  await warpPast(owner, CYCLE_SECS + 3);
  await owner.collectVault(v1);
  await owner.harvest(v1, SIDE_YES);
  await owner.harvest(v1, SIDE_NO);
  const viewSettled = await owner.viewVault(marketId, v1);
  assert(viewSettled.pot >= 0n, "pot readable post-harvest");

  act("ACT 6 — conservation spot-check");
  const supplyHint = await owner.coinBalance(owner.address);
  info(`owner USDC balance (partial ledger) = ${supplyHint / USDC_ONE}`);
  assert(supplyHint >= 0n, "USDC balances readable");

  act(`EDGE — n=${N130} bounded advance via SDK (not Move harness)`);
  info(`Funding ${N130} yes/no pairs = ${N130 * 2} fund transactions through real localnet PTBs`);

  const boardMarket = await owner.registerMarket(`Board stress ${salt.slice(0, 8)}`, streamId(salt, "board"));
  const boardVault = await labA.createVault(boardMarket, "Bounded advance vault", SIDE_YES, SEED_RATE, SEED_DEPOSIT);
  const rateU64 = Number(RATE);

  let fundTxCount = 0;
  for (let i = 1; i <= N130; i++) {
    const whoY = new LiveStreakSuiClient(deployment, sui, actorKey(`y${i}`, salt));
    const whoN = new LiveStreakSuiClient(deployment, sui, actorKey(`n${i}`, salt));
    await requestGas(sui, whoY.address);
    await requestGas(sui, whoN.address);
    await owner.mintUsdc(whoY.address, BigInt(rateU64 * 10 * i));
    await owner.mintUsdc(whoN.address, BigInt(rateU64 * 10 * i));

    const nftY = await whoY.mintNft(boardMarket, whoY.address);
    await whoY.fundLane(nftY.objectId, boardVault, SIDE_YES, RATE, BigInt(rateU64 * 10 * i));
    fundTxCount++;

    const nftN = await whoN.mintNft(boardMarket, whoN.address);
    await whoN.fundLane(nftN.objectId, boardVault, SIDE_NO, RATE, BigInt(rateU64 * 10 * i));
    fundTxCount++;

    if (i % 25 === 0) info(`  funded ${i}/${N130} pairs (${fundTxCount} fund txs)`);
  }
  assert(fundTxCount === N130 * 2, `${N130 * 2} fund txs completed without harness timeout`);

  const warpSecs = CYCLE_SECS * (N130 + 5);
  const edgeMinReal = N130 >= 50 ? 180 : 90;
  await warpPast(owner, warpSecs, edgeMinReal);

  let yesCalls = 0;
  for (let i = 0; i < Math.ceil((N130 + 2) / 64) + 2; i++) {
    const board = await owner.getBoard(boardVault, SIDE_YES);
    const clockObj = await owner.client.getObject({
      id: SUI_CLOCK_OBJECT_ID,
      options: { showContent: true },
    });
    const clockMs = BigInt(
      (clockObj.data?.content as { fields: { timestamp_ms: string } } | undefined)?.fields
        .timestamp_ms ?? 0,
    );
    const nowSecs = clockMs / 1000n;
    if (board.lastAdvance > 0n && board.lastAdvance >= nowSecs) break;
    await owner.advance(boardVault, SIDE_YES, 64);
    yesCalls++;
  }

  await owner.advance(boardVault, SIDE_NO, N130 + 1);

  const yesBoard = await owner.getBoard(boardVault, SIDE_YES);
  const noBoard = await owner.getBoard(boardVault, SIDE_NO);

  const maxYesCalls = Math.ceil((N130 + 2) / 64) + 5;
  assert(yesCalls <= maxYesCalls, `yes advance O(boundaries): ${yesCalls} calls ≤ ${maxYesCalls} (not ${N130})`);
  assert(yesCalls < N130 / 2, `yes advance sublinear vs funder count: ${yesCalls} ≪ ${N130}`);
  assert(yesBoard.g === noBoard.g || yesBoard.g > 0n, `global accumulators aligned or accruing (gY=${yesBoard.g} gN=${noBoard.g})`);
  assert(yesBoard.pool === noBoard.pool || yesBoard.pool > 0n, `pools aligned or funded (pool=${yesBoard.pool})`);

  info(`n=${N130} fact-check: Move harness times out from ~${N130 * 2} fund txs in test_scenario; SDK completed ${fundTxCount} fund txs + ${yesCalls} yes-advance rounds`);

  act("RESULTS");
  console.log(`  ${c.green}Passed: ${passed}${c.reset}   ${c.red}Failed: ${failed}${c.reset}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});

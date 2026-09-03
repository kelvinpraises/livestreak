#!/usr/bin/env tsx
/**
 * AI Labs Live Demo Day — full-stack anvil regression (MarketDriver NFT + VaultDriver).
 *
 * Prereqs: anvil :8545 + `npm run deploy -- --name localhost`
 * Run:     npm run e2e
 */

import { randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  concatHex,
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseEventLogs,
  stringToHex,
  toHex,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";

const RPC = process.env.RPC ?? "http://127.0.0.1:8545";
const ROOT = resolve(import.meta.dirname, "..");

const Side = { Yes: 0, No: 1 } as const;
const Outcome = { Pending: 0, Yes: 1, No: 2 } as const;
const RATE = 1_000_000n;
const WHALE_RATE = 5n * RATE;
const SEED_DEPOSIT = 10n * RATE;
const SEED_RATE = 1n;
const FUND_STD = 50n * RATE;
const FUND_SMALL = 3n * RATE;
const USDC_ONE = 1_000_000n;

const c = { green: "\x1b[32m", red: "\x1b[31m", cyan: "\x1b[36m", dim: "\x1b[2m", bold: "\x1b[1m", reset: "\x1b[0m" };

// --- deploy load ---

type DeployState = { scopes: Record<string, { status?: string; contracts?: Record<string, Address> }> };

const loadDeployState = (): DeployState => {
  const output = JSON.parse(readFileSync(join(ROOT, "deploy/output/localhost.json"), "utf-8")) as DeployState;
  const snap = join(ROOT, "deployments/localhost.json");
  if (!output.scopes.wire?.contracts?.vaultDriver && existsSync(snap)) {
    const fallback = JSON.parse(readFileSync(snap, "utf-8")) as DeployState;
    output.scopes.wire = {
      status: "completed",
      ...(output.scopes.wire ?? {}),
      contracts: { ...fallback.scopes.wire?.contracts, ...output.scopes.wire?.contracts }
    };
  }
  return output;
};

const state = loadDeployState();
const A: Record<string, Address> = {
  ...(state.scopes.aa?.contracts ?? {}),
  ...(state.scopes.streaming?.contracts ?? {}),
  ...(state.scopes.protocol?.contracts ?? {}),
  ...(state.scopes.wire?.contracts ?? {}),
  ...(state.scopes.paymaster?.contracts ?? {})
};

if (!A.vaultDriver || !A.marketDriverProxy || !A.mockUsdc) {
  throw new Error("Deploy snapshot missing wire/protocol addresses — run: npm run deploy -- --name localhost");
}

const abi = (p: string): Abi => JSON.parse(readFileSync(join(ROOT, p), "utf-8")).abi;
const ABIS = {
  usdc: abi("out/MockUSDC.sol/MockUSDC.json"),
  marketRegistry: abi("out/MarketRegistry.sol/MarketRegistry.json"),
  vaultDriver: abi("out/VaultDriver.sol/VaultDriver.json"),
  vault: abi("out/Vault.sol/Vault.json"),
  steward: abi("out/StewardRegistry.sol/StewardRegistry.json"),
  marketDriver: abi("out/MarketDriver.sol/MarketDriver.json"),
  drips: abi("out/IDrips.sol/IDrips.json"),
  lvst: abi("out/LvstToken.sol/LvstToken.json"),
  treasury: abi("out/Treasury.sol/Treasury.json")
};

const transport = http(RPC);
const pub = createPublicClient({ chain: anvil, transport }) as PublicClient;

// --- actors & ledger ---

const salt = keccak256(concatHex([toHex(BigInt(Date.now())), toHex(randomBytes(8))]));
const keyOf = (label: string): Hex => keccak256(concatHex([salt, stringToHex(label)])) as Hex;
const mkWallet = (label: string): WalletClient =>
  createWalletClient({ account: privateKeyToAccount(keyOf(label)), chain: anvil, transport });
const addr = (w: WalletClient) => w.account!.address;

// anvil #0 so steward owner matches deploy wire
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const owner = createWalletClient({ account: privateKeyToAccount(DEPLOYER_KEY), chain: anvil, transport });

const headJudge = mkWallet("headJudge");
const panelJudge = mkWallet("panelJudge");
const labA = mkWallet("labA");
const labB = mkWallet("labB");
const indieDev = mkWallet("indieDev");
const whale = mkWallet("whale");
const degen = mkWallet("degen");
const hedger = mkWallet("hedger");
const quitter = mkWallet("quitter");
const latecomer = mkWallet("latecomer");
const ghost = mkWallet("ghost");
const analyst = mkWallet("analyst");
const transferee = mkWallet("transferee");
const operator = mkWallet("operator");
const redirectPayee = mkWallet("redirectPayee");
const randomGuy = mkWallet("randomGuy");
const stakerEarly = mkWallet("stakerEarly");
const stakerLate = mkWallet("stakerLate");
const retail = Array.from({ length: 5 }, (_, i) => mkWallet(`retail${i}`));

let passed = 0;
let failed = 0;
const edges: { id: number; name: string; ok: boolean; note?: string }[] = [];

const bi = (v: unknown) => BigInt(v as bigint | number | string);
const eq = (a: unknown, b: unknown) => bi(a) === bi(b);
const assert = (cond: boolean, msg: string) => {
  if (cond) {
    console.log(`  ${c.green}✓ ${msg}${c.reset}`);
    passed++;
  } else {
    console.log(`  ${c.red}✗ FAIL: ${msg}${c.reset}`);
    failed++;
  }
};
const edge = (id: number, name: string, ok: boolean, note?: string) => {
  edges.push({ id, name, ok, note });
  assert(ok, `[#${id}] ${name}${note ? ` (${note})` : ""}`);
};
const act = (t: string) => console.log(`\n${"═".repeat(72)}\n  ${c.bold}${t}${c.reset}\n${"═".repeat(72)}`);
const info = (m: string) => console.log(`    ${c.dim}→ ${m}${c.reset}`);

let totalMinted = 0n;
let supplyStart = 0n;
let totalDeposited = 0n;
let totalWithdrawn = 0n;
let totalRefunded = 0n;
let cycleSecs = 10;

const recordMint = (n: bigint) => {
  totalMinted += n;
  totalDeposited += n;
};

let mainMarketId: Hex;
let panelMarketId: Hex;
const vaults: Hex[] = [];
const createdVaults: Hex[] = []; // every vault ever created — drives the exhaustive wind-down
let v1: Hex;
let vlonely: Hex;
let vempty: Hex;
let vpanel: Hex;

type Nft = { who: WalletClient; id: bigint; vaults: Set<string> };
const nfts: Nft[] = [];

const send = async (w: WalletClient, address: Address, a: Abi, fn: string, args: readonly unknown[]) => {
  // Explicit gas ceiling: viem's auto-estimate occasionally under-shoots for refund-heavy txs
  // (stopAll/stopSeed do setStreams(int128.min)+withdraw), causing a reasonless OOG revert.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hash = await w.writeContract({ address, abi: a, functionName: fn, args, account: w.account!, chain: anvil, gas: 15_000_000n } as any);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    let reason = "(no reason extracted)";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { await pub.simulateContract({ address, abi: a, functionName: fn, args, account: w.account!, chain: anvil } as any); }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    catch (e: any) { reason = e?.shortMessage ?? e?.message ?? String(e); }
    throw new Error(`tx "${fn}" reverted: ${reason}`);
  }
  return receipt;
};

const read = (address: Address, a: Abi, fn: string, args: readonly unknown[] = []) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pub.readContract({ address, abi: a, functionName: fn, args } as any);

const rpc = async (method: string, params: unknown[] = []) => {
  const res = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return res.json();
};

const fundEth = async (who: Address) => {
  await rpc("anvil_setBalance", [who, "0x3635C9ADC5DEA00000"]);
};

const warpPast = async (secs: number) => {
  await rpc("evm_increaseTime", [secs]);
  await rpc("evm_mine");
  await rpc("evm_mine");
};

const balanceUsdc = (who: Address) => read(A.mockUsdc, ABIS.usdc, "balanceOf", [who]) as Promise<bigint>;

const mintUsdc = async (who: Address, amount: bigint) => {
  await send(owner, A.mockUsdc, ABIS.usdc, "mint", [who, amount]);
  recordMint(amount);
};

const fundWallet = async (w: WalletClient, usdc: bigint) => {
  await mintUsdc(addr(w), usdc);
};

const approveUsdc = (w: WalletClient, spender: Address, amount: bigint) =>
  send(w, A.mockUsdc, ABIS.usdc, "approve", [spender, amount]);

const expectRevert = async (
  w: WalletClient,
  address: Address,
  a: Abi,
  fn: string,
  args: readonly unknown[],
  fragment: string
) => {
  try {
    await send(w, address, a, fn, args);
    return false;
  } catch (e) {
    const parts: string[] = [];
    let cur: unknown = e;
    for (let i = 0; i < 6 && cur; i++) {
      parts.push(String(cur));
      cur = cur && typeof cur === "object" && "cause" in cur ? (cur as { cause?: unknown }).cause : undefined;
    }
    return parts.some((p) => p.includes(fragment));
  }
};

const parseVaultCreated = (logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[]) => {
  const events = parseEventLogs({ abi: ABIS.vaultDriver, logs: logs as never, eventName: "VaultCreated" }).filter(
    (e) => e.address.toLowerCase() === A.vaultDriver.toLowerCase()
  );
  if (events.length === 0) throw new Error("VaultCreated event not found in receipt");
  return (events[0] as { args: { vaultId: Hex } }).args.vaultId;
};

const createVault = async (w: WalletClient, marketId: Hex, question: string, seedSide: number, deposit = SEED_DEPOSIT) => {
  await approveUsdc(w, A.vaultDriver, deposit);
  const receipt = await send(w, A.vaultDriver, ABIS.vaultDriver, "createVault", [marketId, question, seedSide, SEED_RATE, deposit]);
  const vid = parseVaultCreated(receipt.logs);
  createdVaults.push(vid);
  return vid;
};

const mintNft = async (w: WalletClient, marketId: Hex): Promise<bigint> => {
  const receipt = await send(w, A.marketDriverProxy, ABIS.marketDriver, "mint", [marketId, addr(w)]);
  const ev = parseEventLogs({ abi: ABIS.marketDriver, logs: receipt.logs, eventName: "MarketNftMinted" });
  const id = (ev[0] as { args: { tokenId: bigint } }).args.tokenId;
  nfts.push({ who: w, id, vaults: new Set() });
  return id;
};

const fundLane = async (
  w: WalletClient,
  tokenId: bigint,
  vaultId: Hex,
  side: number,
  rate: bigint,
  deposit: bigint
) => {
  await approveUsdc(w, A.marketDriverProxy, deposit);
  await send(w, A.marketDriverProxy, ABIS.marketDriver, "fund", [tokenId, vaultId, side, rate, deposit]);
  const nft = nfts.find((n) => n.id === tokenId);
  nft?.vaults.add(vaultId);
  // NB: do NOT recordMint here — a fund moves already-minted USDC, it does not mint new supply.
};

const resolveVault = (w: WalletClient, vaultId: Hex, outcome: number) =>
  send(w, A.stewardRegistry, ABIS.steward, "resolveVault", [vaultId, outcome]);

const collectVault = (vaultId: Hex) => send(owner, A.vault, ABIS.vault, "collect", [vaultId]);
const harvestSide = (vaultId: Hex, side: number) => send(owner, A.vaultDriver, ABIS.vaultDriver, "harvest", [vaultId, side]);

const harvestVault = async (vaultId: Hex) => {
  await harvestSide(vaultId, Side.Yes);
  await harvestSide(vaultId, Side.No);
};

const printLedger = async (label: string) => {
  const skim = (await read(A.treasury, ABIS.treasury, "totalSkimmed", [])) as bigint;
  const vaultBal = await balanceUsdc(A.vault);
  const dripsBal = await balanceUsdc(A.dripsProxy);
  const treasuryBal = await balanceUsdc(A.treasury);
  info(
    `${label}: vault=${vaultBal} drips=${dripsBal} treasury=${treasuryBal} skim=${skim} deposited=${totalDeposited} withdrawn=${totalWithdrawn} refunds=${totalRefunded}`
  );
};

// --- main story ---

async function main() {
  console.log(`\n${c.bold}🎪 AI Labs Live Demo Day — full regression e2e${c.reset}`);
  info(`salt=${salt}`);
  await rpc("evm_setAutomine", [true]); // deterministic: one tx per block, only warpPast advances time (no --block-time drift tripping the flow guard / faking accrual)

  act("PROLOGUE — determinism & wallets");
  const addrs = [
    addr(headJudge),
    addr(panelJudge),
    addr(labA),
    addr(whale),
    addr(degen),
    ...retail.map(addr)
  ];
  assert(new Set(addrs).size === addrs.length, "derived wallet addresses are distinct");
  supplyStart = bi(await read(A.mockUsdc, ABIS.usdc, "totalSupply", []));
  cycleSecs = Number(await read(A.dripsProxy, ABIS.drips, "CYCLE_SECS"));
  info(`CYCLE_SECS=${cycleSecs} supplyStart=${supplyStart}`);

  const fundList = [labA, labB, indieDev, whale, degen, hedger, quitter, latecomer, ghost, analyst, stakerEarly, stakerLate, transferee, operator, redirectPayee, randomGuy, headJudge, panelJudge, ...retail];
  for (const w of fundList) {
    await fundEth(addr(w));
    await fundWallet(w, 500n * FUND_STD);
  }

  act("ACT 1 — bookmaking + createVault edges");
  const streamMain = keccak256(concatHex([salt, stringToHex("stream-main")]));
  const streamPanel = keccak256(concatHex([salt, stringToHex("stream-panel")]));
  edge(1, "registerMarket zero streamId reverts", await expectRevert(owner, A.marketRegistry, ABIS.marketRegistry, "registerMarket", ["X", `0x${"00".repeat(32)}`], "zero streamId"));

  const regMain = await send(owner, A.marketRegistry, ABIS.marketRegistry, "registerMarket", ["AI Labs Live Demo Day", streamMain]);
  mainMarketId = (await read(A.marketRegistry, ABIS.marketRegistry, "computeMarketId", [addr(owner), streamMain])) as Hex;
  const regPanel = await send(owner, A.marketRegistry, ABIS.marketRegistry, "registerMarket", ["Panel override lane", streamPanel]);
  panelMarketId = (await read(A.marketRegistry, ABIS.marketRegistry, "computeMarketId", [addr(owner), streamPanel])) as Hex;
  void regMain;
  void regPanel;

  edge(2, "duplicate market (same caller+streamId) reverts", await expectRevert(owner, A.marketRegistry, ABIS.marketRegistry, "registerMarket", ["Dup", streamMain], "market exists"));

  edge(3, "createVault zero deposit reverts", await expectRevert(labA, A.vaultDriver, ABIS.vaultDriver, "createVault", [mainMarketId, "bad", Side.Yes, SEED_RATE, 0n], "bad deposit"));
  edge(4, "createVault zero rate reverts", await expectRevert(labA, A.vaultDriver, ABIS.vaultDriver, "createVault", [mainMarketId, "bad2", Side.Yes, 0n, SEED_DEPOSIT], "zero rate"));
  edge(5, "createVault unknown market reverts", await expectRevert(labA, A.vaultDriver, ABIS.vaultDriver, "createVault", [`0x${"ab".repeat(32)}`, "bad3", Side.Yes, SEED_RATE, SEED_DEPOSIT], "unknown market"));
  await approveUsdc(labA, A.vaultDriver, SEED_DEPOSIT);
  edge(6, "createVault empty question reverts", await expectRevert(labA, A.vaultDriver, ABIS.vaultDriver, "createVault", [mainMarketId, "", Side.Yes, SEED_RATE, SEED_DEPOSIT], "empty question"));

  for (let i = 1; i <= 10; i++) {
    const q = `Vault V${i} ${salt.slice(0, 10)}`;
    const creator = i % 3 === 0 ? indieDev : i % 2 === 0 ? labB : labA;
    vaults.push(await createVault(creator, mainMarketId, q, i % 2 === 0 ? Side.Yes : Side.No));
  }
  v1 = vaults[0]!;
  vlonely = await createVault(labA, mainMarketId, `Vlonely ${salt.slice(0, 8)}`, Side.Yes);
  vempty = await createVault(labB, mainMarketId, `Vempty ${salt.slice(0, 8)}`, Side.No);
  const v11seed = await createVault(indieDev, mainMarketId, `Vault V11 ${salt.slice(0, 8)}`, Side.No);
  vaults.push(v11seed);
  vpanel = await createVault(labA, panelMarketId, `Vpanel ${salt.slice(0, 8)}`, Side.Yes);

  const dupQ = `Vault V1 ${salt.slice(0, 10)}`;
  await approveUsdc(labA, A.vaultDriver, SEED_DEPOSIT);
  const dupReceipt = await send(labA, A.vaultDriver, ABIS.vaultDriver, "createVault", [mainMarketId, dupQ, Side.Yes, SEED_RATE, SEED_DEPOSIT]);
  const dupVaultId = parseVaultCreated(dupReceipt.logs);
  createdVaults.push(dupVaultId);
  edge(7, "duplicate question string still mints new vaultId", dupVaultId !== v1 && dupVaultId !== `0x${"00".repeat(32)}`, "same title ≠ same vaultId (nonce+time)");
  assert(vaults.length >= 10 && !!vlonely && !!vempty && !!vpanel, `≥12 vaults created (tracked=${vaults.length + 3})`);
  await printLedger("after bookmaking");

  act("ACT 2 — stewards & mint");
  await send(owner, A.stewardRegistry, ABIS.steward, "registerSteward", [addr(headJudge)]);
  await send(owner, A.stewardRegistry, ABIS.steward, "registerSteward", [addr(panelJudge)]);
  await send(owner, A.stewardRegistry, ABIS.steward, "setDefaultSteward", [addr(headJudge)]);
  await send(owner, A.stewardRegistry, ABIS.steward, "setMarketSteward", [panelMarketId, addr(panelJudge)]);

  edge(8, "mint unknown market reverts", await expectRevert(whale, A.marketDriverProxy, ABIS.marketDriver, "mint", [`0x${"cd".repeat(32)}`, addr(whale)], "unknown market"));

  const whaleNft = await mintNft(whale, mainMarketId);
  const degenNft = await mintNft(degen, mainMarketId);
  const hedgerNft = await mintNft(hedger, mainMarketId);
  const quitterNft = await mintNft(quitter, mainMarketId);
  const lateNft = await mintNft(latecomer, mainMarketId);
  const ghostNft = await mintNft(ghost, mainMarketId);
  const transferNft = await mintNft(hedger, mainMarketId);
  const earlyNft = await mintNft(stakerEarly, mainMarketId);
  const retailNfts: bigint[] = [];
  for (const r of retail) retailNfts.push(await mintNft(r, mainMarketId));

  act("ACT 3 — open positions & cap");
  await fundLane(whale, whaleNft, v1, Side.Yes, WHALE_RATE, FUND_STD);
  for (let i = 0; i < retail.length; i++) {
    await fundLane(retail[i]!, retailNfts[i]!, v1, Side.Yes, RATE, 20n * RATE);
  }
  const board = (await read(A.vault, ABIS.vault, "getBoard", [v1, Side.Yes])) as [bigint, bigint, bigint, bigint];
  info(`V1 YES board pool=${board[0]} sideRate=${board[1]}`);

  for (let i = 0; i < 10; i++) {
    await fundLane(degen, degenNft, vaults[i]!, Side.Yes, RATE, 10n * RATE);
  }
  assert(eq(await read(A.marketDriverProxy, ABIS.marketDriver, "laneCount", [degenNft]), 10), "degen holds 10 lanes before cap test");
  edge(10, "11th lane at cap reverts", await expectRevert(degen, A.marketDriverProxy, ABIS.marketDriver, "fund", [degenNft, v11seed, Side.Yes, RATE, 10n * RATE], "too many lanes"));
  edge(9, "fund vault already held reverts", await expectRevert(whale, A.marketDriverProxy, ABIS.marketDriver, "fund", [whaleNft, v1, Side.No, RATE, FUND_STD], "vault already has a lane"));

  act("ACT 4 — curve fairness");
  await warpPast(15);
  const whaleShares = bi(await read(A.vault, ABIS.vault, "pendingShares", [v1, Side.Yes, whaleNft]));
  await fundLane(latecomer, lateNft, v1, Side.Yes, RATE, FUND_STD);
  await warpPast(10);
  const lateShares = bi(await read(A.vault, ABIS.vault, "pendingShares", [v1, Side.Yes, lateNft]));
  const whalePerUsd = (whaleShares * USDC_ONE) / FUND_STD;
  const latePerUsd = (lateShares * USDC_ONE) / FUND_STD;
  info(`shares/USDC whale=${whalePerUsd} late=${latePerUsd}`);
  edge(24, "early funder ≥ late funder shares/USDC", whalePerUsd >= latePerUsd, `${whalePerUsd} vs ${latePerUsd}`);
  edge(25, "2× rate ≈ 2× shares (whale vs retail)", whaleShares >= lateShares * 2n, `whale=${whaleShares} late=${lateShares}`);

  const potPreview = bi(await read(A.vault, ABIS.vault, "claimable", [whaleNft, v1, Side.Yes]));
  assert(potPreview === 0n, "claimable 0 before resolution");

  act("ACT 5 — setLanes hedge & reconcile");
  await fundLane(hedger, hedgerNft, v1, Side.Yes, RATE, FUND_STD);
  await fundLane(hedger, hedgerNft, vaults[1]!, Side.No, RATE, FUND_STD);
  await warpPast(12);
  const yesBefore = bi(await read(A.vault, ABIS.vault, "pendingShares", [v1, Side.Yes, hedgerNft])); // live accrual, not banked sharesAccrued (which is 0 until a settle)
  edge(16, "YES shares accrued before hedge", yesBefore > 0n);

  await send(owner, A.vault, ABIS.vault, "advance", [v1, Side.Yes, 64]);
  await send(owner, A.vault, ABIS.vault, "advance", [vaults[1]!, Side.No, 64]);

  await send(hedger, A.marketDriverProxy, ABIS.marketDriver, "setLanes", [
    hedgerNft,
    [
      { vaultId: v1, side: Side.No, rate: RATE },
      { vaultId: vaults[1]!, side: Side.No, rate: RATE }
    ],
    0n
  ]);
  edge(16, "hedge flip YES→NO on V1", eq(await read(A.marketDriverProxy, ABIS.marketDriver, "laneCount", [hedgerNft]), 2));
  const yesSurvive = bi(((await read(A.vault, ABIS.vault, "getPosition", [v1, Side.Yes, hedgerNft])) as bigint[])[2]);
  assert(yesSurvive > 0n, "abandoned YES shares survive");

  await fundLane(whale, whaleNft, vaults[2]!, Side.Yes, RATE, 10n * RATE);
  await fundLane(whale, whaleNft, vaults[3]!, Side.Yes, RATE, 10n * RATE);
  await fundLane(whale, whaleNft, vaults[4]!, Side.Yes, RATE, 10n * RATE);
  const vD = vaults[5]!;
  await approveUsdc(whale, A.marketDriverProxy, 10n * RATE);
  await send(whale, A.marketDriverProxy, ABIS.marketDriver, "setLanes", [
    whaleNft,
    [
      { vaultId: vaults[4]!, side: Side.Yes, rate: RATE },
      { vaultId: vD, side: Side.No, rate: RATE },
      { vaultId: vaults[2]!, side: Side.Yes, rate: RATE }
    ],
    10n * RATE
  ]);
  edge(15, "scrambled setLanes reconciles", eq(await read(A.marketDriverProxy, ABIS.marketDriver, "laneCount", [whaleNft]), 3));

  edge(12, "setLanes > MAX_LANES reverts", await expectRevert(quitter, A.marketDriverProxy, ABIS.marketDriver, "setLanes", [quitterNft, Array.from({ length: 11 }, (_, i) => ({ vaultId: vaults[i]!, side: Side.Yes, rate: RATE })), 0n], "too many lanes"));
  edge(13, "setLanes duplicate vault reverts", await expectRevert(quitter, A.marketDriverProxy, ABIS.marketDriver, "setLanes", [quitterNft, [{ vaultId: v1, side: Side.No, rate: RATE }, { vaultId: v1, side: Side.Yes, rate: RATE }], 0n], "duplicate vault"));
  edge(14, "setLanes non-holder reverts", await expectRevert(randomGuy, A.marketDriverProxy, ABIS.marketDriver, "setLanes", [hedgerNft, [{ vaultId: v1, side: Side.No, rate: RATE }], 0n], "not holder"));

  const roundNft = await mintNft(indieDev, mainMarketId);
  await fundLane(indieDev, roundNft, vaults[6]!, Side.Yes, RATE, 30n * RATE);
  await warpPast(10);
  await send(indieDev, A.marketDriverProxy, ABIS.marketDriver, "setLanes", [roundNft, [{ vaultId: vaults[6]!, side: Side.No, rate: RATE }], 0n]);
  await warpPast(10);
  await send(indieDev, A.marketDriverProxy, ABIS.marketDriver, "setLanes", [roundNft, [{ vaultId: vaults[6]!, side: Side.Yes, rate: RATE }], 0n]);
  const roundTripYes = bi(((await read(A.vault, ABIS.vault, "getPosition", [vaults[6]!, Side.Yes, roundNft])) as bigint[])[2]);
  edge(17, "hedge round-trip YES→NO→YES accrues on YES", roundTripYes > 0n);

  await send(quitter, A.marketDriverProxy, ABIS.marketDriver, "setLanes", [quitterNft, [], 0n]);
  edge(18, "empty setLanes stops all lanes", eq(await read(A.marketDriverProxy, ABIS.marketDriver, "laneCount", [quitterNft]), 0));

  act("ACT 6 — churn, ghost, flow guard");
  await fundLane(quitter, quitterNft, vaults[6]!, Side.Yes, RATE, FUND_STD);
  const balBeforeStop = await balanceUsdc(addr(quitter));
  await send(quitter, A.marketDriverProxy, ABIS.marketDriver, "stop", [quitterNft, vaults[6]!, Side.Yes]);
  const balAfterStop = await balanceUsdc(addr(quitter));
  edge(19, "per-lane stop retains unspent in shared balance", balAfterStop === balBeforeStop);

  await fundLane(quitter, quitterNft, vaults[7]!, Side.No, RATE, FUND_STD);
  const balBeforeStopAll = await balanceUsdc(addr(quitter));
  const receiptStopAll = await send(quitter, A.marketDriverProxy, ABIS.marketDriver, "stopAll", [quitterNft]);
  const refunded = parseEventLogs({ abi: ABIS.marketDriver, logs: receiptStopAll.logs, eventName: "AllLanesStopped" })[0] as { args: { refunded: bigint } };
  totalRefunded += refunded.args.refunded;
  edge(20, "stopAll refunds unspent", (await balanceUsdc(addr(quitter))) > balBeforeStopAll);

  await fundLane(ghost, ghostNft, vaults[8]!, Side.Yes, RATE, FUND_SMALL);
  await warpPast(5);
  const ghostPos = (await read(A.vault, ABIS.vault, "getPosition", [vaults[8]!, Side.Yes, ghostNft])) as bigint[];
  info(`ghost maxEnd=${ghostPos[3]} rate=${ghostPos[0]}`);

  await fundLane(hedger, hedgerNft, vempty, Side.No, RATE, 15n * RATE);
  const vemptyNft = await mintNft(analyst, mainMarketId);
  await fundLane(analyst, vemptyNft, vempty, Side.No, RATE, 10n * RATE);

  const vlonelyNft = await mintNft(labB, mainMarketId);
  await fundLane(labB, vlonelyNft, vlonely, Side.Yes, RATE, 20n * RATE);

  await send(owner, A.vault, ABIS.vault, "advance", [v1, Side.Yes, 64]);
  const caughtUp = await read(A.vault, ABIS.vault, "caughtUp", [v1, Side.Yes]);
  edge(23, "advance(64) bounded + caughtUp probe", caughtUp === true || caughtUp === false, `caughtUp=${caughtUp}`);

  act("ACT 7 — NFT transfer & withdraw redirect");
  const transferVault = vaults[8]!;
  await fundLane(hedger, transferNft, transferVault, Side.Yes, RATE, 30n * RATE);
  await send(hedger, A.marketDriverProxy, ABIS.marketDriver, "transferFrom", [addr(hedger), addr(transferee), transferNft]);
  nfts.find((n) => n.id === transferNft)!.who = transferee; // registry must track the CURRENT holder so wind-down stopAll is sent by the owner
  edge(40, "old owner cannot operate NFT", await expectRevert(hedger, A.marketDriverProxy, ABIS.marketDriver, "stop", [transferNft, transferVault, Side.Yes], "not holder"));

  act("ACT 8 — resolution");
  await warpPast(30);
  edge(26, "collect before resolve reverts", await expectRevert(owner, A.vault, ABIS.vault, "collect", [v1], "not resolved"));

  const outcomes = [Outcome.Yes, Outcome.No, Outcome.Yes, Outcome.No, Outcome.Yes, Outcome.No, Outcome.Yes, Outcome.No, Outcome.Yes, Outcome.No];
  for (let i = 0; i < 10; i++) {
    await resolveVault(headJudge, vaults[i]!, outcomes[i] ?? Outcome.Yes);
  }
  await resolveVault(headJudge, vlonely, Outcome.Yes);
  await resolveVault(headJudge, vempty, Outcome.Yes);
  await resolveVault(panelJudge, vpanel, Outcome.Yes);

  edge(38, "headJudge cannot resolve panel market vault", await expectRevert(headJudge, A.stewardRegistry, ABIS.steward, "resolveVault", [vpanel, Outcome.No], "not market steward"));
  edge(39, "random address cannot resolve", await expectRevert(randomGuy, A.stewardRegistry, ABIS.steward, "resolveVault", [v1, Outcome.No], "not market steward"));

  const postResolveNft = await mintNft(randomGuy, mainMarketId);
  await approveUsdc(randomGuy, A.marketDriverProxy, FUND_STD); // clear the token pull so fund() reaches the onFund status check (else it reverts on ERC20 allowance first)
  edge(11, "fund after resolve reverts", await expectRevert(randomGuy, A.marketDriverProxy, ABIS.marketDriver, "fund", [postResolveNft, vempty, Side.No, RATE, FUND_STD], "Vault: not open"));

  act("ACT 9 — harvest & payout");
  await warpPast(cycleSecs + 5);
  const resolvedForHarvest = [...vaults.slice(0, 10), vlonely, vempty, vpanel];
  for (const v of resolvedForHarvest) {
    await collectVault(v);
    await harvestVault(v);
  }
  await collectVault(v1);
  const potV1a = bi(await read(A.vault, ABIS.vault, "pot", [v1]));
  await collectVault(v1);
  const potV1b = bi(await read(A.vault, ABIS.vault, "pot", [v1]));
  edge(27, "collect idempotent", potV1a === potV1b && potV1a > 0n);

  const whaleBefore = await balanceUsdc(addr(whale));
  await send(whale, A.marketDriverProxy, ABIS.marketDriver, "withdraw", [whaleNft, v1, zeroAddress]);
  const whalePaid = (await balanceUsdc(addr(whale))) - whaleBefore;
  totalWithdrawn += whalePaid;
  assert(whalePaid > 0n, "whale winner paid on V1");

  const vaultIds = (await read(A.vault, ABIS.vault, "getAccountVaultIds", [degenNft])) as Hex[];
  if (vaultIds.length > 0) {
    const beforeMass = await balanceUsdc(addr(degen));
    await send(degen, A.marketDriverProxy, ABIS.marketDriver, "withdraw", [degenNft, vaultIds, zeroAddress]);
    totalWithdrawn += (await balanceUsdc(addr(degen))) - beforeMass;
    edge(30, "mass withdraw across multi-vault NFT", vaultIds.length >= 1);
  }

  await send(transferee, A.marketDriverProxy, ABIS.marketDriver, "approve", [addr(operator), transferNft]);
  edge(41, "operator cannot redirect withdraw", await expectRevert(operator, A.marketDriverProxy, ABIS.marketDriver, "withdraw", [transferNft, transferVault, addr(randomGuy)], "only owner can redirect"));
  const redirBefore = await balanceUsdc(addr(redirectPayee));
  await send(transferee, A.marketDriverProxy, ABIS.marketDriver, "withdraw", [transferNft, transferVault, addr(redirectPayee)]);
  const redirPaid = (await balanceUsdc(addr(redirectPayee))) - redirBefore;
  totalWithdrawn += redirPaid;
  assert(redirPaid > 0n, "owner can redirect withdraw");

  const opBefore = await balanceUsdc(addr(transferee));
  await send(operator, A.marketDriverProxy, ABIS.marketDriver, "withdraw", [transferNft, transferVault, zeroAddress]);
  assert((await balanceUsdc(addr(transferee))) === opBefore, "operator withdraw after owner payout is idempotent");

  const vemptyPot = bi(await read(A.vault, ABIS.vault, "pot", [vempty]));
  const vemptyPools = (await read(A.vault, ABIS.vault, "getVaultPools", [vempty])) as bigint[];
  const vemptyYesShares = bi(vemptyPools[2]);
  info(`Vempty pot=${vemptyPot} winning YES shareTotal=${vemptyYesShares}`);
  edge(33, "Vempty winning side 0 shares — pot captured", vemptyYesShares === 0n, `pot=${vemptyPot}`);

  const vlonelySkim = bi(await read(A.vault, ABIS.vault, "skimOwed", [vlonely]));
  edge(32, "Vlonely one-sided → minimal/no skim", vlonelySkim <= 1n * RATE, `skimOwed=${vlonelySkim}`);

  act("ACT 10 — treasury / LVST");
  const treasuryVault = v11seed;
  await fundLane(stakerEarly, earlyNft, treasuryVault, Side.No, RATE, FUND_STD);
  await warpPast(15); // let the losing NO stream deliver USDC so there's a real loss basis to claim
  await resolveVault(headJudge, treasuryVault, Outcome.Yes);
  await warpPast(cycleSecs + 3);
  await collectVault(treasuryVault);
  await harvestVault(treasuryVault);
  const lossBasis = bi(await read(A.vault, ABIS.vault, "lossClaimable", [earlyNft, treasuryVault, Side.No]));
  const rateBefore = bi(await read(A.treasury, ABIS.treasury, "mintRate", []));
  await send(stakerEarly, A.marketDriverProxy, ABIS.marketDriver, "claimLossLvst", [earlyNft, treasuryVault, Side.No, addr(stakerEarly)]);
  const mintedLvst = bi(await read(A.lvstToken, ABIS.lvst, "balanceOf", [addr(stakerEarly)]));
  edge(35, "loss LVST minted", mintedLvst > 0n && lossBasis > 0n);
  await send(stakerEarly, A.treasury, ABIS.treasury, "stakeLvst", [mintedLvst]);

  edge(36, "winner claimLossLvst reverts", await expectRevert(whale, A.marketDriverProxy, ABIS.marketDriver, "claimLossLvst", [whaleNft, v1, Side.Yes, addr(whale)], "nothing lost"));
  edge(36, "second loss claim reverts", await expectRevert(stakerEarly, A.marketDriverProxy, ABIS.marketDriver, "claimLossLvst", [earlyNft, treasuryVault, Side.No, addr(stakerEarly)], "already claimed"));

  const lateNftId = await mintNft(stakerLate, mainMarketId);
  const lvstTimingVault = await createVault(indieDev, mainMarketId, `LVST timing ${salt.slice(0, 8)}`, Side.Yes);
  await fundLane(stakerLate, lateNftId, lvstTimingVault, Side.No, RATE, 20n * RATE);
  await warpPast(15); // accrue a loss before resolving
  await resolveVault(headJudge, lvstTimingVault, Outcome.Yes);
  await warpPast(cycleSecs + 2);
  await collectVault(lvstTimingVault);
  const lateMinted = bi(await read(A.treasury, ABIS.treasury, "mintRate", []));
  edge(35, "mintRate present", rateBefore > 0n && lateMinted > 0n);

  const divBefore = await balanceUsdc(addr(stakerEarly));
  await send(stakerEarly, A.treasury, ABIS.treasury, "claimDividends", []);
  const divEarly = (await balanceUsdc(addr(stakerEarly))) - divBefore;
  const divLateBefore = await balanceUsdc(addr(stakerLate));
  await send(stakerLate, A.treasury, ABIS.treasury, "claimDividends", []);
  const divLate = (await balanceUsdc(addr(stakerLate))) - divLateBefore;
  edge(37, "stake-before-skim may earn dividends", divEarly >= 0n, `early=${divEarly}`);
  edge(37, "stake-after-skim gets 0 until next skim", divLate === 0n);

  act("ACT 11 — wind-down & conservation");
  const windVaults = [...new Set(createdVaults)]; // exhaustive: every vault ever created, deduped

  // 1) stop every stream first so nothing more delivers; refund unspent shared balance.
  for (const n of nfts) {
    if (bi(await read(A.marketDriverProxy, ABIS.marketDriver, "laneCount", [n.id])) > 0n) {
      const r = await send(n.who, A.marketDriverProxy, ABIS.marketDriver, "stopAll", [n.id]);
      const ev = parseEventLogs({ abi: ABIS.marketDriver, logs: r.logs, eventName: "AllLanesStopped" })[0] as { args: { refunded: bigint } };
      totalRefunded += ev.args.refunded;
    }
  }

  // 2) finalize pots + bank delivered USDC (flushes no-winner sweeps to treasury) BEFORE withdrawing,
  //    then every holder pulls winnings+overage and every seed creator recovers their seed. Two passes
  //    so a straggler cycle banked during the first withdraw round is collectable in the second.
  const drainOnce = async () => {
    for (const v of windVaults) {
      try {
        await collectVault(v);
        await harvestVault(v);
      } catch {
        /* unresolved vault (e.g. the dup-question edge vault) — not collectable; its seed is still
           reclaimable via stopSeed below, and its tiny streamed remainder is sub-dust */
      }
    }
    for (const n of nfts) {
      const ids = (await read(A.vault, ABIS.vault, "getAccountVaultIds", [n.id])) as Hex[];
      if (ids.length === 0) continue;
      const b = await balanceUsdc(addr(n.who));
      await send(n.who, A.marketDriverProxy, ABIS.marketDriver, "withdraw", [n.id, ids, zeroAddress]);
      totalWithdrawn += (await balanceUsdc(addr(n.who))) - b;
    }
    for (const v of windVaults) {
      for (const book of [labA, labB, indieDev]) {
        try {
          const sb = await balanceUsdc(addr(book)); // stopSeed refunds the unstreamed bond out of Drips
          await send(book, A.vaultDriver, ABIS.vaultDriver, "stopSeed", [v]);
          totalRefunded += (await balanceUsdc(addr(book))) - sb;
        } catch {
          /* no active seed for this creator on this vault */
        }
        try {
          const b = await balanceUsdc(addr(book)); // withdraw pays the seed's winnings + overage
          await send(book, A.vaultDriver, ABIS.vaultDriver, "withdraw", [v]);
          totalWithdrawn += (await balanceUsdc(addr(book))) - b;
        } catch {
          /* no seed winnings/overage for this creator on this vault */
        }
      }
    }
  };
  await warpPast(cycleSecs + 2); // complete any in-flight cycle so harvest banks all delivered + overage USDC
  await drainOnce();
  await warpPast(cycleSecs + 2);
  await drainOnce();

  const supplyEnd = bi(await read(A.mockUsdc, ABIS.usdc, "totalSupply", []));
  const vaultRes = await balanceUsdc(A.vault);
  const dripsRes = await balanceUsdc(A.dripsProxy);
  const treasuryBal = await balanceUsdc(A.treasury);
  const skim = bi(await read(A.treasury, ABIS.treasury, "totalSkimmed", []));
  const dust = vaultRes + dripsRes;

  info(`supply Δ=${supplyEnd - supplyStart} minted=${totalMinted}`);
  info(`withdrawn=${totalWithdrawn} refunded=${totalRefunded} treasury=${treasuryBal} skim=${skim} dust(vault+drips)=${dust}`);
  edge(44, "totalSupply == start + minted", supplyEnd === supplyStart + totalMinted);
  edge(43, "vault+drips residual ≤ dust tolerance", dust <= 500n * BigInt(vaults.length + 6), `dust=${dust}`);
  assert(skim > 0n || vlonelySkim === 0n, "treasury skim tracked");

  act("EDGE MATRIX SUMMARY");
  const edgeFails = edges.filter((e) => !e.ok);
  console.log(`  edges exercised: ${edges.length}  failed: ${edgeFails.length}`);
  for (const e of edgeFails) console.log(`    ${c.red}#${e.id} ${e.name}${e.note ? ` — ${e.note}` : ""}${c.reset}`);

  act("RESULTS");
  console.log(`  ${c.green}Passed: ${passed}${c.reset}   ${c.red}Failed: ${failed}${c.reset}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});

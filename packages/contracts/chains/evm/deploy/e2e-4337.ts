#!/usr/bin/env tsx
/**
 * LiveStreak ERC-4337 smoke e2e — @livestreak/wallet + local deploy snapshot.
 *
 * Prereqs:
 *   anvil --port 8545 --block-time 1
 *   cd packages/contracts && npm run deploy -- --name localhost --force
 *   cd host && npm run dev
 *
 * Run:
 *   cd packages/contracts && npm run e2e:4337
 *
 * Uses host bundler + paymaster proxies — does NOT spawn Alto itself.
 * Protocol e2e (`npm run e2e`) stays EOA-only; wire AA there later.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseUnits,
  sha256,
  toBytes,
  type Address,
  type Hex
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";
import { erc20Abi } from "viem";

import { WalletManagerEvmErc4337, type EvmErc4337WalletConfig } from "@livestreak/wallet";

const RPC = process.env.RPC ?? "http://127.0.0.1:8545";
const HOST_BASE = process.env.HOST_BASE ?? "http://127.0.0.1:8787";
const AA_CHAIN = process.env.AA_CHAIN ?? "local";
const BUNDLER_URL = process.env.BUNDLER_URL ?? `${HOST_BASE}/aa/bundler/${AA_CHAIN}`;
const PAYMASTER_URL = process.env.PAYMASTER_URL ?? `${HOST_BASE}/aa/paymaster/${AA_CHAIN}`;
const CHAIN_ID = 31337;
const DERIVATION_PATH = "0'/0/0";
const DEPLOYER_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;

const ROOT = resolve(import.meta.dirname, "..");
const SNAPSHOT = join(ROOT, "deployments/localhost.json");

const c = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  reset: "\x1b[0m"
};

type DeploySnapshot = {
  scopes: {
    aa?: { contracts?: Record<string, Address> };
    protocol?: { contracts?: Record<string, Address> };
    paymaster?: { contracts?: Record<string, Address> };
  };
};

const loadSnapshot = (): DeploySnapshot => JSON.parse(readFileSync(SNAPSHOT, "utf8")) as DeploySnapshot;

const short = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

let passed = 0;
let failed = 0;

const assert = (ok: boolean, msg: string) => {
  if (ok) {
    console.log(`  ${c.green}✓ ${msg}${c.reset}`);
    passed++;
  } else {
    console.log(`  ${c.red}✗ ${msg}${c.reset}`);
    failed++;
  }
};

const act = (title: string) => {
  console.log(`\n${"═".repeat(72)}\n  ${c.bold}${title}${c.reset}\n${"═".repeat(72)}`);
};

const buildWalletConfig = (
  aa: NonNullable<DeploySnapshot["scopes"]["aa"]>["contracts"],
  bundlerUrl: string,
  paymasterUrl: string
): EvmErc4337WalletConfig => ({
  chainId: CHAIN_ID,
  provider: RPC,
  bundlerUrl,
  entryPointAddress: aa!.entryPoint!,
  safeModulesVersion: "0.3.0",
  safe4337ModuleAddress: aa!.safe4337Module,
  safeModulesSetupAddress: aa!.safeModuleSetup,
  isSponsored: true,
  paymasterUrl,
  contractNetworks: {
    [String(CHAIN_ID)]: {
      safeSingletonAddress: aa!.safeSingleton!,
      safeProxyFactoryAddress: aa!.safeProxyFactory!,
      multiSendAddress: aa!.multiSend!,
      multiSendCallOnlyAddress: aa!.multiSendCallOnly!,
      fallbackHandlerAddress: aa!.fallbackHandler!,
      signMessageLibAddress: aa!.signMessageLib!,
      createCallAddress: aa!.createCall!,
      simulateTxAccessorAddress: aa!.simulateTxAccessor!
    }
  }
});

const waitUserOpReceipt = async (bundlerUrl: string, userOpHash: string) => {
  for (let i = 0; i < 60; i++) {
    const resp = await fetch(bundlerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getUserOperationReceipt",
        params: [userOpHash]
      })
    });
    const json = (await resp.json()) as { result?: { success?: boolean; receipt?: { transactionHash?: string } } };
    if (json.result) return json.result;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`UserOp ${userOpHash} not mined within timeout`);
};

async function main() {
  console.log(`\n${c.bold}LiveStreak ERC-4337 smoke — @livestreak/wallet${c.reset}`);

  const snap = loadSnapshot();
  const aa = snap.scopes.aa?.contracts;
  const mockUsdc = snap.scopes.protocol?.contracts?.mockUsdc;
  const paymaster = snap.scopes.paymaster?.contracts?.verifyingPaymaster;

  if (!aa?.entryPoint || !mockUsdc || !paymaster) {
    throw new Error(`Missing aa/protocol/paymaster in ${SNAPSHOT} — run deploy first`);
  }

  console.log(`  ${c.dim}bundler:${c.reset} ${BUNDLER_URL}`);
  console.log(`  ${c.dim}paymaster:${c.reset} ${PAYMASTER_URL}`);

  const transport = http(RPC);
  const pub = createPublicClient({ chain: anvil, transport });
  const deployer = createWalletClient({
    account: privateKeyToAccount(DEPLOYER_KEY),
    chain: anvil,
    transport
  });

  const mintAbi = [
    ...erc20Abi,
    {
      type: "function",
      name: "mint",
      inputs: [
        { name: "to", type: "address" },
        { name: "amount", type: "uint256" }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    }
  ] as const;

  const transferAbi = [
    {
      type: "function",
      name: "transfer",
      inputs: [
        { name: "to", type: "address" },
        { name: "amount", type: "uint256" }
      ],
      outputs: [{ type: "bool" }],
      stateMutability: "nonpayable"
    }
  ] as const;

  const config = buildWalletConfig(aa, BUNDLER_URL, PAYMASTER_URL);
  const seed = toBytes(sha256(toBytes("livestreak-aa-e2e-v1")));

  act("ACT 1 — Safe address determinism");
  const m1 = new WalletManagerEvmErc4337(seed, config);
  const a1 = await m1.getAccountByPath(DERIVATION_PATH);
  const addr1 = await a1.getAddress();
  assert(addr1.startsWith("0x") && addr1.length === 42, `predicted Safe ${short(addr1)}`);

  const m2 = new WalletManagerEvmErc4337(seed, config);
  const addr2 = await m2.getAccountByPath(DERIVATION_PATH).then((a) => a.getAddress());
  assert(addr1.toLowerCase() === addr2.toLowerCase(), "same seed → same Safe address");

  const altSeed = toBytes(sha256(toBytes("livestreak-aa-e2e-alt")));
  const addr3 = await new WalletManagerEvmErc4337(altSeed, config)
    .getAccountByPath(DERIVATION_PATH)
    .then((a) => a.getAddress());
  assert(addr1.toLowerCase() !== addr3.toLowerCase(), "different seed → different Safe");

  act("ACT 2 — sponsored UserOp (USDC transfer)");
  const safe = addr1 as Address;
  const safeEth = await pub.getBalance({ address: safe });
  assert(safeEth === 0n, "Safe starts with 0 ETH (paymaster sponsors gas)");

  const decimals = await pub.readContract({
    address: mockUsdc,
    abi: mintAbi,
    functionName: "decimals"
  });
  const mintAmount = parseUnits("100", decimals);
  const mintHash = await deployer.writeContract({
    address: mockUsdc,
    abi: mintAbi,
    functionName: "mint",
    args: [safe, mintAmount]
  });
  await pub.waitForTransactionReceipt({ hash: mintHash });

  const safeUsdcBefore = await pub.readContract({
    address: mockUsdc,
    abi: mintAbi,
    functionName: "balanceOf",
    args: [safe]
  });
  assert(safeUsdcBefore >= mintAmount, `Safe funded with ${safeUsdcBefore} USDC base units`);

  const recipient = privateKeyToAccount(generatePrivateKey()).address;
  const transferAmount = parseUnits("10", decimals);
  const data = encodeFunctionData({
    abi: transferAbi,
    functionName: "transfer",
    args: [recipient, transferAmount]
  });

  const txResult = await a1.sendTransaction({ to: mockUsdc, data, value: 0n });
  assert(typeof txResult.hash === "string" && txResult.hash.startsWith("0x"), "UserOp submitted");

  const receipt = await waitUserOpReceipt(BUNDLER_URL, txResult.hash);
  assert(receipt.success === true, "UserOp mined successfully");

  const recipientBal = await pub.readContract({
    address: mockUsdc,
    abi: mintAbi,
    functionName: "balanceOf",
    args: [recipient]
  });
  assert(recipientBal === transferAmount, "recipient received USDC");

  const safeUsdcAfter = await pub.readContract({
    address: mockUsdc,
    abi: mintAbi,
    functionName: "balanceOf",
    args: [safe]
  });
  assert(safeUsdcAfter === safeUsdcBefore - transferAmount, "Safe balance decreased");

  act("ACT 3 — sign message");
  const sig = await a1.sign("hello livestreak");
  assert(typeof sig === "string" && sig.startsWith("0x") && sig.length > 10, "valid signature");

  act("RESULTS");
  console.log(`\n  ${c.green}Passed: ${passed}${c.reset}   ${c.red}Failed: ${failed}${c.reset}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\n${c.red}FATAL:${c.reset}`, err);
  process.exit(1);
});

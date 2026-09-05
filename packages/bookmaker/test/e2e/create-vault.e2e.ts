#!/usr/bin/env tsx
/**
 * Bookmaker createVault on-chain proof — real AA wallet + bundler + paymaster.
 *
 * Prereqs:
 *   anvil --port 8545 --block-time 1
 *   cd packages/contracts && npm run deploy -- --name localhost --force
 *   cd host && npm run dev
 *
 * Run:
 *   cd packages/bookmaker && npm run e2e:chain
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  keccak256,
  parseEventLogs,
  parseUnits,
  sha256,
  toBytes,
  type Address,
  type Hex
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";
import { erc20Abi } from "viem";

import { marketRegistryAbi, vaultAbi } from "@livestreak/contracts/evm/abis";
import { createWalletManager, type EvmErc4337WalletConfig } from "@livestreak/wallet";

import { createBookmakerChain } from "../../src/chains/index.js";
import { parseVaultCreatedFromLogs } from "../../src/chains/evm/decode.js";

const RPC = process.env.RPC ?? "http://127.0.0.1:8545";
const HOST_BASE = process.env.HOST_BASE ?? "http://127.0.0.1:8787";
const AA_CHAIN = process.env.AA_CHAIN ?? "local";
const BUNDLER_URL = process.env.BUNDLER_URL ?? `${HOST_BASE}/aa/bundler/${AA_CHAIN}`;
const PAYMASTER_URL = process.env.PAYMASTER_URL ?? `${HOST_BASE}/aa/paymaster/${AA_CHAIN}`;
const CHAIN_ID = 31337;
const DEPLOYER_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;

const SNAPSHOT = resolve(
  import.meta.dirname,
  "../../../contracts/chains/evm/deployments/localhost.json"
);

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
    wire?: { contracts?: Record<string, Address> };
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

const computeMarketId = (observer: Address, streamId: Hex): Hex =>
  keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "bytes32" }],
      [observer, streamId]
    )
  );

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
    const json = (await resp.json()) as {
      result?: { success?: boolean; receipt?: { transactionHash?: Hex } };
    };
    if (json.result) return json.result;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`UserOp ${userOpHash} not mined within timeout`);
};

async function main() {
  console.log(`\n${c.bold}Bookmaker createVault — on-chain e2e${c.reset}`);

  const snap = loadSnapshot();
  const aa = snap.scopes.aa?.contracts;
  const protocol = snap.scopes.protocol?.contracts;
  const wire = snap.scopes.wire?.contracts;

  if (!aa?.entryPoint || !protocol?.mockUsdc || !protocol?.marketRegistry || !protocol?.vault || !wire?.vaultDriver) {
    throw new Error(`Missing contracts in ${SNAPSHOT} — run deploy first`);
  }

  console.log(`  ${c.dim}bundler:${c.reset} ${BUNDLER_URL}`);
  console.log(`  ${c.dim}paymaster:${c.reset} ${PAYMASTER_URL}`);
  console.log(`  ${c.dim}snapshot:${c.reset} ${SNAPSHOT}`);

  const transport = http(RPC);
  const pub = createPublicClient({ chain: anvil, transport });
  const deployer = createWalletClient({
    account: privateKeyToAccount(DEPLOYER_KEY),
    chain: anvil,
    transport
  });
  const deployerAddress = deployer.account.address;

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

  const seed = toBytes(sha256(toBytes("livestreak-bookmaker-e2e")));
  const config = buildWalletConfig(aa, BUNDLER_URL, PAYMASTER_URL);

  act("ACT 1 — bookmaker Safe address");
  const manager = createWalletManager("evm", seed, config);
  const safeAddress = (await manager.getAccount().then((a) => a.getAddress())) as Address;
  assert(safeAddress.startsWith("0x") && safeAddress.length === 42, `predicted Safe ${short(safeAddress)}`);

  act("ACT 2 — fund Safe with USDC");
  const decimals = await pub.readContract({
    address: protocol.mockUsdc,
    abi: mintAbi,
    functionName: "decimals"
  });
  const mintAmount = parseUnits("100", decimals);
  const mintHash = await deployer.writeContract({
    address: protocol.mockUsdc,
    abi: mintAbi,
    functionName: "mint",
    args: [safeAddress, mintAmount]
  });
  await pub.waitForTransactionReceipt({ hash: mintHash });

  const safeUsdc = await pub.readContract({
    address: protocol.mockUsdc,
    abi: mintAbi,
    functionName: "balanceOf",
    args: [safeAddress]
  });
  assert(safeUsdc >= mintAmount, `Safe funded with ${safeUsdc} USDC base units`);

  act("ACT 3 — register market on-chain");
  const streamId = keccak256(
    toBytes(`livestreak-bookmaker-e2e-stream-${Date.now()}`)
  );
  const expectedMarketId = computeMarketId(deployerAddress, streamId);

  const marketExistsBefore = await pub.readContract({
    address: protocol.marketRegistry,
    abi: marketRegistryAbi,
    functionName: "marketExists",
    args: [expectedMarketId]
  });

  if (marketExistsBefore === false) {
    const registerHash = await deployer.writeContract({
      address: protocol.marketRegistry,
      abi: marketRegistryAbi,
      functionName: "registerMarket",
      args: ["Bookmaker e2e market", streamId]
    });
    const registerReceipt = await pub.waitForTransactionReceipt({ hash: registerHash });

    const registered = parseEventLogs({
      abi: marketRegistryAbi,
      logs: registerReceipt.logs,
      eventName: "MarketRegistered"
    })[0] as { args: { marketId: Hex } } | undefined;

    assert(registered !== undefined, "MarketRegistered event emitted");
    assert(
      registered?.args.marketId.toLowerCase() === expectedMarketId.toLowerCase(),
      `marketId ${short(expectedMarketId)} matches computeMarketId(observer, streamId)`
    );
  } else {
    assert(true, `market ${short(expectedMarketId)} already registered — reusing`);
  }

  const marketExists = await pub.readContract({
    address: protocol.marketRegistry,
    abi: marketRegistryAbi,
    functionName: "marketExists",
    args: [expectedMarketId]
  });
  assert(marketExists === true, "marketExists is true before createVault");

  act("ACT 4 — createVault via bookmaker writer (approve + create UserOps)");
  const creatorStake = parseUnits("10", decimals);
  const seedRate = 8_333n;
  const question = `Will Team A score in the next 10 minutes? (${Date.now()})`;

  const chain = createBookmakerChain({
    walletInit: { chain: "evm", config },
    seed,
    addresses: {
      vaultDriver: wire.vaultDriver,
      marketRegistry: protocol.marketRegistry,
      vault: protocol.vault,
      usdc: protocol.mockUsdc
    },
    readRpcUrl: RPC
  });

  const result = await chain.writer.createVault({
    marketId: expectedMarketId,
    question,
    creatorSide: "yes",
    creatorStake,
    seedRate
  });

  assert(typeof result.txId === "string" && result.txId.startsWith("0x"), `UserOp hash ${short(result.txId)}`);
  assert(typeof result.vaultId === "string" && result.vaultId.length === 66, `vaultId ${short(result.vaultId)}`);

  act("ACT 5 — vaultId matches VaultCreated event and vaultExists on-chain");
  const userOpReceipt = await waitUserOpReceipt(BUNDLER_URL, result.txId);
  assert(userOpReceipt.success === true, "createVault UserOp mined successfully");

  const txHash = userOpReceipt.receipt?.transactionHash;
  assert(typeof txHash === "string" && txHash.startsWith("0x"), "UserOp receipt includes transactionHash");

  const createReceipt = await pub.waitForTransactionReceipt({ hash: txHash });
  const eventVaultId = parseVaultCreatedFromLogs(createReceipt.logs);
  assert(
    eventVaultId.toLowerCase() === result.vaultId.toLowerCase(),
    "returned vaultId equals VaultCreated event vaultId"
  );

  const vaultExists = await pub.readContract({
    address: protocol.vault,
    abi: vaultAbi,
    functionName: "vaultExists",
    args: [result.vaultId]
  });
  assert(vaultExists === true, "Vault.vaultExists(vaultId) is true");

  act("RESULTS");
  console.log(`\n  ${c.green}Passed: ${passed}${c.reset}   ${c.red}Failed: ${failed}${c.reset}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\n${c.red}FATAL:${c.reset}`, err);
  process.exit(1);
});

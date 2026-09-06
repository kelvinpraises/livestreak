#!/usr/bin/env tsx
/**
 * Publish LiveStreak Move package + bootstrap protocol wiring on Sui localnet.
 *
 * Prereqs:
 *   localnet — `sui start --with-faucet` and `sui client switch --env localnet`
 *   testnet  — funded `sui client` active key (or `SUI_SECRET_KEY`) on testnet
 * Run:     npm run deploy:sui -- --name localnet|testnet
 */

import { parseArgs } from "node:util";
import { Transaction } from "@mysten/sui/transactions";
import { MODULES, target } from "../package.js";
import type { SuiDeployOutput, SuiDeploymentName, SuiObjectIds } from "../types.js";
import {
  cliPublish,
  faucetForRpc,
  findCreatedId,
  findPublishedPackageId,
  getKeypair,
  makeClient,
  networkForDeployment,
  promoteDeployment,
  readState,
  requestGas,
  requireCreatedId,
  rpcForDeployment,
  writeState,
} from "./utils.js";

const { values } = parseArgs({
  options: {
    name: { type: "string", default: "localnet" },
    rpc: { type: "string" },
    force: { type: "boolean", default: false },
  },
});

const name = values.name as SuiDeploymentName;
const rpc = values.rpc ?? rpcForDeployment(name);
const network = networkForDeployment(name);
const force = values.force ?? false;

async function main(): Promise<void> {
  if (!force && readState(name)?.status === "completed") {
    console.log(`Deployment ${name} already completed — use --force to redeploy`);
    return;
  }

  console.log(`\n▶ Sui deploy (${name}) @ ${rpc}\n`);

  const client = makeClient(rpc, network);
  const keypair = getKeypair();
  const deployer = keypair.getPublicKey().toSuiAddress();
  await requestGas(client, deployer, faucetForRpc(rpc));

  const { packageId, objectChanges: publishChanges } = cliPublish(network === "testnet" ? "testnet" : "localnet", force);
  const coinType = `${packageId}::mock_usdc::MOCK_USDC`;

  const driverRegistry = requireCreatedId(publishChanges, "driver_registry::DriverRegistry", packageId);
  const marketDriverRegistry = requireCreatedId(publishChanges, "market_driver::MarketDriverRegistry", packageId);
  const usdcMintCap = requireCreatedId(publishChanges, "mock_usdc::MintCap", packageId);
  const lvstTreasuryCap = requireCreatedId(publishChanges, "lvst::LvstTreasuryCap", packageId);

  console.log(`  packageId          ${packageId}`);
  console.log(`  driverRegistry     ${driverRegistry}`);
  console.log(`  marketDriverRegistry ${marketDriverRegistry}`);

  const createTx = new Transaction();
  createTx.setGasBudget(500_000_000);
  createTx.moveCall({
    target: target(packageId, MODULES.protocol, "create"),
    arguments: [createTx.pure.address(deployer)],
  });
  createTx.moveCall({ target: target(packageId, MODULES.marketRegistry, "create_registry"), arguments: [] });
  createTx.moveCall({
    target: target(packageId, MODULES.vault, "create_registry"),
    typeArguments: [coinType],
    arguments: [],
  });
  createTx.moveCall({
    target: target(packageId, MODULES.stewardRegistry, "create"),
    arguments: [createTx.pure.address(deployer)],
  });
  createTx.moveCall({
    target: target(packageId, MODULES.treasury, "create_registry"),
    typeArguments: [coinType],
    arguments: [],
  });
  createTx.moveCall({
    target: target(packageId, MODULES.drips, "create_drips_registry"),
    typeArguments: [coinType],
    arguments: [],
  });
  createTx.moveCall({ target: target(packageId, MODULES.vaultDriver, "create_registry"), arguments: [] });

  const createResult = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: createTx,
    options: { showEffects: true, showObjectChanges: true },
  });
  if (createResult.effects?.status?.status !== "success") {
    throw new Error(`Bootstrap create failed: ${createResult.effects?.status?.error}`);
  }
  await client.waitForTransaction({ digest: createResult.digest });
  const createChanges = createResult.objectChanges ?? [];

  const protocol = requireCreatedId(createChanges, "protocol::Protocol", packageId);
  const marketRegistry = requireCreatedId(createChanges, "market_registry::MarketRegistry", packageId);
  const vaultRegistry = requireCreatedId(createChanges, "vault::VaultRegistry", packageId);
  const stewardRegistry = requireCreatedId(createChanges, "steward_registry::StewardRegistry", packageId);
  const treasuryRegistry = requireCreatedId(createChanges, "treasury::TreasuryRegistry", packageId);
  const dripsRegistry = requireCreatedId(createChanges, "drips::DripsRegistry", packageId);
  const vaultDriverRegistry = requireCreatedId(createChanges, "vault_driver::VaultDriverRegistry", packageId);
  const streamsRegistry = requireCreatedId(createChanges, "streams::StreamsRegistry", packageId);

  const wireTx = new Transaction();
  wireTx.setGasBudget(200_000_000);
  wireTx.moveCall({
    target: target(packageId, MODULES.bootstrap, "wire_core"),
    typeArguments: [coinType],
    arguments: [
      wireTx.object(protocol),
      wireTx.object(vaultRegistry),
      wireTx.object(treasuryRegistry),
      wireTx.object(marketRegistry),
      wireTx.object(dripsRegistry),
      wireTx.object(streamsRegistry),
      wireTx.object(vaultDriverRegistry),
      wireTx.object(marketDriverRegistry),
      wireTx.object(stewardRegistry),
      wireTx.object(driverRegistry),
      wireTx.pure.address(deployer),
    ],
  });

  const wireResult = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: wireTx,
    options: { showEffects: true },
  });
  if (wireResult.effects?.status?.status !== "success") {
    throw new Error(`Bootstrap wire failed: ${wireResult.effects?.status?.error}`);
  }

  const objects: SuiObjectIds = {
    packageId,
    protocol,
    marketRegistry,
    vaultRegistry,
    stewardRegistry,
    treasuryRegistry,
    dripsRegistry,
    streamsRegistry,
    vaultDriverRegistry,
    marketDriverRegistry,
    driverRegistry,
    lvstTreasuryCap,
    usdcMintCap,
  };

  const state: SuiDeployOutput = {
    chain: name,
    rpc,
    deployedAt: new Date().toISOString(),
    deployer,
    packageId,
    objects,
    status: "completed",
  };

  writeState(name, state);
  promoteDeployment(name, state);

  console.log(`\n✓ Deployed ${name}`);
  console.log(`  snapshot → chains/sui/deployments/${name}.json\n`);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});

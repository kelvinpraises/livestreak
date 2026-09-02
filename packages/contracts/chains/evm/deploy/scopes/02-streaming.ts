import type { Address, PublicClient, WalletClient } from "viem";
import { deployFromArtifact, type ScopeResult } from "../utils.js";

const LABEL = "livestreak";
const CYCLE_SECS = 10;

export async function deployStreaming(
  client: PublicClient,
  walletClient: WalletClient,
  _previousScopes: Record<string, ScopeResult>,
  config: { chain: string; rpc: string; deployer: Address }
): Promise<ScopeResult> {
  const { deployer } = config;
  console.log("Deploying mined Drips streaming core...");

  try {
    const deployedAt = new Date().toISOString();

    // 1. DripsStreaming logic — constructor: (cycleSecs)
    console.log(`  Deploying DripsStreaming (cycleSecs=${CYCLE_SECS})...`);
    const dripsStreaming = await deployFromArtifact(
      walletClient,
      client,
      "out/DripsStreaming.sol/DripsStreaming.json",
      [CYCLE_SECS],
      undefined,
      `${LABEL}.dripsStreaming`
    );

    // 2. ManagedProxy over DripsStreaming — constructor: (logic, admin, "0x")
    console.log("  Deploying ManagedProxy (Drips)...");
    const dripsProxy = await deployFromArtifact(
      walletClient,
      client,
      "out/Managed.sol/ManagedProxy.json",
      [dripsStreaming, deployer, "0x"],
      undefined,
      `${LABEL}.dripsProxy`
    );
    console.log(`    dripsProxy → ${dripsProxy}`);

    // 3. Caller — ERC-2771 forwarder, no constructor args
    console.log("  Deploying Caller...");
    const caller = await deployFromArtifact(
      walletClient,
      client,
      "out/Caller.sol/Caller.json",
      undefined,
      undefined,
      `${LABEL}.caller`
    );

    // Drivers are wired in the `wire` scope: the vault-aware AddressDriver needs the Vault address
    // (deployed in `protocol`), and the Vault must register as the receiver driver first.
    console.log("  Streaming core deployed.");

    return {
      status: "completed",
      deployedAt,
      contracts: { dripsStreaming, dripsProxy, caller }
    };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

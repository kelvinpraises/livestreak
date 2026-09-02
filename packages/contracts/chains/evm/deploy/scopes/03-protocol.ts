import type { Address, PublicClient, WalletClient } from "viem";
import { deployFromArtifact, type ScopeResult } from "../utils.js";

const LABEL = "livestreak";

export async function deployProtocol(
  client: PublicClient,
  walletClient: WalletClient,
  _previousScopes: Record<string, ScopeResult>,
  config: { chain: string; rpc: string; deployer: Address }
): Promise<ScopeResult> {
  console.log("Deploying LiveStreak protocol contracts...");
  const { deployer } = config;

  try {
    const protocol = await deployFromArtifact(
      walletClient,
      client,
      "out/Protocol.sol/Protocol.json",
      [deployer],
      undefined,
      `${LABEL}.protocol`
    );

    const marketRegistry = await deployFromArtifact(
      walletClient,
      client,
      "out/MarketRegistry.sol/MarketRegistry.json",
      [deployer, protocol],
      undefined,
      `${LABEL}.marketRegistry`
    );

    const vault = await deployFromArtifact(
      walletClient,
      client,
      "out/Vault.sol/Vault.json",
      [protocol],
      undefined,
      `${LABEL}.vault`
    );

    const mockUsdc = await deployFromArtifact(
      walletClient,
      client,
      "out/MockUSDC.sol/MockUSDC.json",
      undefined,
      undefined,
      `${LABEL}.mockUsdc`
    );

    const lvstToken = await deployFromArtifact(
      walletClient,
      client,
      "out/LvstToken.sol/LvstToken.json",
      [protocol],
      undefined,
      `${LABEL}.lvstToken`
    );

    const treasury = await deployFromArtifact(
      walletClient,
      client,
      "out/Treasury.sol/Treasury.json",
      [deployer, mockUsdc, protocol],
      undefined,
      `${LABEL}.treasury`
    );

    const stewardRegistry = await deployFromArtifact(
      walletClient,
      client,
      "out/StewardRegistry.sol/StewardRegistry.json",
      [deployer, protocol],
      undefined,
      `${LABEL}.stewardRegistry`
    );

    return {
      status: "completed",
      deployedAt: new Date().toISOString(),
      contracts: {
        protocol,
        marketRegistry,
        vault,
        mockUsdc,
        lvstToken,
        treasury,
        stewardRegistry
      }
    };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

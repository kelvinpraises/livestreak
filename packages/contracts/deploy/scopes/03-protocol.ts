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
    const bookmakerRegistry = await deployFromArtifact(
      walletClient,
      client,
      "out/BookmakerRegistry.sol/BookmakerRegistry.json",
      [deployer],
      undefined,
      `${LABEL}.bookmakerRegistry`
    );

    const marketRegistry = await deployFromArtifact(
      walletClient,
      client,
      "out/MarketRegistry.sol/MarketRegistry.json",
      [deployer],
      undefined,
      `${LABEL}.marketRegistry`
    );

    const vault = await deployFromArtifact(
      walletClient,
      client,
      "out/Vault.sol/Vault.json",
      undefined,
      undefined,
      `${LABEL}.vault`
    );

    const vaultFactory = await deployFromArtifact(
      walletClient,
      client,
      "out/VaultFactory.sol/VaultFactory.json",
      [bookmakerRegistry, marketRegistry, vault],
      undefined,
      `${LABEL}.vaultFactory`
    );

    // Local USDC for the funding rail. On a real chain, swap this for the canonical USDC address.
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
      [deployer, mockUsdc],
      undefined,
      `${LABEL}.lvstToken`
    );

    const stewardRegistry = await deployFromArtifact(
      walletClient,
      client,
      "out/StewardRegistry.sol/StewardRegistry.json",
      [deployer],
      undefined,
      `${LABEL}.stewardRegistry`
    );

    return {
      status: "completed",
      deployedAt: new Date().toISOString(),
      contracts: {
        bookmakerRegistry,
        marketRegistry,
        vault,
        vaultFactory,
        mockUsdc,
        lvstToken,
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

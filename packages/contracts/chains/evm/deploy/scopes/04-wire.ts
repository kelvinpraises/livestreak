import type { Abi, Address, PublicClient, WalletClient } from "viem";
import { readFileSync } from "fs";
import { join, resolve } from "path";
import { deployFromArtifact, type ScopeResult } from "../utils.js";

const LABEL = "livestreak";
const CONTRACTS_ROOT = resolve(import.meta.dirname, "../..");

const loadAbi = (artifactPath: string): Abi =>
  JSON.parse(readFileSync(join(CONTRACTS_ROOT, artifactPath), "utf-8")).abi;

export async function deployWire(
  client: PublicClient,
  walletClient: WalletClient,
  previousScopes: Record<string, ScopeResult>,
  config: { chain: string; rpc: string; deployer: Address }
): Promise<ScopeResult> {
  console.log("Wiring protocol + streaming...");

  const streaming = previousScopes.streaming;
  const protocolScope = previousScopes.protocol;
  if (streaming?.status !== "completed" || !streaming.contracts) {
    return { status: "failed", error: "Streaming scope not completed" };
  }
  if (protocolScope?.status !== "completed" || !protocolScope.contracts) {
    return { status: "failed", error: "Protocol scope not completed" };
  }

  const { dripsProxy, caller } = streaming.contracts as Record<string, Address>;
  const { protocol, vault, marketRegistry, mockUsdc, stewardRegistry, lvstToken, treasury } =
    protocolScope.contracts as Record<string, Address>;
  const { deployer } = config;

  try {
    const protocolAbi = loadAbi("out/Protocol.sol/Protocol.json");
    const vaultAbi = loadAbi("out/Vault.sol/Vault.json");
    const vaultDriverAbi = loadAbi("out/VaultDriver.sol/VaultDriver.json");
    const dripsAbi = loadAbi("out/IDrips.sol/IDrips.json");
    const stewardAbi = loadAbi("out/StewardRegistry.sol/StewardRegistry.json");

    const write = async (address: Address, abi: Abi, functionName: string, args: readonly unknown[]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hash = await walletClient.writeContract({ address, abi, functionName, args } as any);
      await client.waitForTransactionReceipt({ hash });
    };

    await write(protocol, protocolAbi, "setMarketRegistry", [marketRegistry]);
    await write(protocol, protocolAbi, "setVault", [vault]);
    await write(protocol, protocolAbi, "setStewardRegistry", [stewardRegistry]);
    await write(protocol, protocolAbi, "setLvstToken", [lvstToken]);
    await write(protocol, protocolAbi, "setTreasury", [treasury]);
    await write(protocol, protocolAbi, "setDripsStreaming", [dripsProxy]);

    const vaultDriver = await deployFromArtifact(
      walletClient,
      client,
      "out/VaultDriver.sol/VaultDriver.json",
      [protocol, dripsProxy, caller, mockUsdc],
      undefined,
      `${LABEL}.vaultDriver`
    );
    await write(vaultDriver, vaultDriverAbi, "bootstrapStreaming", []);
    await write(protocol, protocolAbi, "setVaultDriver", [vaultDriver]);

    const driverId = Number(
      await client.readContract({ address: dripsProxy, abi: dripsAbi, functionName: "nextDriverId" })
    );
    console.log(`  Registering MarketDriver slot (FD_user=${driverId})...`);
    await write(dripsProxy, dripsAbi, "registerDriver", [deployer]);

    const marketDriverLogic = await deployFromArtifact(
      walletClient,
      client,
      "out/MarketDriver.sol/MarketDriver.json",
      [dripsProxy, caller, driverId, protocol, vault, vaultDriver, mockUsdc],
      undefined,
      `${LABEL}.marketDriverLogic`
    );
    const marketDriverProxy = await deployFromArtifact(
      walletClient,
      client,
      "out/Managed.sol/ManagedProxy.json",
      [marketDriverLogic, deployer, "0x"],
      undefined,
      `${LABEL}.marketDriverProxy`
    );
    await write(dripsProxy, dripsAbi, "updateDriverAddress", [driverId, marketDriverProxy]);
    await write(protocol, protocolAbi, "setMarketDriver", [marketDriverProxy]);
    console.log(`    marketDriverProxy → ${marketDriverProxy}`);

    await write(vault, vaultAbi, "syncFromProtocol", []);
    console.log(`    vault synced from Protocol`);

        await write(stewardRegistry, stewardAbi, "registerSteward", [deployer]);
        await write(stewardRegistry, stewardAbi, "setDefaultSteward", [deployer]);
        console.log(`    resolver → stewardRegistry ${stewardRegistry}`);

    console.log("  Protocol + streaming wired.");

    return {
      status: "completed",
      deployedAt: new Date().toISOString(),
      contracts: { vaultDriver, marketDriverLogic, marketDriverProxy }
    };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

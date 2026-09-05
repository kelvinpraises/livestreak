import type { Abi, Address, PublicClient, WalletClient } from "viem";
import { zeroAddress } from "viem";
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

    const readProtocol = async (functionName: string) =>
      (await client.readContract({ address: protocol, abi: protocolAbi, functionName })) as Address;

    const alreadyWired = (await readProtocol("marketRegistry")) !== zeroAddress;

    if (alreadyWired) {
      console.log("  Protocol already wired — reusing on-chain addresses");
    } else {
      await write(protocol, protocolAbi, "setDripsStreaming", [dripsProxy]);
    }

    const vaultDriver = alreadyWired
      ? await readProtocol("vaultDriver")
      : await deployFromArtifact(
          walletClient,
          client,
          "out/VaultDriver.sol/VaultDriver.json",
          [protocol, dripsProxy, caller, mockUsdc],
          undefined,
          `${LABEL}.vaultDriver`
        );

    const vaultDriverId = (await client.readContract({
      address: vaultDriver,
      abi: vaultDriverAbi,
      functionName: "driverId"
    })) as number;

    if (vaultDriverId === 0) {
      await write(vaultDriver, vaultDriverAbi, "bootstrapStreaming", []);
    }

    if (!alreadyWired) {
      await write(protocol, protocolAbi, "setVaultDriver", [vaultDriver]);
    }

    let marketDriverProxy: Address;
    let marketDriverLogic: Address;
    if (alreadyWired) {
      marketDriverProxy = await readProtocol("marketDriver");
      const priorLogic = previousScopes.wire?.contracts?.marketDriverLogic as Address | undefined;
      // Read the real driverId from the on-chain proxy instead of hardcoding `1`: if driver
      // registration order ever changes, a literal would silently mis-wire the redeployed logic.
      const marketDriverAbi = loadAbi("out/MarketDriver.sol/MarketDriver.json");
      const driverId = Number(
        await client.readContract({ address: marketDriverProxy, abi: marketDriverAbi, functionName: "DRIVER_ID" })
      );
      marketDriverLogic =
        priorLogic ??
        ((await deployFromArtifact(
          walletClient,
          client,
          "out/MarketDriver.sol/MarketDriver.json",
          [dripsProxy, caller, driverId, protocol, vault, vaultDriver, mockUsdc],
          undefined,
          `${LABEL}.marketDriverLogic`
        )) as Address);
      console.log(`    marketDriverProxy → ${marketDriverProxy}`);
    } else {
      const driverId = Number(
        await client.readContract({ address: dripsProxy, abi: dripsAbi, functionName: "nextDriverId" })
      );
      console.log(`  Registering MarketDriver slot (FD_user=${driverId})...`);
      await write(dripsProxy, dripsAbi, "registerDriver", [deployer]);

      const marketDriverLogicDeployed = await deployFromArtifact(
        walletClient,
        client,
        "out/MarketDriver.sol/MarketDriver.json",
        [dripsProxy, caller, driverId, protocol, vault, vaultDriver, mockUsdc],
        undefined,
        `${LABEL}.marketDriverLogic`
      );
      marketDriverLogic = marketDriverLogicDeployed;
      marketDriverProxy = await deployFromArtifact(
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

      await write(protocol, protocolAbi, "setMarketRegistry", [marketRegistry]);
      await write(protocol, protocolAbi, "setVault", [vault]);
      await write(protocol, protocolAbi, "setStewardRegistry", [stewardRegistry]);
      await write(protocol, protocolAbi, "setLvstToken", [lvstToken]);
      await write(protocol, protocolAbi, "setTreasury", [treasury]);
    }

    const vaultSynced = ((await client.readContract({
      address: vault,
      abi: vaultAbi,
      functionName: "marketDriver"
    })) as Address) !== zeroAddress;

    if (!vaultSynced) {
      await write(vault, vaultAbi, "syncFromProtocol", []);
      console.log(`    vault synced from Protocol`);
    } else {
      console.log(`    vault already synced`);
    }

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
    const prior = previousScopes.wire;
    if (prior?.status === "completed" && prior.contracts) {
      console.warn(`  Wire step failed on already-wired chain — keeping prior wire addresses: ${error instanceof Error ? error.message : String(error)}`);
      return { ...prior, deployedAt: new Date().toISOString() };
    }
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

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
  const protocol = previousScopes.protocol;
  if (streaming?.status !== "completed" || !streaming.contracts) {
    return { status: "failed", error: "Streaming scope not completed" };
  }
  if (protocol?.status !== "completed" || !protocol.contracts) {
    return { status: "failed", error: "Protocol scope not completed" };
  }

  const { dripsProxy, caller } = streaming.contracts as Record<string, Address>;
  const { vault, vaultFactory, marketRegistry, mockUsdc, stewardRegistry, lvstToken } =
    protocol.contracts as Record<string, Address>;
  const { deployer } = config;

  try {
    const vaultAbi = loadAbi("out/Vault.sol/Vault.json");
    const marketAbi = loadAbi("out/MarketRegistry.sol/MarketRegistry.json");
    const dripsAbi = loadAbi("out/IDrips.sol/IDrips.json");
    const stewardAbi = loadAbi("out/StewardRegistry.sol/StewardRegistry.json");
    const lvstAbi = loadAbi("out/LvstToken.sol/LvstToken.json");

    const write = async (address: Address, abi: Abi, functionName: string, args: readonly unknown[]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hash = await walletClient.writeContract({ address, abi, functionName, args } as any);
      await client.waitForTransactionReceipt({ hash });
    };

    // 1. Factory wiring.
    await write(vault, vaultAbi, "setFactory", [vaultFactory]);
    await write(marketRegistry, marketAbi, "setVaultFactory", [vaultFactory]);

    // 2. Vault registers itself as the Drips receiver driver (FD_vault) for its (vault, side) accounts.
    await write(vault, vaultAbi, "setStreaming", [dripsProxy, mockUsdc]);

    // 3. Reserve the user driver slot (FD_user), then deploy the vault-aware AddressDriver behind a
    //    ManagedProxy and point the slot at it.
    const driverId = Number(
      await client.readContract({ address: dripsProxy, abi: dripsAbi, functionName: "nextDriverId" })
    );
    console.log(`  Registering AddressDriver slot (FD_user=${driverId})...`);
    await write(dripsProxy, dripsAbi, "registerDriver", [deployer]);

    const addressDriverLogic = await deployFromArtifact(
      walletClient,
      client,
      "out/AddressDriver.sol/AddressDriver.json",
      [dripsProxy, caller, driverId, vault, mockUsdc],
      undefined,
      `${LABEL}.addressDriverLogic`
    );
    const addressDriverProxy = await deployFromArtifact(
      walletClient,
      client,
      "out/Managed.sol/ManagedProxy.json",
      [addressDriverLogic, deployer, "0x"],
      undefined,
      `${LABEL}.addressDriverProxy`
    );
    await write(dripsProxy, dripsAbi, "updateDriverAddress", [driverId, addressDriverProxy]);

    // 4. Tell the Vault which driver may fund it.
    await write(vault, vaultAbi, "setFundingDriver", [addressDriverProxy]);
    console.log(`    addressDriverProxy → ${addressDriverProxy}`);

    // 5. Steward path is the Vault's resolver: registry ↔ vault, and the deployer is the first steward.
    await write(stewardRegistry, stewardAbi, "setVault", [vault]);
    await write(vault, vaultAbi, "setResolver", [stewardRegistry]);
    await write(stewardRegistry, stewardAbi, "registerSteward", [deployer]);
    console.log(`    resolver → stewardRegistry ${stewardRegistry}`);

    // 6. Wire the LVST house pot: the Vault skims the bounty into it at resolution; it reads each
    //    funder's loss basis back from the Vault. skimBps defaults to 200 (2%) on LvstToken.
    await write(vault, vaultAbi, "setLvstToken", [lvstToken]);
    await write(lvstToken, lvstAbi, "setVault", [vault]);
    console.log(`    lvstToken <-> vault wired (skim -> house pot)`);

    console.log("  Protocol + streaming wired.");

    return {
      status: "completed",
      deployedAt: new Date().toISOString(),
      contracts: { addressDriverLogic, addressDriverProxy }
    };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

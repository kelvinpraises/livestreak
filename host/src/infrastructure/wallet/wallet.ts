import type { Hex } from "viem";
import type { AaChainConfig } from "../../services/aa/chains.js";
import type { HostServerConfig } from "../../config/host.js";
import { createWalletManager } from "@livestreak/wallet";
import { encodeSuiPrivateKey } from "@mysten/sui/cryptography";

// --- exports ---

export const resolveHostWalletSeed = (
  config: Pick<HostServerConfig, "walletSeed" | "memoryOwnerSeed">
): string | null => config.walletSeed ?? config.memoryOwnerSeed;

export const resolveEvmExecutorPrivateKey = async (
  config: Pick<HostServerConfig, "walletSeed" | "memoryOwnerSeed">,
  chain: Pick<AaChainConfig, "chainId" | "rpcUrl" | "entryPoint" | "bundlerUrl">
): Promise<Hex | null> => {
  const seed = resolveHostWalletSeed(config);
  if (seed === null || chain.rpcUrl === undefined) {
    return null;
  }

  const manager = createWalletManager("evm", seed, {
    chainId: chain.chainId,
    provider: chain.rpcUrl,
    bundlerUrl: chain.bundlerUrl ?? "http://127.0.0.1:4337",
    entryPointAddress: chain.entryPoint,
    safeModulesVersion: "0.3.0",
    useNativeCoins: true
  });
  const account = await manager.getAccount(0);
  const raw = account.keyPair.privateKey;
  if (raw === null) {
    return null;
  }

  return (`0x${Buffer.from(raw).toString("hex")}`) as Hex;
};

export const resolveMemoryOwnerSuiPrivateKey = async (
  config: Pick<HostServerConfig, "memorySuiOwnerPrivateKey" | "walletSeed" | "memoryOwnerSeed">,
  suiRpcUrl: string
): Promise<string | null> => {
  if (config.memorySuiOwnerPrivateKey !== null) {
    return config.memorySuiOwnerPrivateKey;
  }

  const seed = resolveHostWalletSeed(config);
  if (seed === null) {
    return null;
  }

  const manager = createWalletManager("sui", seed, { rpcUrl: suiRpcUrl });
  const account = await manager.getAccount(0);
  const privateKey = account.keyPair.privateKey;

  if (privateKey === null) {
    throw new Error("memory_owner_key_unavailable");
  }

  return encodeSuiPrivateKey(privateKey, "ED25519");
};

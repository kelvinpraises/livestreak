import { LiveStreakConfigError } from "@livestreak/core";
import { createWalletManager } from "@livestreak/wallet";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import type { HostServerConfig } from "../../config/host.js";
import { resolveHostWalletSeed } from "./index.js";

// --- exports ---

export interface SuiSponsorWallet {
  readonly address: string;
  readonly keypair: Ed25519Keypair;
}

export const resolveSuiSponsorSeed = (
  config: Pick<HostServerConfig, "walletSeed" | "memoryOwnerSeed"> = {
    walletSeed: null,
    memoryOwnerSeed: null
  }
): string | null =>
  readOptionalEnv("LIVESTREAK_SUI_SPONSOR_SEED") ??
  readOptionalEnv("LIVESTREAK_SUI_SPONSOR_MNEMONIC") ??
  resolveHostWalletSeed(config);

export const resolveSuiSponsorRpcUrl = (): string | null =>
  readOptionalEnv("LIVESTREAK_SUI_RPC_URL") ?? readOptionalEnv("SUI_RPC");

export const resolveSuiSponsorWallet = async (
  config: Pick<HostServerConfig, "walletSeed" | "memoryOwnerSeed"> = {
    walletSeed: null,
    memoryOwnerSeed: null
  }
): Promise<SuiSponsorWallet> => {
  const seed = resolveSuiSponsorSeed(config);
  if (seed === null) {
    throw new LiveStreakConfigError({
      message: "sui_sponsor_not_configured: set LIVESTREAK_SUI_SPONSOR_SEED or LIVESTREAK_WALLET_SEED",
      metadata: { retryable: false }
    });
  }

  const rpcUrl = resolveSuiSponsorRpcUrl();
  if (rpcUrl === null) {
    throw new LiveStreakConfigError({
      message: "sui_rpc_not_configured: set LIVESTREAK_SUI_RPC_URL or SUI_RPC",
      metadata: { retryable: false }
    });
  }

  const manager = createWalletManager("sui", seed, { rpcUrl });
  const account = await manager.getAccount(0);
  const privateKey = account.keyPair.privateKey;
  if (privateKey === null) {
    throw new LiveStreakConfigError({
      message: "sui_sponsor_private_key_unavailable",
      metadata: { retryable: false }
    });
  }

  const keypair = Ed25519Keypair.fromSecretKey(privateKey);
  return {
    address: await account.getAddress(),
    keypair
  };
};

export const resolveSuiOwnerPrivateKey = async (
  config: Pick<HostServerConfig, "memorySuiOwnerPrivateKey" | "memoryOwnerSeed" | "walletSeed"> = {
    memorySuiOwnerPrivateKey: null,
    memoryOwnerSeed: null,
    walletSeed: null
  }
): Promise<string> => {
  if (config.memorySuiOwnerPrivateKey !== null) {
    return config.memorySuiOwnerPrivateKey;
  }

  const seed = config.memoryOwnerSeed ?? resolveHostWalletSeed(config);
  if (seed === null) {
    throw new LiveStreakConfigError({
      message: "sui_memory_owner_not_configured",
      metadata: { retryable: false }
    });
  }

  const rpcUrl = resolveSuiSponsorRpcUrl() ?? "https://fullnode.mainnet.sui.io:443";
  const manager = createWalletManager("sui", seed, { rpcUrl });
  const account = await manager.getAccount(0);
  const privateKey = account.keyPair.privateKey;
  if (privateKey === null) {
    throw new LiveStreakConfigError({
      message: "sui_memory_owner_private_key_unavailable",
      metadata: { retryable: false }
    });
  }

  return Buffer.from(privateKey).toString("hex");
};

// --- helpers ---

const readOptionalEnv = (name: string): string | null => {
  const value = process.env[name];
  return value === undefined || value.length === 0 ? null : value;
};

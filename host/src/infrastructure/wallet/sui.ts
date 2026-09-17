import { LiveStreakConfigError } from "@livestreak/core";
import { createWalletManager } from "@livestreak/wallet";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { readOptionalEnv } from "../../config/env.js";
import type { HostServerConfig } from "../../config/host.js";
import { resolveHostWalletSeed } from "./index.js";

// --- exports ---

export interface SuiSponsorWallet {
  readonly address: string;
  readonly keypair: Ed25519Keypair;
}

export const resolveSuiSponsorSeed = (
  config: Pick<HostServerConfig, "walletSeed"> = { walletSeed: null }
): string | null =>
  readOptionalEnv("LIVESTREAK_SUI_SPONSOR_SEED") ??
  readOptionalEnv("LIVESTREAK_SUI_SPONSOR_MNEMONIC") ??
  resolveHostWalletSeed(config);

export const resolveSuiSponsorRpcUrl = (): string | null =>
  readOptionalEnv("LIVESTREAK_SUI_RPC_URL");

export const resolveSuiSponsorWallet = async (
  config: Pick<HostServerConfig, "walletSeed"> = { walletSeed: null }
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
  config: { readonly privateKey: string | null; readonly seed: string | null } = {
    privateKey: null,
    seed: null
  }
): Promise<string> => {
  if (config.privateKey !== null) {
    return config.privateKey;
  }

  const seed = config.seed;
  if (seed === null) {
    throw new LiveStreakConfigError({
      message: "sui_owner_not_configured",
      metadata: { retryable: false }
    });
  }

  const rpcUrl = resolveSuiSponsorRpcUrl() ?? "https://fullnode.mainnet.sui.io:443";
  const manager = createWalletManager("sui", seed, { rpcUrl });
  const account = await manager.getAccount(0);
  const privateKey = account.keyPair.privateKey;
  if (privateKey === null) {
    throw new LiveStreakConfigError({
      message: "sui_owner_private_key_unavailable",
      metadata: { retryable: false }
    });
  }

  // Sui signers expect a bech32-encoded private key (suiprivkey1...), not raw hex —
  // encode the seed-derived secret so both paths yield a signable key.
  return Ed25519Keypair.fromSecretKey(privateKey).getSecretKey();
};


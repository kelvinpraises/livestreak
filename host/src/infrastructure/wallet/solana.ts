import { LiveStreakConfigError } from "@livestreak/core";
import { createWalletManager } from "@livestreak/wallet";
import { readOptionalEnv } from "../../config/env.js";
import type { HostServerConfig } from "../../config/host.js";
import { resolveHostWalletSeed } from "./index.js";

// --- exports ---

export interface SolanaPayerWallet {
  readonly address: string;
  readonly privateKey: Uint8Array;
}

export const resolveSolanaPayerSeed = (
  config: Pick<HostServerConfig, "walletSeed"> = { walletSeed: null }
): string | null =>
  readOptionalEnv("LIVESTREAK_SOLANA_SPONSOR_SEED") ??
  readOptionalEnv("LIVESTREAK_SOLANA_SPONSOR_MNEMONIC") ??
  resolveHostWalletSeed(config);

export const resolveSolanaRpcUrl = (): string | null =>
  readOptionalEnv("LIVESTREAK_SOLANA_RPC_URL");

export const resolveSolanaPayerWallet = async (
  config: Pick<HostServerConfig, "walletSeed"> = { walletSeed: null }
): Promise<SolanaPayerWallet> => {
  const seed = resolveSolanaPayerSeed(config);
  if (seed === null) {
    throw new LiveStreakConfigError({
      message:
        "solana_payer_not_configured: set LIVESTREAK_SOLANA_SPONSOR_SEED or LIVESTREAK_WALLET_SEED",
      metadata: { retryable: false }
    });
  }

  const rpcUrl = resolveSolanaRpcUrl();
  if (rpcUrl === null) {
    throw new LiveStreakConfigError({
      message: "solana_rpc_not_configured: set LIVESTREAK_SOLANA_RPC_URL",
      metadata: { retryable: false }
    });
  }

  const manager = createWalletManager("solana", seed, { provider: rpcUrl });
  const account = await manager.getAccount(0);
  const privateKey = account.keyPair.privateKey;
  if (privateKey === null) {
    throw new LiveStreakConfigError({
      message: "solana_payer_private_key_unavailable",
      metadata: { retryable: false }
    });
  }

  return {
    address: await account.getAddress(),
    privateKey
  };
};

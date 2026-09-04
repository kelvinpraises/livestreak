import { LiveStreakConfigError } from "@livestreak/core";
import type { Hex } from "viem";
import type { HostServerConfig } from "../../config/host.js";
import { resolveEvmExecutorPrivateKey, type EvmWalletContext } from "./evm.js";
import { resolveSuiOwnerPrivateKey } from "./sui.js";

// --- exports ---

export type WalletChain = "evm" | "sui";

export interface WalletInit {
  readonly chain: WalletChain;
  readonly seed: string;
  readonly rpcUrl?: string;
  readonly chainId?: number;
  readonly entryPoint?: string;
  readonly bundlerUrl?: string;
}

export const resolveHostWalletSeed = (
  config: Pick<HostServerConfig, "walletSeed" | "memoryOwnerSeed">
): string | null => config.walletSeed ?? config.memoryOwnerSeed;

export const resolveWalletPrivateKey = async (init: WalletInit): Promise<string | Hex> => {
  switch (init.chain) {
    case "evm": {
      if (init.rpcUrl === undefined || init.chainId === undefined || init.entryPoint === undefined) {
        throw new Error("evm_wallet_context_incomplete");
      }

      return resolveEvmExecutorPrivateKey({
        seed: init.seed,
        chainId: init.chainId,
        rpcUrl: init.rpcUrl,
        entryPoint: init.entryPoint,
        bundlerUrl: init.bundlerUrl
      });
    }
    case "sui": {
      void init;
      return resolveSuiOwnerPrivateKey();
    }
    default: {
      throw new Error(`unsupported_wallet_chain:${String(init.chain)}`);
    }
  }
};

export const resolveMemoryOwnerKey = async (
  config: Pick<HostServerConfig, "walletSeed" | "memoryOwnerSeed">,
  suiRpcUrl: string
): Promise<string> => {
  void suiRpcUrl;
  const seed = resolveHostWalletSeed(config);
  if (seed === null) {
    throw new LiveStreakConfigError({
      message: "memory_owner_not_configured",
      metadata: { retryable: false }
    });
  }

  return resolveSuiOwnerPrivateKey();
};

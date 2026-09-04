import type { WalletInit, EvmWalletInitConfig } from "@livestreak/schema";
import {
  createWalletManager,
  type EvmErc4337WalletConfig,
  type WalletAccountEvmErc4337
} from "@livestreak/wallet";
import { createPublicClient, http, type PublicClient } from "viem";

export interface CreateCreatorWalletInput {
  readonly seed: string | Uint8Array;
  readonly config: EvmWalletInitConfig;
}

export interface CreatorWallet {
  readonly account: WalletAccountEvmErc4337;
  readonly publicClient: PublicClient;
  readonly walletInit: WalletInit;
}

export const createCreatorWallet = async (
  input: CreateCreatorWalletInput
): Promise<CreatorWallet> => {
  const walletInit: WalletInit = {
    chain: "evm",
    seedSource: "signature-derived",
    config: input.config
  };

  const manager = createWalletManager(
    "evm",
    input.seed,
    input.config as EvmErc4337WalletConfig
  );
  const account = await manager.getAccount();
  const rpcUrl = input.config.provider;
  const publicClient = createPublicClient({
    transport: http(rpcUrl),
    chain: {
      id: input.config.chainId,
      name: "livestreak",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } }
    }
  });

  return { account, publicClient, walletInit };
};

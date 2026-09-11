import { createWalletManager, type EvmErc4337WalletConfig, type SuiWalletConfig } from "@livestreak/wallet";
import type { SessionWallet, SettingsDoc, WalletInit } from "@livestreak/schema";
import { chainSettingsFor } from "../../prefs/settings.js";
import { resolveChainAdapter } from "./chain-registry.js";

// Build the floating WalletInit for a chain by delegating to its registered adapter — the CLI
// hardcodes no chain here. Adding a chain is a one-adapter change in chain-registry.ts.
export const buildWalletInitFromSettings = (
  doc: SettingsDoc,
  caip2: string = doc.defaultChain
): WalletInit => {
  const chain = chainSettingsFor(doc, caip2);
  const adapter = resolveChainAdapter(caip2);
  const contracts = adapter.deriveContracts(chain.contractOverrides);
  return adapter.buildWalletInit({
    caip2,
    rpc: chain.rpc,
    hostUrl: doc.host.url,
    contracts,
    ...(chain.aa === undefined ? {} : { aa: chain.aa })
  });
};

export const buildSessionWallet = async (
  doc: SettingsDoc,
  seed: string | Uint8Array,
  caip2: string = doc.defaultChain
): Promise<SessionWallet> => {
  const walletInit = buildWalletInitFromSettings(doc, caip2);
  // The CLI only INTERFACES the exported wallet: narrow the chain union and hand the chain's config to
  // the canonical createWalletManager (the signer implementation lives in @livestreak/wallet).
  const manager =
    walletInit.chain === "evm"
      ? createWalletManager("evm", seed, walletInit.config as unknown as EvmErc4337WalletConfig)
      : createWalletManager("sui", seed, walletInit.config as unknown as SuiWalletConfig);
  const account = await manager.getAccount();
  const operatorAddress = await account.getAddress();

  return {
    chain: caip2,
    seed,
    walletInit,
    operatorAddress
  };
};

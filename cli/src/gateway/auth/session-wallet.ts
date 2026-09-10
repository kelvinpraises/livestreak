import { createWalletManager, type EvmErc4337WalletConfig } from "@livestreak/wallet";
import type { SessionWallet, SettingsDoc, WalletInit } from "@livestreak/schema";
import { chainSettingsFor, mergedContracts } from "../../prefs/settings.js";

export const buildWalletInitFromSettings = (
  doc: SettingsDoc,
  caip2: string = doc.defaultChain
): WalletInit => {
  const chain = chainSettingsFor(doc, caip2);
  const hostBase = doc.host.url.replace(/\/$/, "");
  const contracts = mergedContracts(chain);

  const isSponsored = chain.aa?.isSponsored ?? true;
  const paymasterPath = chain.aa?.paymasterPath ?? "/aa/paymaster/local";

  const config = {
    chainId: Number(caip2.split(":")[1] ?? "31337"),
    provider: chain.rpc,
    bundlerUrl: `${hostBase}${chain.aa?.bundlerPath ?? "/aa/bundler/local"}`,
    ...(isSponsored ? { paymasterUrl: `${hostBase}${paymasterPath}` } : {}),
    isSponsored: true,
    useNativeCoins: false,
    entryPointAddress: contracts.entryPoint as `0x${string}`,
    safe4337ModuleAddress: contracts.safe4337Module as `0x${string}`,
    safeModulesSetupAddress: contracts.safeModuleSetup as `0x${string}`,
    safeModulesVersion: "0.3.0",
    contractNetworks: {
      [String(Number(caip2.split(":")[1] ?? "31337"))]: {
        safeSingletonAddress: contracts.safeSingleton as `0x${string}`,
        safeProxyFactoryAddress: contracts.safeProxyFactory as `0x${string}`,
        multiSendAddress: contracts.multiSend as `0x${string}`,
        multiSendCallOnlyAddress: contracts.multiSendCallOnly as `0x${string}`,
        fallbackHandlerAddress: contracts.fallbackHandler as `0x${string}`,
        signMessageLibAddress: contracts.signMessageLib as `0x${string}`,
        createCallAddress: contracts.createCall as `0x${string}`,
        simulateTxAccessorAddress: contracts.simulateTxAccessor as `0x${string}`
      }
    }
  } as EvmErc4337WalletConfig;

  return {
    chain: "evm",
    seedSource: "signature-derived",
    config: config as unknown as Extract<WalletInit, { chain: "evm" }>["config"]
  } as WalletInit;
};

export const buildSessionWallet = async (
  doc: SettingsDoc,
  seed: string | Uint8Array,
  caip2: string = doc.defaultChain
): Promise<SessionWallet> => {
  const walletInit = buildWalletInitFromSettings(doc, caip2);
  const manager = createWalletManager(
    "evm",
    seed,
    walletInit.config as EvmErc4337WalletConfig
  );
  const account = await manager.getAccount();
  const operatorAddress = await account.getAddress();

  return {
    chain: caip2,
    seed,
    walletInit,
    operatorAddress
  };
};

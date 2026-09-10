// Gateway-injected bootstrap: map canonical PackageRuntimeInit → options chain + runtime config.
// The seed/wallet material never crosses the browser leg — the CLI gateway injects this server-side.

import type { PackageRuntimeInit, SessionWallet } from "@livestreak/schema";

import type { OptionsChainConfig } from "../../chains/types.js";
import { asUserAddress, type UserAddress } from "../../model/ids.js";
import type { OptionsRuntimeConfig } from "../../runtime/config.js";
import type { OptionsContractAddresses } from "../../chains/evm/addresses.js";

export type { PackageRuntimeInit, SessionWallet };

const requireContract = (
  contracts: Readonly<Record<string, string>>,
  key: keyof OptionsContractAddresses
): string => {
  const value = contracts[key]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`PackageRuntimeInit.contracts missing required options address "${key}"`);
  }
  return value;
};

export const optionsContractAddressesFromInit = (
  contracts: Readonly<Record<string, string>>
): OptionsContractAddresses => ({
  marketRegistry: requireContract(contracts, "marketRegistry") as `0x${string}`,
  vault: requireContract(contracts, "vault") as `0x${string}`,
  marketDriver: requireContract(contracts, "marketDriver") as `0x${string}`,
  stewardRegistry: requireContract(contracts, "stewardRegistry") as `0x${string}`,
  treasury: requireContract(contracts, "treasury") as `0x${string}`,
  lvstToken: requireContract(contracts, "lvstToken") as `0x${string}`,
  dripsStreaming: requireContract(contracts, "dripsStreaming") as `0x${string}`
});

export const optionsChainConfigFromPackageInit = (
  init: PackageRuntimeInit,
  options?: { readonly readRpcUrl?: string }
): OptionsChainConfig => ({
  walletInit: init.wallet.walletInit,
  seed: init.wallet.seed,
  addresses: optionsContractAddressesFromInit(init.contracts),
  ...(options?.readRpcUrl === undefined ? {} : { readRpcUrl: options.readRpcUrl })
});

export const optionsRuntimeConfigFromPackageInit = (
  init: PackageRuntimeInit,
  options?: { readonly runtimeId?: string; readonly user?: UserAddress }
): OptionsRuntimeConfig => ({
  runtimeId: options?.runtimeId ?? `options-${init.package}`,
  user: options?.user ?? asUserAddress(init.wallet.operatorAddress)
});

export const createOptionsRuntimeBootstrap = (
  init: PackageRuntimeInit,
  options?: { readonly runtimeId?: string; readonly readRpcUrl?: string; readonly user?: UserAddress }
): {
  readonly chainConfig: OptionsChainConfig;
  readonly runtimeConfig: OptionsRuntimeConfig;
} => ({
  chainConfig: optionsChainConfigFromPackageInit(init, {
    ...(options?.readRpcUrl === undefined ? {} : { readRpcUrl: options.readRpcUrl })
  }),
  runtimeConfig: optionsRuntimeConfigFromPackageInit(init, {
    ...(options?.runtimeId === undefined ? {} : { runtimeId: options.runtimeId }),
    ...(options?.user === undefined ? {} : { user: options.user })
  })
});

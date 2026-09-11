// Gateway-injected bootstrap: map canonical PackageRuntimeInit → bookmaker chain + runtime config.
// Wallet/seed material never crosses the browser leg — the CLI gateway injects this server-side.

import type { PackageRuntimeInit, SessionWallet } from "@livestreak/schema";

import type { BookmakerContractAddresses, BookmakerSuiObjectIds } from "../../chains/addresses.js";
import type { BookmakerChainConfig } from "../../chains/types.js";
import type { BookmakerMarketContext } from "../../model/market-context.js";
import type { BookmakerWatchSource } from "../../model/watch-source.js";
import type { BookmakerVaultPolicy } from "../../pipeline/decision/choose.js";
import type { BookmakerRuntimeConfig } from "../../runtime/config.js";

export type { PackageRuntimeInit, SessionWallet };

const requireContract = (
  contracts: Readonly<Record<string, string>>,
  key: string
): string => {
  const value = contracts[key]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`PackageRuntimeInit.contracts missing required bookmaker address "${key}"`);
  }
  return value;
};

// The canonical contracts bag names the EVM stablecoin "mockUsdc"; the older console subset renamed
// it "usdc". Accept either so the full bag flows straight through.
const requireUsdc = (contracts: Readonly<Record<string, string>>): string => {
  const value = (contracts.usdc ?? contracts.mockUsdc)?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error('PackageRuntimeInit.contracts missing required bookmaker address "usdc"');
  }
  return value;
};

export const bookmakerContractAddressesFromInit = (
  contracts: Readonly<Record<string, string>>
): BookmakerContractAddresses => ({
  vaultDriver: requireContract(contracts, "vaultDriver"),
  marketRegistry: requireContract(contracts, "marketRegistry"),
  vault: requireContract(contracts, "vault"),
  usdc: requireUsdc(contracts)
});

export const bookmakerSuiObjectIdsFromInit = (
  contracts: Readonly<Record<string, string>>
): BookmakerSuiObjectIds => ({
  packageId: requireContract(contracts, "packageId"),
  vaultDriverRegistry: requireContract(contracts, "vaultDriverRegistry"),
  vaultRegistry: requireContract(contracts, "vaultRegistry"),
  marketRegistry: requireContract(contracts, "marketRegistry"),
  dripsRegistry: requireContract(contracts, "dripsRegistry"),
  streamsRegistry: requireContract(contracts, "streamsRegistry")
});

// Dispatch the addresses bag on the wallet chain: EVM contract addresses vs Sui object ids.
const bookmakerAddressesFromInit = (
  init: PackageRuntimeInit
): BookmakerContractAddresses | BookmakerSuiObjectIds =>
  init.wallet.walletInit.chain === "sui"
    ? bookmakerSuiObjectIdsFromInit(init.contracts)
    : bookmakerContractAddressesFromInit(init.contracts);

// The funding token: the USDC coin type on Sui, the USDC contract address on EVM.
const bookmakerFundingTokenFromInit = (init: PackageRuntimeInit): string =>
  init.wallet.walletInit.chain === "sui"
    ? `${bookmakerSuiObjectIdsFromInit(init.contracts).packageId}::mock_usdc::MOCK_USDC`
    : bookmakerContractAddressesFromInit(init.contracts).usdc;

export const bookmakerChainConfigFromPackageInit = (
  init: PackageRuntimeInit,
  options?: { readonly readRpcUrl?: string }
): BookmakerChainConfig => ({
  walletInit: init.wallet.walletInit,
  seed: init.wallet.seed,
  addresses: bookmakerAddressesFromInit(init),
  ...(options?.readRpcUrl === undefined ? {} : { readRpcUrl: options.readRpcUrl })
});

const defaultRemotePolicy = (): BookmakerVaultPolicy => ({
  duplicatePolicy: "always-create",
  detection: {
    detectorId: "remote-console",
    confidence: 0,
    question: "remote-console",
    vaultType: "momentum",
    durationSeconds: 600,
    suggestedSide: "yes",
    suggestedStake: 1n,
    observationRef: "remote"
  }
});

export const bookmakerRuntimeConfigFromPackageInit = (
  init: PackageRuntimeInit,
  options?: {
    readonly runtimeId?: string;
    readonly marketId?: string;
    readonly observeRunId?: string;
    readonly readRpcUrl?: string;
    readonly policy?: BookmakerVaultPolicy;
    readonly watchSource?: BookmakerWatchSource;
  }
): BookmakerRuntimeConfig => {
  const marketId = options?.marketId ?? "";
  const observeRunId = options?.observeRunId ?? init.runId ?? "";
  const marketContext: BookmakerMarketContext = {
    marketId,
    observeRunId,
    observer: init.wallet.operatorAddress
  };
  const watchSource: BookmakerWatchSource =
    options?.watchSource ?? { marketId, watchUrl: "", webrtcUrl: "" };

  return {
    runtimeId: options?.runtimeId ?? `bookmaker-${init.package}`,
    marketContext,
    watchSource,
    policy: options?.policy ?? defaultRemotePolicy(),
    fundingToken: bookmakerFundingTokenFromInit(init),
    walletInit: init.wallet.walletInit,
    seed: init.wallet.seed,
    addresses: bookmakerAddressesFromInit(init),
    ...(options?.readRpcUrl === undefined ? {} : { readRpcUrl: options.readRpcUrl })
  };
};

export const createBookmakerRuntimeBootstrap = (
  init: PackageRuntimeInit,
  options?: {
    readonly runtimeId?: string;
    readonly readRpcUrl?: string;
    readonly marketId?: string;
    readonly observeRunId?: string;
    readonly policy?: BookmakerVaultPolicy;
    readonly watchSource?: BookmakerWatchSource;
  }
): {
  readonly chainConfig: BookmakerChainConfig;
  readonly runtimeConfig: BookmakerRuntimeConfig;
} => ({
  chainConfig: bookmakerChainConfigFromPackageInit(init, {
    ...(options?.readRpcUrl === undefined ? {} : { readRpcUrl: options.readRpcUrl })
  }),
  runtimeConfig: bookmakerRuntimeConfigFromPackageInit(init, {
    ...(options?.runtimeId === undefined ? {} : { runtimeId: options.runtimeId }),
    ...(options?.marketId === undefined ? {} : { marketId: options.marketId }),
    ...(options?.observeRunId === undefined ? {} : { observeRunId: options.observeRunId }),
    ...(options?.readRpcUrl === undefined ? {} : { readRpcUrl: options.readRpcUrl }),
    ...(options?.policy === undefined ? {} : { policy: options.policy }),
    ...(options?.watchSource === undefined ? {} : { watchSource: options.watchSource })
  })
});

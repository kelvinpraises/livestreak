import type { AaOperationKind, AaSponsorshipMode } from "@livestreak/host";
import type { Hex } from "viem";
import { assertPaymasterSignerMatchesChain } from "../../config/aa/boot-assert.js";
import { readChainsFromFile } from "../../config/aa/chains-file.js";
import type { HostServerConfig } from "../../config/host.js";
import { resolveEvmExecutorPrivateKey } from "../../infrastructure/wallet/wallet.js";
import { createPaymasterSigner, type PaymasterSigner } from "./paymaster.js";

// --- exports ---

export interface AaChainConfig {
  readonly routeKey: string;
  readonly chainId: number;
  readonly name: string;
  readonly entryPoint: string;
  readonly safeModule?: string;
  readonly bundlerUrl?: string;
  readonly rpcUrl?: string;
  readonly executorPrivateKey?: Hex;
  readonly paymasterAddress?: Hex;
}

export interface AaServerConfig {
  readonly sponsorshipMode: AaSponsorshipMode;
  readonly supportedOperations: readonly AaOperationKind[];
  readonly paymasterPath: string;
  readonly chains: readonly AaChainConfig[];
}

export const readAaServerConfig = (config: HostServerConfig): AaServerConfig => {
  const fileChains = readFileChains();
  const envChain = buildEnvChain(config);
  const chains = mergeChains(fileChains, envChain);

  return {
    sponsorshipMode: "dev_open",
    supportedOperations: ["user_operation", "safe_module_call"],
    paymasterPath: "/aa/paymaster",
    chains
  };
};

export const resolveAaChain = (
  aa: AaServerConfig,
  routeKey: string
): AaChainConfig | undefined => aa.chains.find((chain) => chain.routeKey === routeKey);

export const buildPaymasterSigners = async (
  aa: AaServerConfig,
  config: HostServerConfig
): Promise<Map<string, PaymasterSigner>> => {
  const signers = new Map<string, PaymasterSigner>();

  for (const chain of aa.chains) {
    if (chain.paymasterAddress === undefined) {
      continue;
    }

    const executorPrivateKey =
      chain.executorPrivateKey ?? (await resolveChainExecutorKey(config, chain));
    if (executorPrivateKey === undefined) {
      continue;
    }

    signers.set(
      chain.routeKey,
      createPaymasterSigner(executorPrivateKey, chain.paymasterAddress)
    );
  }

  return signers;
};

export const bootstrapAaFromConfig = async (
  aa: AaServerConfig,
  config: HostServerConfig
): Promise<void> => {
  for (const chain of aa.chains) {
    if (chain.paymasterAddress === undefined) {
      continue;
    }

    const executorPrivateKey =
      chain.executorPrivateKey ?? (await resolveChainExecutorKey(config, chain));
    if (executorPrivateKey === undefined) {
      continue;
    }

    await assertPaymasterSignerMatchesChain({
      ...chain,
      executorPrivateKey
    });
  }
};

export const resolveChainExecutorKey = async (
  config: HostServerConfig,
  chain: AaChainConfig
): Promise<Hex | undefined> => {
  if (chain.executorPrivateKey !== undefined) {
    return chain.executorPrivateKey;
  }

  if (chain.rpcUrl === undefined) {
    return undefined;
  }

  return (await resolveEvmExecutorPrivateKey(config, chain)) ?? undefined;
};

// --- helpers ---

const readFileChains = (): AaChainConfig[] => {
  const filePath = process.env.LIVESTREAK_AA_CHAINS_FILE;
  if (filePath === undefined || filePath.length === 0) {
    return [];
  }

  return readChainsFromFile(filePath);
};

const buildEnvChain = (config: HostServerConfig): AaChainConfig | null => {
  const rpcUrl = process.env.LIVESTREAK_AA_RPC_URL;
  if (rpcUrl === undefined || rpcUrl.length === 0) {
    return null;
  }

  const paymasterAddress = readPaymasterAddress();

  return {
    routeKey: "local",
    chainId: Number.parseInt(process.env.LIVESTREAK_AA_CHAIN_ID ?? "31337", 10),
    name: "local",
    entryPoint:
      process.env.LIVESTREAK_AA_ENTRY_POINT ?? "0x0000000000000000000000000000000000000000",
    safeModule: process.env.LIVESTREAK_AA_SAFE_MODULE,
    bundlerUrl: process.env.LIVESTREAK_AA_BUNDLER_URL,
    rpcUrl,
    ...(paymasterAddress === undefined ? {} : { paymasterAddress })
  };
};

const mergeChains = (
  fileChains: readonly AaChainConfig[],
  envChain: AaChainConfig | null
): AaChainConfig[] => {
  if (envChain === null) {
    return [...fileChains];
  }

  if (fileChains.length === 0) {
    return [envChain];
  }

  const byRouteKey = new Map<string, AaChainConfig>();
  for (const chain of fileChains) {
    byRouteKey.set(chain.routeKey, chain);
  }

  if (byRouteKey.has(envChain.routeKey)) {
    console.warn(
      `[aa]: deploy/env chain "${envChain.routeKey}" duplicates chains file entry — file wins`
    );
  } else {
    byRouteKey.set(envChain.routeKey, envChain);
  }

  return [...byRouteKey.values()];
};

const readPaymasterAddress = (): Hex | undefined => {
  const value = process.env.LIVESTREAK_AA_PAYMASTER_ADDRESS;
  return value === undefined || value.length === 0 ? undefined : (value as Hex);
};

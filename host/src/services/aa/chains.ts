import type { AaOperationKind, AaSponsorshipMode } from "@livestreak/host";
import type { Hex } from "viem";
import { assertPaymasterSignerMatchesChain } from "../../config/aa/boot-assert.js";
import { readChainsFromFile } from "../../config/aa/chains-file.js";
import type { HostServerConfig } from "../../config/host.js";
import { startAlto } from "../../infrastructure/bundler/alto.js";
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
  /**
   * H1: when true the paymaster route refuses to sponsor unless the request
   * carries a matching bearer token. Set on any non-loopback bind so a public
   * host cannot be drained of free gas via the open `dev_open` mode.
   */
  readonly requirePaymasterAuth: boolean;
  /** Bearer token the paymaster route checks when `requirePaymasterAuth`. */
  readonly paymasterAuthToken?: string;
}

export const readAaServerConfig = (config: HostServerConfig): AaServerConfig => {
  const loopback = isLoopbackBind(config.bindHost);
  const authToken = readPaymasterAuthToken();
  const fileChains = readFileChains();
  const envChain = buildEnvChain();
  const chains = mergeChains(fileChains, envChain);

  // H1 posture: `dev_open` (open sponsorship) is only safe on a loopback bind.
  // On any public/non-loopback bind we require a bearer token; the advertised
  // sponsorship mode reflects whether sponsorship is even available.
  const sponsorshipMode: AaSponsorshipMode = loopback
    ? "dev_open"
    : authToken === undefined
      ? "none"
      : "paymaster_signed";

  return {
    sponsorshipMode,
    supportedOperations: ["user_operation", "safe_module_call"],
    paymasterPath: "/aa/paymaster",
    chains,
    requirePaymasterAuth: !loopback,
    ...(authToken === undefined ? {} : { paymasterAuthToken: authToken })
  };
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

// `0.0.0.0` binds all interfaces (publicly reachable) and is intentionally
// treated as NON-loopback so it cannot run open sponsorship.
const isLoopbackBind = (bindHost: string): boolean => {
  const host = bindHost.trim().toLowerCase();
  if (host === "0.0.0.0" || host === "::") {
    return false;
  }
  return LOOPBACK_HOSTS.has(host) || host.startsWith("127.");
};

const readPaymasterAuthToken = (): string | undefined => {
  const value = process.env.LIVESTREAK_AA_PAYMASTER_AUTH_TOKEN;
  return value === undefined || value.length === 0 ? undefined : value;
};

export const resolveAaChain = (
  aa: AaServerConfig,
  routeKey: string
): AaChainConfig | undefined => aa.chains.find((chain) => chain.routeKey === routeKey);

export const buildPaymasterSigners = (aa: AaServerConfig): Map<string, PaymasterSigner> => {
  const signers = new Map<string, PaymasterSigner>();

  for (const chain of aa.chains) {
    if (chain.executorPrivateKey === undefined || chain.paymasterAddress === undefined) {
      continue;
    }

    signers.set(
      chain.routeKey,
      createPaymasterSigner(chain.executorPrivateKey, chain.paymasterAddress)
    );
  }

  return signers;
};

export const bootstrapAaFromConfig = async (aa: AaServerConfig): Promise<void> => {
  for (const chain of aa.chains) {
    if (chain.paymasterAddress !== undefined && chain.executorPrivateKey !== undefined) {
      await assertPaymasterSignerMatchesChain(chain);
    }

    if (
      chain.rpcUrl === undefined ||
      chain.entryPoint === undefined ||
      chain.executorPrivateKey === undefined
    ) {
      continue;
    }

    await startAlto(chain.routeKey, {
      entryPointAddress: chain.entryPoint,
      rpcUrl: chain.rpcUrl,
      executorPrivateKey: chain.executorPrivateKey,
      port: 0
    });
  }
};

// --- helpers ---

const readFileChains = (): AaChainConfig[] => {
  const filePath = process.env.LIVESTREAK_AA_CHAINS_FILE;
  if (filePath === undefined || filePath.length === 0) {
    return [];
  }

  return readChainsFromFile(filePath);
};

const buildEnvChain = (): AaChainConfig | null => {
  const rpcUrl = process.env.LIVESTREAK_AA_RPC_URL;
  if (rpcUrl === undefined || rpcUrl.length === 0) {
    return null;
  }

  const executorPrivateKey = readExecutorPrivateKey();
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
    ...(executorPrivateKey === undefined ? {} : { executorPrivateKey }),
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

const readExecutorPrivateKey = (): Hex | undefined => {
  const value =
    process.env.LIVESTREAK_AA_EXECUTOR_PRIVATE_KEY ?? process.env.LIVESTREAK_AA_OPERATOR_KEY;
  return value === undefined || value.length === 0 ? undefined : (value as Hex);
};

const readPaymasterAddress = (): Hex | undefined => {
  const value = process.env.LIVESTREAK_AA_PAYMASTER_ADDRESS;
  return value === undefined || value.length === 0 ? undefined : (value as Hex);
};

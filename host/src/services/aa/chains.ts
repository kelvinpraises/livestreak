import type { AaOperationKind, AaSponsorshipMode } from "@livestreak/host";
import type { Hex } from "viem";
import { assertPaymasterSignerMatchesChain } from "../../config/aa/boot-assert.js";
import { readChainsFromFile } from "../../config/aa/chains-file.js";
import type { DeploySnapshotConfig } from "../../config/aa/deploy-env.js";
import type { HostServerConfig } from "../../config/host.js";
import { startAlto } from "../../infrastructure/bundler/alto.js";
import { createPaymasterSigner, type PaymasterSigner } from "./paymaster.js";

// World-known anvil dev key. Injected ONLY under chainId 31337 + LIVESTREAK_AA_ALLOW_DEV_KEY=1 so
// the local dev stack can sponsor without an operator key in the environment.
const ANVIL_DEV_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

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

export const readAaServerConfig = (
  config: HostServerConfig,
  snapshot: DeploySnapshotConfig = {}
): AaServerConfig => {
  const loopback = isLoopbackBind(config.bindHost);
  const authToken = readPaymasterAuthToken();
  const fileChains = readFileChains();
  const envChain = buildEnvChain(snapshot);
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

// Assemble the single "local" env chain with an EXPLICIT merge: ENV > snapshot > defaults. The
// snapshot is a plain partial-config object (never process.env mutation); env values still win.
const buildEnvChain = (snapshot: DeploySnapshotConfig): AaChainConfig | null => {
  const rpcUrl = readEnv("LIVESTREAK_AA_RPC_URL") ?? snapshot.rpcUrl;
  if (rpcUrl === undefined || rpcUrl.length === 0) {
    return null;
  }

  const chainId = resolveChainId(snapshot.chainId);
  const entryPoint =
    readEnv("LIVESTREAK_AA_ENTRY_POINT") ??
    snapshot.entryPoint ??
    "0x0000000000000000000000000000000000000000";
  const safeModule = readEnv("LIVESTREAK_AA_SAFE_MODULE") ?? snapshot.safeModule;
  const paymasterAddress = readPaymasterAddress(snapshot.paymasterAddress);
  const executorPrivateKey = resolveExecutorPrivateKey(chainId);

  return {
    routeKey: "local",
    chainId,
    name: "local",
    entryPoint,
    ...(safeModule === undefined ? {} : { safeModule }),
    bundlerUrl: process.env.LIVESTREAK_AA_BUNDLER_URL,
    rpcUrl,
    ...(executorPrivateKey === undefined ? {} : { executorPrivateKey }),
    ...(paymasterAddress === undefined ? {} : { paymasterAddress })
  };
};

// ENV > snapshot > 31337 default.
const resolveChainId = (snapshotChainId: number | undefined): number => {
  const envValue = readEnv("LIVESTREAK_AA_CHAIN_ID");
  if (envValue !== undefined) {
    return Number.parseInt(envValue, 10);
  }
  return snapshotChainId ?? 31337;
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

// A present-but-empty env var reads as "unset" here so a blank export never shadows a snapshot value.
const readEnv = (key: string): string | undefined => {
  const value = process.env[key];
  return value === undefined || value.length === 0 ? undefined : value;
};

// Executor key precedence: explicit env keys first. Only when none is set AND we are on the anvil
// dev chain (31337) with LIVESTREAK_AA_ALLOW_DEV_KEY=1 do we fall back to the world-known dev key.
const resolveExecutorPrivateKey = (chainId: number): Hex | undefined => {
  const explicit =
    readEnv("LIVESTREAK_AA_EXECUTOR_PRIVATE_KEY") ?? readEnv("LIVESTREAK_AA_OPERATOR_KEY");
  if (explicit !== undefined) {
    return explicit as Hex;
  }
  if (chainId === 31337 && process.env.LIVESTREAK_AA_ALLOW_DEV_KEY === "1") {
    console.warn(
      "[host]: LIVESTREAK_AA_ALLOW_DEV_KEY=1 — using world-known anvil dev executor key"
    );
    return ANVIL_DEV_KEY as Hex;
  }
  return undefined;
};

const readPaymasterAddress = (snapshotAddress: string | undefined): Hex | undefined => {
  const value = readEnv("LIVESTREAK_AA_PAYMASTER_ADDRESS") ?? snapshotAddress;
  return value === undefined || value.length === 0 ? undefined : (value as Hex);
};

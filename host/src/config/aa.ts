import type { AaOperationKind, AaSponsorshipMode } from "@livestreak/host";
import type { DeploySnapshotConfig } from "./deployment.js";
import type { HostServerConfig } from "./host.js";
import { readFileSync } from "node:fs";

// --- exports ---

export interface AaChainConfig {
  readonly routeKey: string;
  readonly chainId: number;
  readonly name: string;
  readonly entryPoint: string;
  readonly safeModule?: string;
  readonly bundlerUrl?: string;
  readonly paymasterUrl?: string;
  readonly rpcUrl?: string;
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
    "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
  const safeModule = readEnv("LIVESTREAK_AA_SAFE_MODULE") ?? snapshot.safeModule;

  return {
    routeKey: "local",
    chainId,
    name: chainId === 421614 ? "Arbitrum Sepolia" : `EVM ${chainId}`,
    entryPoint,
    ...(safeModule === undefined ? {} : { safeModule }),
    bundlerUrl: process.env.LIVESTREAK_AA_BUNDLER_URL,
    paymasterUrl: process.env.LIVESTREAK_AA_PAYMASTER_URL,
    rpcUrl
  };
};

// ENV > explicit snapshot > Arbitrum Sepolia.
const resolveChainId = (snapshotChainId: number | undefined): number => {
  const envValue = readEnv("LIVESTREAK_AA_CHAIN_ID");
  if (envValue !== undefined) {
    return Number.parseInt(envValue, 10);
  }
  return snapshotChainId ?? 421614;
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



// --- exports ---

export interface AaChainFileEntry {
  readonly routeKey: string;
  readonly chainId: number;
  readonly name: string;
  readonly entryPoint: string;
  readonly safeModule?: string;
  readonly bundlerUrl?: string;
  readonly paymasterUrl?: string;
  readonly bundlerUrlEnv?: string;
  readonly paymasterUrlEnv?: string;
  readonly rpcUrl?: string;
}

export const readChainsFromFile = (filePath: string): AaChainConfig[] => {
  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error("aa_chains_file_must_be_array");
  }

  const chains = parsed.map((entry, index) => parseChainEntry(entry, index));
  assertUniqueRouteKeys(chains);
  return chains;
};

// --- helpers ---

const HEX_ADDRESS = /^0x[a-fA-F0-9]{40}$/u;

const parseChainEntry = (entry: unknown, index: number): AaChainConfig => {
  if (entry === null || typeof entry !== "object") {
    throw new Error(`aa_chains_file_entry_${index}_invalid`);
  }

  const record = entry as AaChainFileEntry;
  const routeKey = requireString(record.routeKey, `aa_chains_file_entry_${index}_routeKey`);
  const chainId = requireNumber(record.chainId, `aa_chains_file_entry_${index}_chainId`);
  const name = requireString(record.name, `aa_chains_file_entry_${index}_name`);
  const entryPoint = requireHexAddress(record.entryPoint, `aa_chains_file_entry_${index}_entryPoint`);

  const bundlerUrl = resolveEndpoint(record.bundlerUrl, record.bundlerUrlEnv, index, "bundlerUrl");
  const paymasterUrl = resolveEndpoint(record.paymasterUrl, record.paymasterUrlEnv, index, "paymasterUrl");

  return {
    routeKey,
    chainId,
    name,
    entryPoint,
    ...(record.safeModule === undefined ? {} : { safeModule: record.safeModule }),
    ...(bundlerUrl === undefined ? {} : { bundlerUrl }),
    ...(paymasterUrl === undefined ? {} : { paymasterUrl }),
    ...(record.rpcUrl === undefined ? {} : { rpcUrl: record.rpcUrl })
  };
};

const assertUniqueRouteKeys = (chains: readonly AaChainConfig[]): void => {
  const seen = new Set<string>();

  for (const chain of chains) {
    if (seen.has(chain.routeKey)) {
      throw new Error(`aa_chains_duplicate_routeKey:${chain.routeKey}`);
    }

    seen.add(chain.routeKey);
  }
};

const requireString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}_required`);
  }

  return value;
};

const requireNumber = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label}_required`);
  }

  return value;
};

const requireHexAddress = (value: unknown, label: string): string => {
  const text = requireString(value, label);
  if (!HEX_ADDRESS.test(text)) {
    throw new Error(`${label}_invalid_hex`);
  }

  return text;
};

const resolveEndpoint = (value: unknown, envName: unknown, index: number, label: string): string | undefined => {
  const endpoint = envName === undefined ? value : process.env[requireString(envName, `aa_chains_file_entry_${index}_${label}Env`)];
  if (endpoint === undefined) {
    if (envName !== undefined) throw new Error(`aa_chains_file_entry_${index}_${label}_env_missing`);
    return undefined;
  }
  const text = requireString(endpoint, `aa_chains_file_entry_${index}_${label}`);
  let url: URL;
  try { url = new URL(text); } catch { throw new Error(`aa_chains_file_entry_${index}_${label}_invalid_url`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(`aa_chains_file_entry_${index}_${label}_invalid_url`);
  }
  return text;
};

import type {
  HostModuleToken,
  HostProviderDescriptor,
  MemoryTrustModel,
  WalrusNetwork
} from "@livestreak/host";
import type { OutputMode } from "@livestreak/schema";
import {
  bootstrapWalrus,
  parseWalrusNetwork,
  profileBlobEndpoints,
  profileMemoryRelayerUrl,
  walrusNetworkProfiles,
  type ResolvedWalrus
} from "../infrastructure/walrus/network.js";

// --- exports ---

export interface HostServerConfig {
  readonly hostId: string;
  readonly baseUrl: string;
  readonly bindHost: string;
  readonly bindPort: number;
  readonly startedAtMs: number;
  readonly accountTier: string;
  readonly termsVersion?: string;
  readonly enabledModules: readonly HostModuleToken[];
  readonly supportedOutputs: readonly OutputMode[];
  readonly cacheQuotaBytes: number;
  readonly cacheRetentionDays: number;
  readonly cacheReceipts: "none" | "optional" | "required";
  readonly minDurationSeconds: number;
  readonly maxDurationSeconds: number;
  readonly walrusNetwork: WalrusNetwork | null;
  readonly walrusMemoryRelayerUrlOverride: string | null;
  readonly walrusRegistryIdOverride: string | null;
  readonly walletSeed: string | null;
  readonly memorySuiOwnerPrivateKey: string | null;
  readonly memoryOwnerSeed: string | null;
  readonly memoryTrustModel: MemoryTrustModel;
  readonly walrusContentEphemeralEpochs: number;
  readonly walrusContentLockedEpochs: number;
  readonly resolvedWalrus: ResolvedWalrus | null;
  readonly livekitApiKey: string | undefined;
}

export const isWalrusEnabled = (config: HostServerConfig): boolean =>
  config.walrusNetwork !== null;

export const isMemoryHostConfigured = (config: HostServerConfig): boolean =>
  isWalrusEnabled(config) &&
  (config.memorySuiOwnerPrivateKey !== null || config.memoryOwnerSeed !== null);

export const isWalrusBootstrapped = (config: HostServerConfig): boolean =>
  isWalrusEnabled(config) && config.resolvedWalrus !== null;

export const isMemoryBootstrapped = (config: HostServerConfig): boolean =>
  isMemoryHostConfigured(config) && isWalrusBootstrapped(config);

const allModules: readonly HostModuleToken[] = [
  "aa",
  "media",
  "walrus_memory",
  "walrus_content",
  "discovery",
  "runtime",
  "tenancy"
];

export const defaultHostServerConfig = (): HostServerConfig => ({
  hostId: process.env.LIVESTREAK_HOST_ID ?? "host_dev",
  baseUrl: process.env.LIVESTREAK_HOST_BASE_URL ?? "http://127.0.0.1:8787",
  bindHost: process.env.LIVESTREAK_HOST_BIND_HOST ?? "127.0.0.1",
  bindPort: Number.parseInt(process.env.LIVESTREAK_HOST_BIND_PORT ?? "8787", 10),
  startedAtMs: Date.now(),
  accountTier: "dev",
  termsVersion: "dev-terms",
  enabledModules: [...allModules],
  supportedOutputs: ["file", "local", "simulcast"],
  cacheQuotaBytes: 1024 * 1024 * 1024,
  cacheRetentionDays: 7,
  cacheReceipts: "required",
  minDurationSeconds: 0,
  maxDurationSeconds: 6 * 60 * 60,
  walrusNetwork: parseWalrusNetwork(readOptionalEnv("LIVESTREAK_WALRUS_NETWORK")),
  walrusMemoryRelayerUrlOverride: readOptionalEnv("LIVESTREAK_WALRUS_MEMORY_RELAYER_URL_OVERRIDE"),
  walrusRegistryIdOverride: readOptionalEnv("LIVESTREAK_WALRUS_REGISTRY_ID_OVERRIDE"),
  walletSeed: readOptionalEnv("LIVESTREAK_WALLET_SEED"),
  memorySuiOwnerPrivateKey:
    readOptionalEnv("LIVESTREAK_MEMORY_OWNER_KEY") ??
    readOptionalEnv("LIVESTREAK_MEMORY_SUI_OWNER_KEY"),
  memoryOwnerSeed: readOptionalEnv("LIVESTREAK_MEMORY_OWNER_SEED"),
  memoryTrustModel: "plaintext-relayer",
  walrusContentEphemeralEpochs: readPositiveIntEnv("LIVESTREAK_WALRUS_CONTENT_EPHEMERAL_EPOCHS", 1),
  walrusContentLockedEpochs: readPositiveIntEnv("LIVESTREAK_WALRUS_CONTENT_LOCKED_EPOCHS", 5),
  resolvedWalrus: null,
  livekitApiKey: process.env.LIVEKIT_API_KEY
});

export const toHostProviderDescriptor = (config: HostServerConfig): HostProviderDescriptor => {
  const simulcastAvailable = config.livekitApiKey !== undefined && config.livekitApiKey.length > 0;
  const advertisedOutputs = config.supportedOutputs.filter(
    (mode) => mode !== "simulcast" || simulcastAvailable
  );

  const relayerUrl = profileMemoryRelayerUrl(config);
  const blob = profileBlobEndpoints(config);

  return {
    version: "0.1.0",
    hostId: config.hostId,
    baseUrl: config.baseUrl,
    modules: [...config.enabledModules],
    supportedOutputs: [...advertisedOutputs],
    media: { simulcastAvailable },
    walrus: {
      network: config.walrusNetwork
    },
    memory: {
      relayerUrl,
      namespaceTemplate: "market:{marketId}",
      trustModel: config.memoryTrustModel
    },
    content: {
      publisherUrl: blob?.publisherUrl ?? null,
      aggregatorUrl: blob?.aggregatorUrl ?? null
    },
    termsVersion: config.termsVersion
  };
};

export const isModuleEnabled = (
  config: HostServerConfig,
  token: HostModuleToken
): boolean => config.enabledModules.includes(token);

export const bootstrapHostServerConfig = async (
  config: HostServerConfig = defaultHostServerConfig(),
  fetchImpl: typeof fetch = fetch
): Promise<HostServerConfig> => bootstrapWalrus(config, fetchImpl);

// --- helpers ---

const readOptionalEnv = (key: string): string | null => {
  const value = process.env[key];
  return value === undefined || value.length === 0 ? null : value;
};

const readPositiveIntEnv = (key: string, fallback: number): number => {
  const raw = readOptionalEnv(key);
  if (raw === null) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const walrusProfileFor = (network: WalrusNetwork) => walrusNetworkProfiles[network];

import type { HostModuleToken, HostProviderDescriptor } from "@livestreak/host";
import type { OutputMode } from "@livestreak/schema";
import type { StorageConfig } from "../infrastructure/storage/object-store.js";
import { readOptionalEnv } from "./env.js";

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
  readonly walletSeed: string | null;
  readonly storage: StorageConfig | null;
  readonly contentWriteToken: string | null;
  readonly livekitApiKey: string | undefined;
  // --- Remote Bridge Console (P4) ---
  /** App origin the host 302-redirects `/remote/:session` to (UI lives there). */
  readonly remoteAppOrigin: string | null;
  /** Shared secret leg-A `register` must present so the host trusts the gateway. */
  readonly remoteGatewayToken: string | null;
  /** Optional stable 32-byte Ed25519 seed (hex) for the host grant key. */
  readonly remoteGrantKeyHex: string | null;
  /** Default session TTL (ms) if the gateway does not specify one. */
  readonly remoteSessionTtlMs: number;
}

const allModules: readonly HostModuleToken[] = [
  "aa",
  "media",
  "memory",
  "forum",
  "content",
  "discovery",
  "remote"
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
  walletSeed: readOptionalEnv("LIVESTREAK_WALLET_SEED"),
  storage: readStorageConfig(),
  contentWriteToken: readOptionalEnv("LIVESTREAK_HOST_API_TOKEN"),
  livekitApiKey: process.env.LIVEKIT_API_KEY,
  remoteAppOrigin: readOptionalEnv("LIVESTREAK_APP_ORIGIN"),
  remoteGatewayToken: readOptionalEnv("LIVESTREAK_REMOTE_GATEWAY_TOKEN"),
  remoteGrantKeyHex: readOptionalEnv("LIVESTREAK_REMOTE_GRANT_KEY"),
  remoteSessionTtlMs: readPositiveIntEnv("LIVESTREAK_REMOTE_SESSION_TTL_MS", 60 * 60 * 1000)
});

export const toHostProviderDescriptor = (config: HostServerConfig): HostProviderDescriptor => {
  const simulcastAvailable = config.livekitApiKey !== undefined && config.livekitApiKey.length > 0;
  const advertisedOutputs = config.supportedOutputs.filter(
    (mode) => mode !== "simulcast" || simulcastAvailable
  );


  return {
    version: "0.1.0",
    hostId: config.hostId,
    baseUrl: config.baseUrl,
    modules: [...config.enabledModules],
    supportedOutputs: [...advertisedOutputs],
    media: { simulcastAvailable },
    memory: {
      recordsAvailable: config.enabledModules.includes("memory")
    },
    content: {
      available: config.enabledModules.includes("content") && config.storage !== null,
      apiUrl: config.baseUrl.replace(/\/$/, "") + "/content",
      recordingsAvailable: config.enabledModules.includes("content") && config.storage !== null && config.contentWriteToken !== null
    },
    termsVersion: config.termsVersion
  };
};

export const isModuleEnabled = (
  config: HostServerConfig,
  token: HostModuleToken
): boolean => config.enabledModules.includes(token);

export const bootstrapHostServerConfig = async (
  config: HostServerConfig = defaultHostServerConfig()
): Promise<HostServerConfig> => {
  if (config.storage !== null && !config.contentWriteToken) throw new Error("LIVESTREAK_HOST_API_TOKEN is required for cloud write access");
  return config;
};

// --- helpers ---

const readPositiveIntEnv = (key: string, fallback: number): number => {
  const raw = readOptionalEnv(key);
  if (raw === null) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};


export const readStorageConfig = (): StorageConfig | null => {
  const values = [readOptionalEnv("LIVESTREAK_STORAGE_ENDPOINT"), readOptionalEnv("LIVESTREAK_STORAGE_BUCKET"), readOptionalEnv("LIVESTREAK_STORAGE_ACCESS_KEY_ID"), readOptionalEnv("LIVESTREAK_STORAGE_SECRET_ACCESS_KEY"), readOptionalEnv("LIVESTREAK_STORAGE_PUBLIC_BASE_URL")];
  if (values.every(v => v === null)) return null;
  const provider = readOptionalEnv("LIVESTREAK_STORAGE_PROVIDER") ?? "s3";
  if (provider !== "s3") throw new Error("Unsupported cloud storage provider");
  if (values.some(v => v === null)) throw new Error("Incomplete cloud storage configuration");
  const [endpoint, bucket, accessKeyId, secretAccessKey, publicBaseUrl] = values as string[];
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey || !publicBaseUrl) throw new Error("Incomplete storage configuration");
  if (new URL(endpoint).protocol !== "https:" || new URL(publicBaseUrl).protocol !== "https:") throw new Error("Cloud storage requires HTTPS");
  const publicUrl = new URL(publicBaseUrl);
  if(publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash) throw new Error("Public storage base URL must not contain credentials, query or fragment");
  return { endpoint, bucket, accessKeyId, secretAccessKey, publicBaseUrl, region: readOptionalEnv("LIVESTREAK_STORAGE_REGION") ?? "auto" };
};

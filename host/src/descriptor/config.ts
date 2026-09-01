import type {
  HostCapability,
  HostOutputMode,
  HostProviderDescriptor
} from "@livestreak/host";

// --- exports ---

export interface HostServerConfig {
  readonly hostId: string;
  readonly baseUrl: string;
  readonly bindHost: string;
  readonly bindPort: number;
  readonly startedAtMs: number;
  readonly accountTier: string;
  readonly termsVersion?: string;
  readonly supportedOutputs: readonly HostOutputMode[];
  readonly capabilities: readonly HostCapability[];
  readonly cacheQuotaBytes: number;
  readonly cacheRetentionDays: number;
  readonly cacheReceipts: "none" | "optional" | "required";
  readonly minDurationSeconds: number;
  readonly maxDurationSeconds: number;
}

export const defaultHostServerConfig = (): HostServerConfig => ({
  hostId: process.env.LIVESTREAK_HOST_ID ?? "host_dev",
  baseUrl: process.env.LIVESTREAK_HOST_BASE_URL ?? "http://127.0.0.1:8787",
  bindHost: process.env.LIVESTREAK_HOST_BIND_HOST ?? "127.0.0.1",
  bindPort: Number.parseInt(process.env.LIVESTREAK_HOST_BIND_PORT ?? "8787", 10),
  startedAtMs: Date.now(),
  accountTier: "dev",
  termsVersion: "dev-terms",
  supportedOutputs: ["forwarder", "local", "file"],
  capabilities: ["webrtc_forwarding", "host_cache", "endpoint_manifests"],
  cacheQuotaBytes: 1024 * 1024 * 1024,
  cacheRetentionDays: 7,
  cacheReceipts: "required",
  minDurationSeconds: 0,
  maxDurationSeconds: 6 * 60 * 60
});

export const toHostProviderDescriptor = (config: HostServerConfig): HostProviderDescriptor => ({
  version: "0.1.0",
  hostId: config.hostId,
  baseUrl: config.baseUrl,
  capabilities: [...config.capabilities],
  supportedOutputs: [...config.supportedOutputs],
  termsVersion: config.termsVersion
});

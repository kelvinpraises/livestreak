import type { HostProviderDescriptor } from "@livestreak/host";
import type { HostServerConfig } from "./config.js";
import { toHostProviderDescriptor } from "./config.js";

// --- exports ---

export interface HealthResponse {
  readonly ok: true;
  readonly hostId: string;
  readonly version: string;
  readonly uptimeMs: number;
}

export interface DescriptorRouteDeps {
  readonly config: HostServerConfig;
}

export const handleHealth = (deps: DescriptorRouteDeps, nowMs = Date.now()): HealthResponse => ({
  ok: true,
  hostId: deps.config.hostId,
  version: "0.1.0",
  uptimeMs: Math.max(0, nowMs - deps.config.startedAtMs)
});

export const handleDescriptor = (deps: DescriptorRouteDeps): HostProviderDescriptor =>
  toHostProviderDescriptor(deps.config);

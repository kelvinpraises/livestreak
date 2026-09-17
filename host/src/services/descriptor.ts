import type { HostProviderDescriptor } from "@livestreak/host";
import type { HostServerConfig } from "../config/host.js";
import {
  isModuleEnabled,
  isWalrusBootstrapped,
  isWalrusEnabled,
  toHostProviderDescriptor
} from "../config/host.js";

// --- exports ---

export type HealthStatus = "ok" | "degraded";

export interface HealthResponse {
  readonly ok: true;
  readonly status: HealthStatus;
  readonly hostId: string;
  readonly version: string;
  readonly uptimeMs: number;
  readonly subsystems: {
    readonly walrusContent: SubsystemStatus;
    readonly memory: SubsystemStatus;
  };
}

export type SubsystemStatus = "ok" | "degraded" | "disabled";

export interface DescriptorRouteDeps {
  readonly config: HostServerConfig;
}

// H7: report a real `status`. A subsystem that is configured/required but failed
// to bootstrap makes the host `degraded`; subsystems that are simply not enabled
// are `disabled` and do not degrade the host.
export const handleHealth = (deps: DescriptorRouteDeps, nowMs = Date.now()): HealthResponse => {
  const walrusContent = deriveWalrusContentStatus(deps.config);
  const memory = deriveMemoryStatus(deps.config);
  const status: HealthStatus =
    walrusContent === "degraded" || memory === "degraded" ? "degraded" : "ok";

  return {
    ok: true,
    status,
    hostId: deps.config.hostId,
    version: "0.1.0",
    uptimeMs: Math.max(0, nowMs - deps.config.startedAtMs),
    subsystems: { walrusContent, memory }
  };
};

const deriveWalrusContentStatus = (config: HostServerConfig): SubsystemStatus => {
  if (!isWalrusEnabled(config)) {
    return "disabled";
  }
  return isWalrusBootstrapped(config) ? "ok" : "degraded";
};

// DB-backed memory has no external bootstrap: enabled == ok, disabled == not_configured.
const deriveMemoryStatus = (config: HostServerConfig): SubsystemStatus => {
  if (!isModuleEnabled(config, "memory")) {
    return "disabled";
  }
  return "ok";
};

export const handleDescriptor = (deps: DescriptorRouteDeps): HostProviderDescriptor =>
  toHostProviderDescriptor(deps.config);

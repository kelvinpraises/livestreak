import type { HostProviderDescriptor } from "@livestreak/host";
import type { HostServerConfig } from "../../config/host.js";
import {
  isModuleEnabled,
  toHostProviderDescriptor
} from "../../config/host.js";
import { Router } from "express";
import type { HostRouteDeps } from "../../deps.js";

// --- exports ---

export type HealthStatus = "ok" | "degraded";

export interface HealthResponse {
  readonly ok: true;
  readonly status: HealthStatus;
  readonly hostId: string;
  readonly version: string;
  readonly uptimeMs: number;
  readonly subsystems: {
    readonly content: SubsystemStatus;
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
  const content = deriveContentStatus(deps.config);
  const memory = deriveMemoryStatus(deps.config);
  const status: HealthStatus =
    content === "degraded" || memory === "degraded" ? "degraded" : "ok";

  return {
    ok: true,
    status,
    hostId: deps.config.hostId,
    version: "0.1.0",
    uptimeMs: Math.max(0, nowMs - deps.config.startedAtMs),
    subsystems: { content, memory }
  };
};

const deriveContentStatus = (config: HostServerConfig): SubsystemStatus => {
  if (!isModuleEnabled(config, "content")) return "disabled";
  return config.storage !== null && config.contentWriteToken !== null ? "ok" : "degraded";
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


// --- exports ---

export const createDescriptorRouter = (deps: Pick<HostRouteDeps, "config">): Router => {
  const router = Router();
  const handlers = createDescriptorHandlers(deps);

  router.get("/health", (_req, res) => handlers.health(_req, res));
  router.get("/descriptor", (_req, res) => handlers.descriptor(_req, res));

  return router;
};


// --- exports ---

export const createDescriptorHandlers = (deps: Pick<HostRouteDeps, "config">) => ({
  health: (_req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }): void => {
    res.status(200).json(handleHealth({ config: deps.config }));
  },

  descriptor: (_req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }): void => {
    res.status(200).json(handleDescriptor({ config: deps.config }));
  }
});

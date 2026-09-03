import type {
  HostCacheIntent,
  HostModuleToken,
  HostPolicyBlockReason,
  HostPolicyRequest,
  HostPolicyResult
} from "@livestreak/host";
import type { OutputMode } from "@livestreak/schema";
import type { HostServerConfig } from "../../config/host.js";
import { isModuleEnabled } from "../../config/host.js";

// --- exports ---

export interface PolicyEvaluatorState {
  readonly quotaRemainingBytes: number;
}

export interface PolicyEvaluatorDeps {
  readonly config: HostServerConfig;
  readonly state: PolicyEvaluatorState;
}

export const evaluateHostPolicy = (
  request: HostPolicyRequest,
  deps: PolicyEvaluatorDeps
): HostPolicyResult => {
  const { config, state } = deps;
  const mediaEnabled = isModuleEnabled(config, "media");
  const supportedOutputs = new Set<OutputMode>(config.supportedOutputs);
  const simulcastAvailable =
    mediaEnabled &&
    config.livekitApiKey !== undefined &&
    config.livekitApiKey.length > 0;
  const intent = requestCacheIntent(request);
  const required = cacheRequired(request, intent);
  const liveRequired = livePolicyRequired(request);
  const expectedDurationSeconds =
    request.expectedDurationSeconds ?? (liveRequired ? config.maxDurationSeconds : 0);
  const expectedCacheBytes = request.expectedCacheBytes ?? 0;
  const cacheAvailable = mediaEnabled;
  const blocks: HostPolicyBlockReason[] = [];
  const warnings: string[] = [];

  if (!supportedOutputs.has(request.outputMode as OutputMode)) {
    blocks.push("unsupported_output");
  }

  if (!mediaEnabled) {
    blocks.push("endpoint_manifests_unavailable");
  }

  if (required && !cacheAvailable) {
    blocks.push("host_cache_unavailable");
  }

  if (required && config.cacheReceipts === "none") {
    blocks.push("cache_receipts_unavailable");
  }

  if (request.outputMode === "simulcast" && !simulcastAvailable) {
    blocks.push("simulcast_unavailable");
  }

  if (required && expectedCacheBytes > state.quotaRemainingBytes) {
    blocks.push("cache_quota_exceeded");
  }

  if (
    liveRequired &&
    (expectedDurationSeconds < config.minDurationSeconds ||
      expectedDurationSeconds > config.maxDurationSeconds)
  ) {
    blocks.push("live_duration_out_of_range");
  }

  if (request.outputMode === "file" && !request.debug) {
    warnings.push("file output is treated as debug output");
  }

  const status = statusFromBlocks(blocks, warnings);

  return {
    descriptor: {
      hostId: config.hostId,
      accountTier: config.accountTier,
      supportedOutputs: [...config.supportedOutputs],
      debug: request.debug,
      cache: {
        available: cacheAvailable,
        quotaRemainingBytes: state.quotaRemainingBytes,
        retentionDays: config.cacheRetentionDays,
        receipts: config.cacheReceipts
      },
      live: {
        minDurationSeconds: config.minDurationSeconds,
        maxDurationSeconds: config.maxDurationSeconds
      },
      evaluation: {
        ruleSet: "livestreak-host-policy",
        status,
        warnings
      }
    },
    outputMode: request.outputMode,
    cache: {
      intent,
      required,
      maySkip: cacheMaySkip(request, required),
      available: cacheAvailable,
      expectedBytes: expectedCacheBytes,
      quotaRemainingBytes: state.quotaRemainingBytes
    },
    live: {
      required: liveRequired,
      available: simulcastAvailable,
      expectedDurationSeconds
    },
    blockReasons: blocks,
    constraints: []
  };
};

// --- helpers ---

const requestCacheIntent = (request: HostPolicyRequest): HostCacheIntent => {
  if (request.cacheIntent !== undefined) {
    return request.cacheIntent;
  }

  if (request.outputMode === "file") {
    return "none";
  }

  if (request.outputMode === "local" && request.debug) {
    return "optional";
  }

  return "required";
};

const cacheRequired = (request: HostPolicyRequest, intent: HostCacheIntent): boolean => {
  if (intent === "required") {
    return true;
  }

  if (request.outputMode === "simulcast") {
    return true;
  }

  return request.outputMode === "local" && !request.debug;
};

const cacheMaySkip = (request: HostPolicyRequest, required: boolean): boolean =>
  !required && (request.outputMode === "file" || (request.outputMode === "local" && request.debug));

const livePolicyRequired = (request: HostPolicyRequest): boolean =>
  request.outputMode === "simulcast" || (request.outputMode === "local" && !request.debug);

const statusFromBlocks = (
  blocks: readonly HostPolicyBlockReason[],
  warnings: readonly string[]
): HostPolicyResult["descriptor"]["evaluation"]["status"] => {
  if (blocks.length > 0) {
    return "blocked";
  }

  return warnings.length > 0 ? "warning" : "pass";
};

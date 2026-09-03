import { LiveStreakConfigError } from "@livestreak/core";
import {
  decodeMemoryAccessRequest,
  type MemoryAccessResponse,
  validationErrorMessage
} from "@livestreak/host";
import type { HostServerConfig } from "../../../config/host.js";
import { isMemoryBootstrapped, isMemoryHostConfigured } from "../../../config/host.js";
import type { MemoryBindingStore } from "./binding.js";

// --- exports ---

export interface MemoryRouteDeps {
  readonly config: HostServerConfig;
  readonly bindings: MemoryBindingStore;
}

export type MemoryAccessRouteResponse =
  | { readonly ok: true; readonly status: number; readonly result: MemoryAccessResponse }
  | { readonly ok: false; readonly status: number; readonly error: LiveStreakConfigError };

export const handleMemoryAccess = async (
  body: unknown,
  deps: MemoryRouteDeps
): Promise<MemoryAccessRouteResponse> => {
  if (!isMemoryHostConfigured(deps.config) || !isMemoryBootstrapped(deps.config)) {
    return memoryFailure(503, "memory_relayer_not_configured");
  }

  const resolved = deps.config.resolvedWalrus!;

  if (body === null || typeof body !== "object") {
    return memoryFailure(400, "Request body must be a JSON object");
  }

  const decoded = decodeMemoryAccessRequest(body);
  if (decoded._tag === "Left") {
    return memoryFailure(400, validationErrorMessage(decoded.left));
  }

  const { marketId, suiDelegate } = decoded.right;
  if (suiDelegate.length === 0) {
    return memoryFailure(400, "suiDelegate is required");
  }

  if (!isDelegatePublicKeyHex(suiDelegate)) {
    return memoryFailure(
      400,
      "suiDelegate must be a 32-byte Ed25519 public key encoded as 64 hex characters"
    );
  }

  try {
    const binding = await deps.bindings.provision(marketId);
    await deps.bindings.grantDelegate(marketId, suiDelegate);

    if (!deps.bindings.hasDelegate(binding.memWalAccountId, suiDelegate)) {
      return memoryFailure(503, "delegate_grant_failed");
    }

    return {
      ok: true,
      status: 200,
      result: {
        relayerUrl: resolved.memory.relayerUrl,
        namespace: binding.namespace,
        accountId: binding.memWalAccountId
      }
    };
  } catch (error) {
    return memoryFailure(503, error instanceof Error ? error.message : "memory_access_failed");
  }
};

// --- helpers ---

const memoryFailure = (status: number, message: string): MemoryAccessRouteResponse => ({
  ok: false,
  status,
  error: new LiveStreakConfigError({
    message,
    metadata: { retryable: false }
  })
});

const isDelegatePublicKeyHex = (value: string): boolean =>
  /^(?:0x)?[0-9a-fA-F]{64}$/u.test(value.trim());

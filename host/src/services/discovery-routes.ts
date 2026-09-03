import { LiveStreakConfigError } from "@livestreak/core";
import {
  decodeHostDiscoveryIndexRequest,
  decodeHostDiscoveryRequest,
  type HostSimilarityIndexRequest,
  type HostSimilarityResult,
  validationErrorMessage
} from "@livestreak/host";
import type { DiscoveryStore } from "./discovery.js";

// --- exports ---

export interface DiscoveryRouteDeps {
  readonly store: DiscoveryStore;
}

export type DiscoveryRouteResponse =
  | { readonly ok: true; readonly result: HostSimilarityResult }
  | { readonly ok: false; readonly status: number; readonly error: LiveStreakConfigError };

export type DiscoveryIndexRouteResponse =
  | { readonly ok: true; readonly result: HostSimilarityIndexRequest }
  | { readonly ok: false; readonly status: number; readonly error: LiveStreakConfigError };

export const handleIndexVault = (
  body: unknown,
  deps: DiscoveryRouteDeps
): DiscoveryIndexRouteResponse => {
  if (body === null || typeof body !== "object") {
    return discoveryIndexFailure("Request body must be a JSON object");
  }

  const decoded = decodeHostDiscoveryIndexRequest(body);
  if (decoded._tag === "Left") {
    return discoveryIndexFailure(validationErrorMessage(decoded.left));
  }

  deps.store.indexVault(decoded.right);

  return {
    ok: true,
    result: decoded.right
  };
};

export const handleFindSimilar = (
  body: unknown,
  deps: DiscoveryRouteDeps
): DiscoveryRouteResponse => {
  if (body === null || typeof body !== "object") {
    return discoveryFindFailure("Request body must be a JSON object");
  }

  const decoded = decodeHostDiscoveryRequest(body);
  if (decoded._tag === "Left") {
    return discoveryFindFailure(validationErrorMessage(decoded.left));
  }

  return {
    ok: true,
    result: deps.store.findSimilar(decoded.right)
  };
};

// --- helpers ---

const discoveryFindFailure = (message: string): DiscoveryRouteResponse => ({
  ok: false,
  status: 400,
  error: new LiveStreakConfigError({
    message,
    metadata: { retryable: false }
  })
});

const discoveryIndexFailure = (message: string): DiscoveryIndexRouteResponse => ({
  ok: false,
  status: 400,
  error: new LiveStreakConfigError({
    message,
    metadata: { retryable: false }
  })
});

import { LiveStreakConfigError } from "@livestreak/core";
import {
  decodeHostSimilarityIndexRequest,
  decodeHostSimilarityRequest,
  type HostSimilarityIndexRequest,
  type HostSimilarityResult,
  validationErrorMessage
} from "@livestreak/host";
import type { SimilarityStore } from "./store.js";

// --- exports ---

export interface SimilarityRouteDeps {
  readonly store: SimilarityStore;
}

export type SimilarityRouteResponse =
  | { readonly ok: true; readonly result: HostSimilarityResult }
  | { readonly ok: false; readonly status: number; readonly error: LiveStreakConfigError };

export type SimilarityIndexRouteResponse =
  | { readonly ok: true; readonly result: HostSimilarityIndexRequest }
  | { readonly ok: false; readonly status: number; readonly error: LiveStreakConfigError };

export const handleIndexVault = (
  body: unknown,
  deps: SimilarityRouteDeps
): SimilarityIndexRouteResponse => {
  if (body === null || typeof body !== "object") {
    return similarityIndexFailure("Request body must be a JSON object");
  }

  const decoded = decodeHostSimilarityIndexRequest(body);
  if (decoded._tag === "Left") {
    return similarityIndexFailure(validationErrorMessage(decoded.left));
  }

  deps.store.indexVault(decoded.right);

  return {
    ok: true,
    result: decoded.right
  };
};

export const handleFindSimilar = (
  body: unknown,
  deps: SimilarityRouteDeps
): SimilarityRouteResponse => {
  if (body === null || typeof body !== "object") {
    return similarityFindFailure("Request body must be a JSON object");
  }

  const decoded = decodeHostSimilarityRequest(body);
  if (decoded._tag === "Left") {
    return similarityFindFailure(validationErrorMessage(decoded.left));
  }

  return {
    ok: true,
    result: deps.store.findSimilar(decoded.right)
  };
};

// --- helpers ---

const similarityFindFailure = (message: string): SimilarityRouteResponse => ({
  ok: false,
  status: 400,
  error: new LiveStreakConfigError({
    message,
    metadata: { retryable: false }
  })
});

const similarityIndexFailure = (message: string): SimilarityIndexRouteResponse => ({
  ok: false,
  status: 400,
  error: new LiveStreakConfigError({
    message,
    metadata: { retryable: false }
  })
});

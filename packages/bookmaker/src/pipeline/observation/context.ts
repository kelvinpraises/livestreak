import type { BookmakerMarketContext } from "../../model/market-context.js";
import type { BookmakerWatchSource } from "../../model/watch-source.js";
import type { ValidationResult } from "../../model/validate.js";
import { validationFailure, validationSuccess } from "../../model/validate.js";

// --- exports ---

export interface ObservationSubscriptionInput {
  readonly marketId: string;
  readonly observeRunId: string;
  readonly watchUrl?: string;
  readonly webrtcUrl?: string;
  readonly observationEndpoint?: string;
  readonly endpointManifestUri?: string;
  readonly cacheReceiptRefs?: readonly string[];
  readonly evidenceRefs?: readonly string[];
}

export const buildObservationSubscriptionInput = (
  marketContext: BookmakerMarketContext,
  watchSource: BookmakerWatchSource
): ValidationResult<ObservationSubscriptionInput> => {
  if (watchSource.marketId !== marketContext.marketId) {
    return validationFailure(
      "watchSource.marketId must match marketContext.marketId",
      `watchSource.marketId=${watchSource.marketId}`,
      `marketContext.marketId=${marketContext.marketId}`
    );
  }

  return validationSuccess({
    marketId: marketContext.marketId,
    observeRunId: marketContext.observeRunId,
    ...(watchSource.watchUrl === undefined ? {} : { watchUrl: watchSource.watchUrl }),
    ...(watchSource.webrtcUrl === undefined ? {} : { webrtcUrl: watchSource.webrtcUrl }),
    ...(watchSource.observationEndpoint === undefined
      ? {}
      : { observationEndpoint: watchSource.observationEndpoint }),
    ...(mergedManifestUri(marketContext, watchSource) === undefined
      ? {}
      : { endpointManifestUri: mergedManifestUri(marketContext, watchSource) }),
    ...(watchSource.cacheReceiptRefs === undefined
      ? {}
      : { cacheReceiptRefs: watchSource.cacheReceiptRefs }),
    ...(marketContext.evidenceRefs === undefined ? {} : { evidenceRefs: marketContext.evidenceRefs })
  });
};

// --- helpers ---

const mergedManifestUri = (
  marketContext: BookmakerMarketContext,
  watchSource: BookmakerWatchSource
): string | undefined => watchSource.endpointManifestUri ?? marketContext.endpointManifestUri;

import { Schema } from "effect";
import { HostPolicyRequest } from "./media/policy.js";
import { HostCreateSessionRequest } from "./media/session.js";
import { HostCacheReceiptRequest } from "./media/evidence.js";
import { AaPaymasterRequest } from "./aa.js";
import { HostSimilarityIndexRequest, HostSimilarityRequest } from "./discovery.js";
import { MemoryAccessRequest } from "./memory.js";
import { ContentBlobStoreRequest } from "./walrus.js";

// --- exports ---

export const decodeHostPolicyRequest = Schema.decodeUnknownEither(HostPolicyRequest);

export const decodeHostCreateSessionRequest = Schema.decodeUnknownEither(HostCreateSessionRequest);

export const decodeHostCacheReceiptRequest = Schema.decodeUnknownEither(HostCacheReceiptRequest);

export const decodeAaPaymasterRequest = Schema.decodeUnknownEither(AaPaymasterRequest);

export const decodeHostDiscoveryRequest = Schema.decodeUnknownEither(HostSimilarityRequest);

export const decodeHostDiscoveryIndexRequest = Schema.decodeUnknownEither(HostSimilarityIndexRequest);

export const decodeMemoryAccessRequest = Schema.decodeUnknownEither(MemoryAccessRequest);

export const decodeContentBlobStoreRequest = Schema.decodeUnknownEither(ContentBlobStoreRequest);

export const validationErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Request body failed validation";
};

import { Schema } from "effect";
import { HostPolicyRequest } from "./policy.js";
import { HostCreateSessionRequest } from "./session.js";
import { HostCacheReceiptRequest } from "./cache.js";
import { ForumAppendMessageRequest, ForumCreateThreadRequest } from "./forum.js";
import { AaPaymasterRequest } from "./aa.js";
import { HostSimilarityIndexRequest, HostSimilarityRequest } from "./similarity.js";

// --- exports ---

export const decodeHostPolicyRequest = Schema.decodeUnknownEither(HostPolicyRequest);

export const decodeHostCreateSessionRequest = Schema.decodeUnknownEither(HostCreateSessionRequest);

export const decodeHostCacheReceiptRequest = Schema.decodeUnknownEither(HostCacheReceiptRequest);

export const decodeForumCreateThreadRequest = Schema.decodeUnknownEither(ForumCreateThreadRequest);

export const decodeForumAppendMessageRequest = Schema.decodeUnknownEither(ForumAppendMessageRequest);

export const decodeAaPaymasterRequest = Schema.decodeUnknownEither(AaPaymasterRequest);

export const decodeHostSimilarityRequest = Schema.decodeUnknownEither(HostSimilarityRequest);

export const decodeHostSimilarityIndexRequest = Schema.decodeUnknownEither(HostSimilarityIndexRequest);

export const validationErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Request body failed validation";
};

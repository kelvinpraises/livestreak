import { LiveStreakConfigError } from "@livestreak/core";
import {
  decodeHostCacheReceiptRequest,
  type HostCacheReceipt,
  type HostCacheReceiptSubmission,
  validationErrorMessage
} from "@livestreak/host";
import { randomUUID } from "node:crypto";
import type { HostServerConfig } from "../descriptor/config.js";
import { appendManifestCacheReceiptRef, type ManifestStore } from "../manifests/store.js";
import type { SessionStore } from "../sessions/store.js";
import type { CacheStore } from "./store.js";

// --- exports ---

export interface CacheRouteDeps {
  readonly config: HostServerConfig;
  readonly sessions: SessionStore;
  readonly manifests: ManifestStore;
  readonly cache: CacheStore;
}

export type CacheRouteSuccess = {
  readonly ok: true;
  readonly result: HostCacheReceiptSubmission;
};

export type CacheRouteFailure = {
  readonly ok: false;
  readonly status: number;
  readonly error: LiveStreakConfigError;
};

export type CacheRouteResponse = CacheRouteSuccess | CacheRouteFailure;

export const handleCacheReceipt = (
  sessionId: string | undefined,
  body: unknown,
  deps: CacheRouteDeps
): CacheRouteResponse => {
  if (sessionId === undefined || sessionId.length === 0) {
    return cacheFailure(400, "sessionId path parameter is required");
  }

  if (body === null || typeof body !== "object") {
    return cacheFailure(400, "Request body must be a JSON object");
  }

  const decoded = decodeHostCacheReceiptRequest(body);
  if (decoded._tag === "Left") {
    return cacheFailure(400, validationErrorMessage(decoded.left));
  }

  const request = decoded.right;
  if (request.sessionId !== sessionId) {
    return cacheFailure(
      400,
      `Request sessionId ${request.sessionId} does not match path sessionId ${sessionId}`
    );
  }

  const summary = deps.sessions.getSummary(sessionId);
  if (summary === undefined) {
    return cacheFailure(404, `No session found for sessionId ${sessionId}`);
  }

  if (request.contentId !== summary.contentId) {
    return cacheFailure(
      400,
      `Request contentId ${request.contentId} does not match session contentId ${summary.contentId}`
    );
  }

  if (request.observer !== summary.observer) {
    return cacheFailure(
      400,
      `Request observer ${request.observer} does not match session observer ${summary.observer}`
    );
  }

  if (!deps.config.capabilities.includes("host_cache")) {
    return cacheRouteSuccess(blockedSubmission(deps.cache.getQuotaRemainingBytes(), "host_cache_unavailable"));
  }

  if (deps.config.cacheReceipts === "none") {
    return cacheRouteSuccess(
      blockedSubmission(deps.cache.getQuotaRemainingBytes(), "cache_receipts_unavailable")
    );
  }

  const bytesStored = request.bytesStored ?? 0;
  const quotaRemainingBytes = deps.cache.getQuotaRemainingBytes();

  if (bytesStored > quotaRemainingBytes) {
    return cacheRouteSuccess(
      blockedSubmission(quotaRemainingBytes, "cache_quota_exceeded")
    );
  }

  const issuedAtMs = request.issuedAtMs ?? Date.now();
  const receiptId = `receipt_${randomUUID()}`;
  const receipt: HostCacheReceipt = {
    receiptId,
    hostId: deps.config.hostId,
    sessionId,
    evidence: request.evidence,
    status: "accepted",
    issuedAtMs,
    signature: `dev-stub-receipt:${deps.config.hostId}:${receiptId}`
  };

  const nextQuota = Math.max(0, quotaRemainingBytes - bytesStored);
  deps.cache.save(receipt);
  deps.cache.setQuotaRemainingBytes(nextQuota);

  const submission: HostCacheReceiptSubmission = {
    status: "accepted",
    receipt,
    quotaRemainingBytes: nextQuota
  };
  deps.cache.recordSubmission(submission);
  appendManifestCacheReceiptRef(deps.manifests, sessionId, receipt.receiptId);

  return cacheRouteSuccess(submission);
};

// --- helpers ---

const blockedSubmission = (
  quotaRemainingBytes: number,
  reason: NonNullable<HostCacheReceiptSubmission["reason"]>
): HostCacheReceiptSubmission => ({
  status: "blocked",
  receipt: null,
  quotaRemainingBytes,
  reason
});

const cacheRouteSuccess = (result: HostCacheReceiptSubmission): CacheRouteSuccess => ({
  ok: true,
  result
});

const cacheFailure = (status: number, message: string): CacheRouteFailure => ({
  ok: false,
  status,
  error: new LiveStreakConfigError({
    message,
    metadata: { retryable: false }
  })
});

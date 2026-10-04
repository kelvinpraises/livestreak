import { LiveStreakConfigError } from "@livestreak/core";
import {
  decodeHostCacheReceiptRequest,
  decodeHostCreateSessionRequest,
  decodeHostPolicyRequest,
  type EndpointManifest,
  type HostCacheReceipt,
  type HostCacheReceiptSubmission,
  type HostCreateSessionRequest,
  type HostPolicyRequest,
  type HostPolicyResult,
  type HostSessionDraft,
  type HostSessionResult,
  type HostSessionSummary,
  validationErrorMessage
} from "@livestreak/host";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import type { HostServerConfig } from "../../config/host.js";
import { isModuleEnabled } from "../../config/host.js";
import type { HostRouteDeps, MediaRouteDeps } from "../../deps.js";
import { asyncHandler, param, sendRouteResult } from "../../http/respond.js";
import {
  appendManifestCacheReceiptRef,
  buildSessionManifest,
  MANIFEST_UNSIGNED
} from "./manifest.js";
import { evaluateHostPolicy, type PolicyEvaluatorDeps } from "./policy.js";

// --- exports ---

export const createMediaRouter = (deps: Pick<HostRouteDeps, "config" | "media">): Router => {
  const router = Router();
  const handlers = createMediaHandlers(deps);

  router.post("/media/policy/evaluate", handlers.evaluatePolicy);
  router.post("/media/sessions", handlers.createSession);
  router.get("/media/sessions/:sessionId/manifest", handlers.getManifest);
  router.post("/media/sessions/:sessionId/cache-receipts", handlers.cacheReceipt);

  return router;
};


// --- exports ---

export type MediaSessionRouteResponse =
  | { readonly ok: true; readonly result: HostSessionResult }
  | { readonly ok: false; readonly status: number; readonly error: LiveStreakConfigError };

export type MediaManifestRouteResponse =
  | { readonly ok: true; readonly result: EndpointManifest }
  | { readonly ok: false; readonly status: number; readonly error: LiveStreakConfigError };

export type MediaCacheRouteResponse =
  | { readonly ok: true; readonly result: HostCacheReceiptSubmission }
  | { readonly ok: false; readonly status: number; readonly error: LiveStreakConfigError };

export const handleCreateSession = async (
  body: unknown,
  deps: MediaRouteDeps & { readonly config: HostServerConfig }
): Promise<MediaSessionRouteResponse> => {
  if (body === null || typeof body !== "object") {
    return routeFailure(400, "Request body must be a JSON object");
  }

  const decoded = decodeHostCreateSessionRequest(body);
  if (decoded._tag === "Left") {
    return routeFailure(400, validationErrorMessage(decoded.left));
  }

  const request = decoded.right;
  const policy = evaluateHostPolicy(toPolicyRequest(request), policyDeps(deps));

  if (policy.blockReasons.length > 0) {
    return routeFailure(
      400,
      `Session blocked by host policy: ${policy.blockReasons.join(", ")}`
    );
  }

  if (
    policy.descriptor.evaluation.status === "warning" &&
    request.allowWarnings !== true
  ) {
    return routeFailure(
      400,
      `Session has policy warnings and allowWarnings was not set: ${policy.descriptor.evaluation.warnings.join(", ")}`
    );
  }

  const nowMs = request.nowMs ?? Date.now();
  const draftShell = buildSessionDraftShell(request, deps.config, policy, nowMs);
  const manifest = buildSessionManifest(deps.config, draftShell, nowMs);


  const draft: HostSessionDraft = {
    ...draftShell,
    endpoints: manifest.endpoints,
    manifestDraft: manifest
  };
  const summary = buildSessionSummary(request, deps.config, nowMs);

  if (!deps.sessions.create(draft, summary)) {
    return routeFailure(409, `Session already exists for sessionId ${request.sessionId}`);
  }

  deps.manifests.save(manifest);

  return {
    ok: true,
    result: { summary, draft }
  };
};

export const handleGetManifest = (
  sessionId: string | undefined,
  deps: Pick<MediaRouteDeps, "sessions" | "manifests">
): MediaManifestRouteResponse => {
  if (sessionId === undefined || sessionId.length === 0) {
    return routeFailure(400, "sessionId path parameter is required");
  }

  if (deps.sessions.get(sessionId) === undefined) {
    return routeFailure(404, `No session found for sessionId ${sessionId}`);
  }

  const manifest = deps.manifests.getBySessionId(sessionId);
  if (manifest === undefined) {
    return routeFailure(404, `No manifest found for sessionId ${sessionId}`);
  }

  return { ok: true, result: manifest };
};

export const handleCacheReceipt = (
  sessionId: string | undefined,
  body: unknown,
  deps: MediaRouteDeps & { readonly config: HostServerConfig }
): MediaCacheRouteResponse => {
  if (sessionId === undefined || sessionId.length === 0) {
    return routeFailure(400, "sessionId path parameter is required");
  }

  if (body === null || typeof body !== "object") {
    return routeFailure(400, "Request body must be a JSON object");
  }

  const decoded = decodeHostCacheReceiptRequest(body);
  if (decoded._tag === "Left") {
    return routeFailure(400, validationErrorMessage(decoded.left));
  }

  const request = decoded.right;
  if (request.sessionId !== sessionId) {
    return routeFailure(
      400,
      `Request sessionId ${request.sessionId} does not match path sessionId ${sessionId}`
    );
  }

  const summary = deps.sessions.getSummary(sessionId);
  if (summary === undefined) {
    return routeFailure(404, `No session found for sessionId ${sessionId}`);
  }

  if (request.contentId !== summary.contentId) {
    return routeFailure(
      400,
      `Request contentId ${request.contentId} does not match session contentId ${summary.contentId}`
    );
  }

  if (request.observer !== summary.observer) {
    return routeFailure(
      400,
      `Request observer ${request.observer} does not match session observer ${summary.observer}`
    );
  }

  if (!isModuleEnabled(deps.config, "media")) {
    return cacheSuccess(blockedSubmission(deps.evidence.getQuotaRemainingBytes(), "host_cache_unavailable"));
  }

  if (deps.config.cacheReceipts === "none") {
    return cacheSuccess(
      blockedSubmission(deps.evidence.getQuotaRemainingBytes(), "cache_receipts_unavailable")
    );
  }

  const bytesStored = request.bytesStored ?? 0;
  const quotaRemainingBytes = deps.evidence.getQuotaRemainingBytes();

  if (bytesStored > quotaRemainingBytes) {
    return cacheSuccess(blockedSubmission(quotaRemainingBytes, "cache_quota_exceeded"));
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
    // Cache receipts are NOT host-signed yet (no receipt-signing key wired, no
    // consumer verifies this). The schema requires a non-empty `signature`, so emit
    // the explicit unsigned marker rather than a signature-shaped string. When
    // receipt signing lands, sign the canonical receipt bytes with a host key.
    signature: MANIFEST_UNSIGNED
  };

  const nextQuota = Math.max(0, quotaRemainingBytes - bytesStored);
  deps.evidence.save(receipt);
  deps.evidence.setQuotaRemainingBytes(nextQuota);

  const submission: HostCacheReceiptSubmission = {
    status: "accepted",
    receipt,
    quotaRemainingBytes: nextQuota
  };
  deps.evidence.recordSubmission(submission);
  appendManifestCacheReceiptRef(deps.manifests, sessionId, receipt.receiptId);

  return cacheSuccess(submission);
};

const policyEvaluatorState = (deps: Pick<HostRouteDeps, "config" | "media">) => ({
  quotaRemainingBytes: deps.media.evidence.getQuotaRemainingBytes()
});

export const createMediaHandlers = (deps: Pick<HostRouteDeps, "config" | "media">) => ({
  evaluatePolicy: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(
      res,
      handlePolicyEvaluate(req.body, {
        config: deps.config,
        state: policyEvaluatorState(deps)
      }),
      next
    );
  }),

  createSession: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(
      res,
      await handleCreateSession(req.body, {
        ...deps.media,
        config: deps.config
      }),
      next,
      201
    );
  }),

  getManifest: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(res, handleGetManifest(param(req.params.sessionId), deps.media), next);
  }),

  cacheReceipt: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(
      res,
      handleCacheReceipt(param(req.params.sessionId), req.body, {
        ...deps.media,
        config: deps.config
      }),
      next
    );
  })
});

// --- helpers ---

type MediaRouteFailure = {
  readonly ok: false;
  readonly status: number;
  readonly error: LiveStreakConfigError;
};

const routeFailure = (status: number, message: string): MediaRouteFailure => ({
  ok: false,
  status,
  error: new LiveStreakConfigError({
    message,
    metadata: { retryable: false }
  })
});

const policyDeps = (deps: MediaRouteDeps & { readonly config: HostServerConfig }): PolicyEvaluatorDeps => ({
  config: deps.config,
  state: { quotaRemainingBytes: deps.evidence.getQuotaRemainingBytes() }
});

const toPolicyRequest = (request: HostCreateSessionRequest): HostPolicyRequest => ({
  outputMode: request.outputMode,
  debug: request.debug,
  contentId: request.contentId,
  observer: request.observer,
  sessionId: request.sessionId,
  expectedDurationSeconds: request.expectedDurationSeconds,
  expectedCacheBytes: request.expectedCacheBytes,
  cacheIntent: request.cacheIntent
});

const buildSessionDraftShell = (
  request: HostCreateSessionRequest,
  config: HostServerConfig,
  policy: HostSessionDraft["policy"],
  nowMs: number
): HostSessionDraft => ({
  sessionId: request.sessionId,
  endpoints: [],
  manifestDraft: {
    version: "0.1.0",
    manifestId: `manifest_${request.sessionId}`,
    sessionId: request.sessionId,
    observer: request.observer,
    contentId: request.contentId,
    hostId: config.hostId,
    endpoints: [],
    hostPolicyStatus: policy.descriptor.evaluation.status,
    cacheReceiptRefs: [],
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + 60 * 60 * 1000,
    // Draft shell only — handleCreateSession overwrites manifestDraft with the real
    // buildSessionManifest output before persisting. Still emit the explicit unsigned
    // marker (never a signature-shaped string) for the transient draft.
    signature: MANIFEST_UNSIGNED
  },
  policy
});

const buildSessionSummary = (
  request: HostCreateSessionRequest,
  config: HostServerConfig,
  nowMs: number
): HostSessionSummary => ({
  sessionId: request.sessionId,
  hostId: config.hostId,
  observer: request.observer,
  contentId: request.contentId,
  outputMode: request.outputMode,
  status: "active",
  createdAtMs: nowMs
});

const blockedSubmission = (
  quotaRemainingBytes: number,
  reason: NonNullable<HostCacheReceiptSubmission["reason"]>
): HostCacheReceiptSubmission => ({
  status: "blocked",
  receipt: null,
  quotaRemainingBytes,
  reason
});

const cacheSuccess = (result: HostCacheReceiptSubmission): MediaCacheRouteResponse => ({
  ok: true,
  result
});

export type PolicyRouteDeps = PolicyEvaluatorDeps;

export type PolicyRouteResponse =
  | { readonly ok: true; readonly result: HostPolicyResult }
  | { readonly ok: false; readonly status: number; readonly error: LiveStreakConfigError };

export const handlePolicyEvaluate = (
  body: unknown,
  deps: PolicyRouteDeps
): PolicyRouteResponse => {
  if (body === null || typeof body !== "object") {
    return policyConfigFailure("Request body must be a JSON object");
  }

  const decoded = decodeHostPolicyRequest(body);
  if (decoded._tag === "Left") {
    return policyConfigFailure(validationErrorMessage(decoded.left));
  }

  return {
    ok: true,
    result: evaluateHostPolicy(decoded.right, deps)
  };
};

const policyConfigFailure = (message: string): PolicyRouteResponse => ({
  ok: false,
  status: 400,
  error: new LiveStreakConfigError({
    message,
    metadata: { retryable: false }
  })
});

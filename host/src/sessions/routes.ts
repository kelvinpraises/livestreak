import { LiveStreakConfigError } from "@livestreak/core";
import {
  decodeHostCreateSessionRequest,
  type EndpointManifest,
  type HostCreateSessionRequest,
  type HostPolicyRequest,
  type HostSessionDraft,
  type HostSessionResult,
  type HostSessionSummary,
  validationErrorMessage
} from "@livestreak/host";
import type { HostServerConfig } from "../descriptor/config.js";
import { buildDevManifest, type ManifestStore } from "../manifests/store.js";
import type { CacheStore } from "../cache/store.js";
import { evaluateHostPolicy, type PolicyEvaluatorDeps } from "../policy/evaluate.js";
import type { SessionStore } from "./store.js";

// --- exports ---

export interface SessionRouteDeps {
  readonly config: HostServerConfig;
  readonly sessions: SessionStore;
  readonly manifests: ManifestStore;
  readonly cache: CacheStore;
}

export type SessionRouteSuccess = {
  readonly ok: true;
  readonly result: HostSessionResult;
};

export type SessionRouteFailure = {
  readonly ok: false;
  readonly status: number;
  readonly error: LiveStreakConfigError;
};

export type SessionRouteResponse = SessionRouteSuccess | SessionRouteFailure;

export type ManifestRouteSuccess = {
  readonly ok: true;
  readonly result: EndpointManifest;
};

export type ManifestRouteFailure = {
  readonly ok: false;
  readonly status: number;
  readonly error: LiveStreakConfigError;
};

export type ManifestRouteResponse = ManifestRouteSuccess | ManifestRouteFailure;

export const handleCreateSession = (
  body: unknown,
  deps: SessionRouteDeps
): SessionRouteResponse => {
  if (body === null || typeof body !== "object") {
    return sessionFailure(400, "Request body must be a JSON object");
  }

  const decoded = decodeHostCreateSessionRequest(body);
  if (decoded._tag === "Left") {
    return sessionFailure(400, validationErrorMessage(decoded.left));
  }

  const request = decoded.right;
  const policy = evaluateHostPolicy(toPolicyRequest(request), policyDeps(deps));

  if (policy.blockReasons.length > 0) {
    return sessionFailure(
      400,
      `Session blocked by host policy: ${policy.blockReasons.join(", ")}`
    );
  }

  if (
    policy.descriptor.evaluation.status === "warning" &&
    request.allowWarnings !== true
  ) {
    return sessionFailure(
      400,
      `Session has policy warnings and allowWarnings was not set: ${policy.descriptor.evaluation.warnings.join(", ")}`
    );
  }

  const nowMs = request.nowMs ?? Date.now();
  const draftShell = buildSessionDraftShell(request, deps.config, policy, nowMs);
  const manifest = buildDevManifest(deps.config, draftShell, nowMs);
  const draft: HostSessionDraft = {
    ...draftShell,
    endpoints: manifest.endpoints,
    manifestDraft: manifest
  };
  const summary = buildSessionSummary(request, deps.config, nowMs);

  if (!deps.sessions.create(draft, summary)) {
    return sessionFailure(409, `Session already exists for sessionId ${request.sessionId}`);
  }

  deps.manifests.save(manifest);

  return {
    ok: true,
    result: {
      summary,
      draft
    }
  };
};

export const handleGetManifest = (
  sessionId: string | undefined,
  deps: Pick<SessionRouteDeps, "sessions" | "manifests">
): ManifestRouteResponse => {
  if (sessionId === undefined || sessionId.length === 0) {
    return manifestFailure(400, "sessionId path parameter is required");
  }

  if (deps.sessions.get(sessionId) === undefined) {
    return manifestFailure(404, `No session found for sessionId ${sessionId}`);
  }

  const manifest = deps.manifests.getBySessionId(sessionId);
  if (manifest === undefined) {
    return manifestFailure(404, `No manifest found for sessionId ${sessionId}`);
  }

  return {
    ok: true,
    result: manifest
  };
};

// --- helpers ---

const policyDeps = (deps: SessionRouteDeps): PolicyEvaluatorDeps => ({
  config: deps.config,
  state: {
    quotaRemainingBytes: deps.cache.getQuotaRemainingBytes()
  }
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
    signature: `dev-stub-signature:${config.hostId}:pending`
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

const sessionFailure = (status: number, message: string): SessionRouteFailure => ({
  ok: false,
  status,
  error: new LiveStreakConfigError({
    message,
    metadata: { retryable: false }
  })
});

const manifestFailure = (status: number, message: string): ManifestRouteFailure => ({
  ok: false,
  status,
  error: new LiveStreakConfigError({
    message,
    metadata: { retryable: false }
  })
});

import { LiveStreakConfigError } from "@livestreak/core";
import {
  decodeHostPolicyRequest,
  type HostPolicyRequest,
  type HostPolicyResult,
  validationErrorMessage
} from "@livestreak/host";
import { evaluateHostPolicy, type PolicyEvaluatorDeps } from "./evaluate.js";

// --- exports ---

export type PolicyRouteDeps = PolicyEvaluatorDeps;

export type PolicyRouteSuccess = {
  readonly ok: true;
  readonly result: HostPolicyResult;
};

export type PolicyRouteFailure = {
  readonly ok: false;
  readonly status: number;
  readonly error: LiveStreakConfigError;
};

export type PolicyRouteResponse = PolicyRouteSuccess | PolicyRouteFailure;

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

export const isPolicyBlocked = (request: HostPolicyRequest, deps: PolicyRouteDeps): boolean => {
  const result = evaluateHostPolicy(request, deps);
  return result.blockReasons.length > 0;
};

// --- helpers ---

const policyConfigFailure = (message: string): PolicyRouteFailure => ({
  ok: false,
  status: 400,
  error: new LiveStreakConfigError({
    message,
    metadata: { retryable: false }
  })
});

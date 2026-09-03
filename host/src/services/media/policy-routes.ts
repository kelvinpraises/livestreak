import { LiveStreakConfigError } from "@livestreak/core";
import {
  decodeHostPolicyRequest,
  type HostPolicyRequest,
  type HostPolicyResult,
  validationErrorMessage
} from "@livestreak/host";
import { evaluateHostPolicy, type PolicyEvaluatorDeps } from "./policy.js";

// --- exports ---

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

export const isPolicyBlocked = (request: HostPolicyRequest, deps: PolicyRouteDeps): boolean => {
  const result = evaluateHostPolicy(request, deps);
  return result.blockReasons.length > 0;
};

// --- helpers ---

const policyConfigFailure = (message: string): PolicyRouteResponse => ({
  ok: false,
  status: 400,
  error: new LiveStreakConfigError({
    message,
    metadata: { retryable: false }
  })
});

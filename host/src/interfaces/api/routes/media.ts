import { jsonFailure, jsonSuccess } from "../response.js";
import type { HostRouteDeps } from "../deps.js";
import type { RouteDefinition } from "../types.js";
import { handlePolicyEvaluate } from "../../../services/media/policy-routes.js";
import {
  handleCacheReceipt,
  handleCreateSession,
  handleGetManifest
} from "../../../services/media/routes.js";

// --- exports ---

const policyEvaluatorState = (deps: HostRouteDeps) => ({
  quotaRemainingBytes: deps.media.evidence.getQuotaRemainingBytes()
});

export const mediaRoutes = (): RouteDefinition[] => [
  {
    method: "POST",
    pattern: /^\/media\/policy\/evaluate$/u,
    handler: ({ body, deps: routeDeps }) => {
      const result = handlePolicyEvaluate(body, {
        config: routeDeps.config,
        state: policyEvaluatorState(routeDeps)
      });

      if (!result.ok) {
        return jsonFailure(result.status, result.error);
      }

      return jsonSuccess(200, result.result);
    }
  },
  {
    method: "POST",
    pattern: /^\/media\/sessions$/u,
    handler: async ({ body, deps: routeDeps }) => {
      const result = await handleCreateSession(body, {
        ...routeDeps.media,
        config: routeDeps.config
      });

      if (!result.ok) {
        return jsonFailure(result.status, result.error);
      }

      return jsonSuccess(201, result.result);
    }
  },
  {
    method: "GET",
    pattern: /^\/media\/sessions\/(?<sessionId>[^/]+)\/manifest$/u,
    handler: ({ params, deps: routeDeps }) => {
      const result = handleGetManifest(params.sessionId, routeDeps.media);

      if (!result.ok) {
        return jsonFailure(result.status, result.error);
      }

      return jsonSuccess(200, result.result);
    }
  },
  {
    method: "POST",
    pattern: /^\/media\/sessions\/(?<sessionId>[^/]+)\/cache-receipts$/u,
    handler: ({ params, body, deps: routeDeps }) => {
      const result = handleCacheReceipt(params.sessionId, body, {
        ...routeDeps.media,
        config: routeDeps.config
      });

      if (!result.ok) {
        return jsonFailure(result.status, result.error);
      }

      return jsonSuccess(200, result.result);
    }
  }
];

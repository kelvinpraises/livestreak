import { jsonFailure, jsonSuccess } from "../response.js";
import type { RouteDefinition } from "../types.js";
import { handleFindSimilar, handleIndexVault } from "../../../services/discovery-routes.js";

// --- exports ---

export const discoveryRoutes = (): RouteDefinition[] => [
  {
    method: "POST",
    pattern: /^\/discovery\/vaults$/u,
    handler: ({ body, deps: routeDeps }) => {
      const result = handleIndexVault(body, routeDeps.discovery);

      if (!result.ok) {
        return jsonFailure(result.status, result.error);
      }

      return jsonSuccess(201, result.result);
    }
  },
  {
    method: "POST",
    pattern: /^\/discovery\/find$/u,
    handler: ({ body, deps: routeDeps }) => {
      const result = handleFindSimilar(body, routeDeps.discovery);

      if (!result.ok) {
        return jsonFailure(result.status, result.error);
      }

      return jsonSuccess(200, result.result);
    }
  }
];

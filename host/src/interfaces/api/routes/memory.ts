import { jsonFailure, jsonSuccess } from "../response.js";
import type { RouteDefinition } from "../types.js";
import { handleMemoryAccess } from "../../../services/walrus/memory/routes.js";

// --- exports ---

export const memoryRoutes = (): RouteDefinition[] => [
  {
    method: "POST",
    pattern: /^\/memory\/access$/u,
    handler: async ({ body, deps: routeDeps }) => {
      const result = await handleMemoryAccess(body, {
        config: routeDeps.config,
        bindings: routeDeps.walrus.memory.bindings
      });

      if (!result.ok) {
        return jsonFailure(result.status, result.error);
      }

      return jsonSuccess(result.status, result.result);
    }
  }
];

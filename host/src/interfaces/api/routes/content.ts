import { jsonFailure, jsonSuccess } from "../response.js";
import type { RouteDefinition } from "../types.js";
import {
  handleContentBlobResolve,
  handleContentBlobStore
} from "../../../services/walrus/content/routes.js";

// --- exports ---

export const contentRoutes = (): RouteDefinition[] => [
  {
    method: "POST",
    pattern: /^\/content\/blobs$/u,
    handler: async ({ body, deps: routeDeps }) => {
      const result = await handleContentBlobStore(body, {
        config: routeDeps.config,
        store: routeDeps.walrus.content.store
      });

      if (!result.ok) {
        return jsonFailure(result.status, result.error);
      }

      return jsonSuccess(result.status, result.result);
    }
  },
  {
    method: "GET",
    pattern: /^\/content\/blobs\/(?<scheme>[^/]+)\/(?<id>[^/]+)$/u,
    handler: async ({ params, deps: routeDeps }) => {
      const scheme = params.scheme ?? "";
      const id = params.id ?? "";
      const result = await handleContentBlobResolve(scheme, id, {
        config: routeDeps.config,
        store: routeDeps.walrus.content.store
      });

      if (!result.ok) {
        return jsonFailure(result.status, result.error);
      }

      return jsonSuccess(result.status, result.result);
    }
  }
];

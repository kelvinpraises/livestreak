import { createAaRouteDeps, handleAaDescriptor, handleBundlerRpc, handlePaymasterRpc, type CreateAaRouteDepsOptions } from "../aa/routes.js";
import { defaultHostServerConfig, type HostServerConfig } from "../descriptor/config.js";
import { handleDescriptor, handleHealth } from "../descriptor/routes.js";
import { handlePolicyEvaluate } from "../policy/routes.js";
import { handleCacheReceipt } from "../cache/routes.js";
import { createCacheStore } from "../cache/store.js";
import { createForumStore } from "../forum/store.js";
import {
  handleAppendMessage,
  handleCreateThread,
  handleGetThread
} from "../forum/routes.js";
import { createManifestStore } from "../manifests/store.js";
import { handleCreateSession, handleGetManifest } from "../sessions/routes.js";
import { createSessionStore } from "../sessions/store.js";
import { createSimilarityStore } from "../similarity/store.js";
import { handleFindSimilar, handleIndexVault } from "../similarity/routes.js";
import { jsonFailure, jsonSuccess, type JsonResponse } from "./http.js";

// --- exports ---

export interface RouteContext {
  readonly params: Record<string, string | undefined>;
  readonly body: unknown;
  readonly deps: HostRouteDeps;
}

export type RouteHandler = (context: RouteContext) => Promise<JsonResponse<unknown>> | JsonResponse<unknown>;

export interface RouteDefinition {
  readonly method: string;
  readonly pattern: RegExp;
  readonly handler: RouteHandler;
}

export interface MatchedRoute {
  readonly route: RouteDefinition;
  readonly params: Record<string, string | undefined>;
}

export interface HostRouteDeps {
  readonly config: HostServerConfig;
  readonly sessions: ReturnType<typeof createSessionStore>;
  readonly manifests: ReturnType<typeof createManifestStore>;
  readonly cache: ReturnType<typeof createCacheStore>;
  readonly forum: ReturnType<typeof createForumStore>;
  readonly similarity: ReturnType<typeof createSimilarityStore>;
  readonly aa: ReturnType<typeof createAaRouteDeps>;
}

export const createHostRouteDeps = (
  config: HostServerConfig = defaultHostServerConfig(),
  aaOptions: CreateAaRouteDepsOptions = {}
): HostRouteDeps => ({
  config,
  sessions: createSessionStore(),
  manifests: createManifestStore(),
  cache: createCacheStore(config.cacheQuotaBytes),
  forum: createForumStore(),
  similarity: createSimilarityStore(),
  aa: createAaRouteDeps(config, aaOptions)
});

const policyEvaluatorState = (deps: HostRouteDeps) => ({
  quotaRemainingBytes: deps.cache.getQuotaRemainingBytes()
});

export const createHostRoutes = (): RouteDefinition[] => [
  {
    method: "GET",
    pattern: /^\/health$/u,
    handler: ({ deps }) => jsonSuccess(200, handleHealth({ config: deps.config }))
  },
  {
    method: "GET",
    pattern: /^\/descriptor$/u,
    handler: ({ deps }) => jsonSuccess(200, handleDescriptor({ config: deps.config }))
  },
  {
    method: "POST",
    pattern: /^\/policy\/evaluate$/u,
    handler: ({ body, deps }) => {
      const result = handlePolicyEvaluate(body, {
        config: deps.config,
        state: policyEvaluatorState(deps)
      });

      if (!result.ok) {
        return jsonFailure(result.status, result.error);
      }

      return jsonSuccess(200, result.result);
    }
  },
  {
    method: "GET",
    pattern: /^\/aa\/descriptor$/u,
    handler: ({ deps }) => jsonSuccess(200, handleAaDescriptor(deps.aa))
  },
  {
    method: "POST",
    pattern: /^\/sessions$/u,
    handler: ({ body, deps }) => {
      const result = handleCreateSession(body, {
        config: deps.config,
        sessions: deps.sessions,
        manifests: deps.manifests,
        cache: deps.cache
      });

      if (!result.ok) {
        return jsonFailure(result.status, result.error);
      }

      return jsonSuccess(201, result.result);
    }
  },
  {
    method: "GET",
    pattern: /^\/sessions\/(?<sessionId>[^/]+)\/manifest$/u,
    handler: ({ params, deps }) => {
      const result = handleGetManifest(params.sessionId, {
        sessions: deps.sessions,
        manifests: deps.manifests
      });

      if (!result.ok) {
        return jsonFailure(result.status, result.error);
      }

      return jsonSuccess(200, result.result);
    }
  },
  {
    method: "POST",
    pattern: /^\/sessions\/(?<sessionId>[^/]+)\/cache-receipts$/u,
    handler: ({ params, body, deps }) => {
      const result = handleCacheReceipt(params.sessionId, body, {
        config: deps.config,
        sessions: deps.sessions,
        manifests: deps.manifests,
        cache: deps.cache
      });

      if (!result.ok) {
        return jsonFailure(result.status, result.error);
      }

      return jsonSuccess(200, result.result);
    }
  },
  {
    method: "POST",
    pattern: /^\/similarity\/vaults$/u,
    handler: ({ body, deps }) => {
      const result = handleIndexVault(body, { store: deps.similarity });

      if (!result.ok) {
        return jsonFailure(result.status, result.error);
      }

      return jsonSuccess(201, result.result);
    }
  },
  {
    method: "POST",
    pattern: /^\/similarity\/find$/u,
    handler: ({ body, deps }) => {
      const result = handleFindSimilar(body, { store: deps.similarity });

      if (!result.ok) {
        return jsonFailure(result.status, result.error);
      }

      return jsonSuccess(200, result.result);
    }
  },
  {
    method: "POST",
    pattern: /^\/forum\/threads$/u,
    handler: ({ body, deps }) => {
      const result = handleCreateThread(body, { store: deps.forum });

      if (!result.ok) {
        return jsonFailure(result.status, result.error);
      }

      return jsonSuccess(201, result.result);
    }
  },
  {
    method: "GET",
    pattern: /^\/forum\/threads\/(?<threadId>[^/]+)$/u,
    handler: ({ params, deps }) => {
      const result = handleGetThread(params.threadId, { store: deps.forum });

      if (!result.ok) {
        return jsonFailure(result.status, result.error);
      }

      return jsonSuccess(200, result.result);
    }
  },
  {
    method: "POST",
    pattern: /^\/forum\/threads\/(?<threadId>[^/]+)\/messages$/u,
    handler: ({ params, body, deps }) => {
      const result = handleAppendMessage(params.threadId, body, { store: deps.forum });

      if (!result.ok) {
        return jsonFailure(result.status, result.error);
      }

      return jsonSuccess(200, result.result);
    }
  },
  {
    method: "POST",
    pattern: /^\/aa\/bundler\/(?<chain>[^/]+)$/u,
    handler: ({ params, body }) => handleBundlerRpc(params.chain, body)
  },
  {
    method: "POST",
    pattern: /^\/aa\/paymaster\/(?<chain>[^/]+)$/u,
    handler: ({ params, body, deps }) => handlePaymasterRpc(params.chain, body, deps.aa)
  }
];

export { routeNotFound } from "./http.js";

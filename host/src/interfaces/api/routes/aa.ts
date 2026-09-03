import { handleBundlerRpc, handlePaymasterRpc } from "../../../services/aa/routes.js";
import type { RouteDefinition } from "../types.js";

// --- exports ---

export const aaRoutes = (): RouteDefinition[] => [
  {
    method: "POST",
    pattern: /^\/aa\/bundler\/(?<chain>[^/]+)$/u,
    handler: ({ params, body, deps }) => handleBundlerRpc(params.chain, body, deps.aa.aa)
  },
  {
    method: "POST",
    pattern: /^\/aa\/paymaster\/(?<chain>[^/]+)$/u,
    handler: ({ params, body, deps }) => handlePaymasterRpc(params.chain, body, deps.aa)
  }
];

import { handleAaDescriptor } from "../../../services/aa/routes.js";
import { handleDescriptor, handleHealth } from "../../../services/descriptor.js";
import { jsonSuccess } from "../response.js";
import type { RouteDefinition } from "../types.js";

// --- exports ---

export const descriptorRoutes = (): RouteDefinition[] => [
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
    method: "GET",
    pattern: /^\/aa\/descriptor$/u,
    handler: ({ deps }) => jsonSuccess(200, handleAaDescriptor(deps.aa))
  }
];

import type { HostRouteDeps } from "./deps.js";
import type { JsonResponse } from "./response.js";

// --- exports ---

export interface RouteContext {
  readonly params: Record<string, string | undefined>;
  readonly body: unknown;
  readonly deps: HostRouteDeps;
}

export type RouteHandler = (
  context: RouteContext
) => Promise<JsonResponse<unknown>> | JsonResponse<unknown>;

export interface RouteDefinition {
  readonly method: string;
  readonly pattern: RegExp;
  readonly handler: RouteHandler;
}

export interface MatchedRoute {
  readonly route: RouteDefinition;
  readonly params: Record<string, string | undefined>;
}

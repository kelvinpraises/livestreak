import type { HostModuleToken } from "@livestreak/host";
import type { RouteDefinition } from "./types.js";

// --- exports ---

export interface HostModuleRegistration {
  readonly token: HostModuleToken;
  readonly enabled: boolean;
  readonly routes: readonly RouteDefinition[];
}

export const mountEnabledRoutes = (
  modules: readonly HostModuleRegistration[]
): RouteDefinition[] => modules.filter((module) => module.enabled).flatMap((module) => module.routes);

export const enabledModuleTokens = (
  modules: readonly HostModuleRegistration[]
): HostModuleToken[] => modules.filter((module) => module.enabled).map((module) => module.token);

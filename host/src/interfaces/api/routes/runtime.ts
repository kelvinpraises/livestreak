import { runtimeNotEnabled } from "../../../services/runtime.js";
import { stubRoutes } from "../router-stubs.js";
import type { RouteDefinition } from "../types.js";

// --- exports ---

export const runtimeRoutes = (): RouteDefinition[] =>
  stubRoutes("runtime", runtimeNotEnabled().message);

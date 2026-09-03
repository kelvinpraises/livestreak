import { tenancyNotEnabled } from "../../../services/tenancy.js";
import { stubRoutes } from "../router-stubs.js";
import type { RouteDefinition } from "../types.js";

// --- exports ---

export const tenancyRoutes = (): RouteDefinition[] =>
  stubRoutes("tenancy", tenancyNotEnabled().message);

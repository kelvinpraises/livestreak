import { LiveStreakConfigError } from "@livestreak/core";
import { jsonFailure } from "./response.js";
import type { RouteDefinition } from "./types.js";

// --- exports ---

export const stubRoutes = (module: string, message: string): RouteDefinition[] => [
  {
    method: "POST",
    pattern: new RegExp(`^\\/${module}\\/.*$`, "u"),
    handler: () =>
      jsonFailure(
        501,
        new LiveStreakConfigError({
          message,
          metadata: { retryable: false }
        })
      )
  }
];

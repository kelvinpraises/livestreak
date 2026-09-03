import { LiveStreakConfigError } from "@livestreak/core";

// --- exports ---

export const tenancyNotEnabled = (): LiveStreakConfigError =>
  new LiveStreakConfigError({
    message: "Tenancy is not enabled",
    metadata: { retryable: false }
  });

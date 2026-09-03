import { LiveStreakConfigError } from "@livestreak/core";

// --- exports ---

export const runtimeNotEnabled = (): LiveStreakConfigError =>
  new LiveStreakConfigError({
    message: "TEE agent hosting is not enabled",
    metadata: { retryable: false }
  });

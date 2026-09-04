import { LiveStreakConfigError } from "@livestreak/core";

// --- exports ---

export const resolveSuiOwnerPrivateKey = async (): Promise<string> => {
  throw new LiveStreakConfigError({
    message: "Sui wallet not ready: @livestreak/wallet Sui support pending",
    metadata: { retryable: false }
  });
};

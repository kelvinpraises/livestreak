// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import type { BookmakerChain } from "../types.js";

const notImplemented = (operation: string): (() => Promise<never>) => async () => {
  throw new LiveStreakConfigError({
    message: `Sui bookmaker chain: ${operation} is not implemented`
  });
};

export const createSuiBookmakerChain = (): BookmakerChain => ({
  reader: {
    marketExists: notImplemented("marketExists")
  },
  writer: {
    createVault: notImplemented("createVault")
  }
});

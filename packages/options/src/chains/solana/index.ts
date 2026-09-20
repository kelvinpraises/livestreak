// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import type { OptionsChain, OptionsChainConfig } from "../types.js";
import { resolveSolanaContext } from "./config.js";
import { createSolanaOptionsReader } from "./reader.js";
import { createSolanaOptionsWriter } from "./writer.js";

export type { OptionsSolanaAddresses } from "./addresses.js";
export { validateOptionsSolanaAddresses } from "./addresses.js";
export { resolveSolanaAccountAddress } from "./account.js";

export const createSolanaOptionsChain = (config: OptionsChainConfig): OptionsChain => {
  if (config.walletInit.chain !== "solana") {
    throw new LiveStreakConfigError({
      message: "Solana options chain requires walletInit.chain === solana"
    });
  }

  const ctx = resolveSolanaContext(config);

  return {
    reader: createSolanaOptionsReader(ctx, {
      includeProtocolSummary: config.includeProtocolSummary
    }),
    writer: createSolanaOptionsWriter(config)
  };
};

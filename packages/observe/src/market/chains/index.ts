import { Effect } from "effect";
import { LiveStreakConfigError } from "@livestreak/core";
import type { WalletInit } from "@livestreak/schema";
import type { MarketRegistrar, ObserveRunMarketConfig } from "#market/types.js";
import { createEvmMarketRegistrar } from "./evm.js";
import { createSuiMarketRegistrar } from "./sui.js";

export const createMarketRegistrar = (
  config: ObserveRunMarketConfig
): Effect.Effect<MarketRegistrar, LiveStreakConfigError> => {
  const walletInit = config.walletInit;

  switch (walletInit.chain) {
    case "evm": {
      return Effect.succeed(createEvmMarketRegistrar({ ...config, walletInit }));
    }
    case "sui": {
      void walletInit;
      return Effect.succeed(createSuiMarketRegistrar());
    }
    default: {
      return Effect.fail(
        new LiveStreakConfigError({
          message: `Unsupported wallet chain for market registration: ${String((walletInit as WalletInit).chain)}`
        })
      );
    }
  }
};


import { Effect } from "effect";
import { LiveStreakConfigError } from "@livestreak/core";
import type { MarketRegistrar } from "#market/types.js";

export const createSuiMarketRegistrar = (): MarketRegistrar => ({
  registerMarket: () =>
    Effect.fail(
      new LiveStreakConfigError({
        message: "Sui market registration is not supported: no Sui MarketRegistry exists yet"
      })
    )
});

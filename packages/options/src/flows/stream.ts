// --- exports ---

import type { MarketId, OptionsStreamState } from "../model/index.js";
import type { OptionsReader } from "../chains/types.js";

export const readStreamState = async (
  reader: OptionsReader,
  marketId: MarketId
): Promise<OptionsStreamState> => reader.readStreamState(marketId);

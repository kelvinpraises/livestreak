// --- exports ---

import type { MarketId, OptionsMediaResolvers, OptionsStreamMedia } from "../model/index.js";
import { resolveStreamMedia } from "../model/index.js";
import type { OptionsReadTransport } from "./transport.js";

export const getStreamMedia = async (
  transport: OptionsReadTransport,
  marketId: MarketId,
  resolvers?: Partial<OptionsMediaResolvers>
): Promise<OptionsStreamMedia> => {
  const state = await transport.readStreamState(marketId);
  return resolveStreamMedia(state, resolvers);
};

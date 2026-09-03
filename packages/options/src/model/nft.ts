// --- exports ---

import type { MarketId, TokenId, UserAddress } from "./ids.js";
import type { OptionsLane } from "./lane.js";

export interface OptionsNft {
  readonly tokenId: TokenId;
  readonly owner: UserAddress;
  readonly marketId: MarketId;
  readonly laneCount: number;
  readonly lanes: readonly OptionsLane[];
  readonly approved?: UserAddress;
  readonly isOperator?: boolean;
}

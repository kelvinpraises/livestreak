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
  /** Shared Drips account balance (USDC raw units). Available when the chain exposes streaming state. */
  readonly balance?: bigint;
  /** Account-level runway: seconds-since-epoch*1000 when balance runs out. Available when the chain exposes streaming state. */
  readonly runwayEndMs?: number;
}

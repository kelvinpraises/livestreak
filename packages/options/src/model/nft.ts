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
  /** Shared Drips account balance (USDC raw units). EVM only; undefined on Sui. */
  readonly balance?: bigint;
  /** Account-level runway: seconds-since-epoch*1000 when balance runs out. EVM only; undefined on Sui. */
  readonly runwayEndMs?: number;
}

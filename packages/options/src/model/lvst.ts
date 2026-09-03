// --- exports ---

import type { UserAddress } from "./ids.js";

export interface LvstAccount {
  readonly account: UserAddress;
  readonly balance: bigint;
  readonly staked: bigint;
  readonly pendingDividends: bigint;
  readonly totalEarned?: bigint;
  readonly lossClaims?: {
    readonly claimable: bigint;
    readonly claimed: bigint;
    readonly stakedFromClaims: bigint;
  };
}

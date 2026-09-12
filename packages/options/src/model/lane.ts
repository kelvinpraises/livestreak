// --- exports ---

import type { TokenId, VaultId } from "./ids.js";
import type { OptionsVaultSide } from "./vault.js";

export interface OptionsLane {
  readonly tokenId: TokenId;
  readonly vaultId: VaultId;
  readonly side: OptionsVaultSide;
  readonly rate: bigint;
  /** On-chain lane rate, retained even when depleted (effective `rate` is 0 then). Lets a setLanes
   *  rebuild re-assert depleted lanes instead of dropping them — see runtime `existingLaneWrites`. */
  readonly committedRate: bigint;
  readonly gPaid: bigint;
  readonly sharesAccrued: bigint;
  readonly maxEndMs?: number;
  readonly depleted: boolean;
  readonly claimable?: bigint;
  readonly lossClaimable?: bigint;
  readonly won?: boolean;
}

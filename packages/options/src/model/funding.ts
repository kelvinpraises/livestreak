// --- exports ---

import type { UserAddress, VaultId } from "./ids.js";
import type { OptionsVaultSide } from "./vault.js";

export interface OptionsFundingStream {
  readonly account: UserAddress;
  readonly vaultId: VaultId;
  readonly side: OptionsVaultSide;
  readonly ratePerSecond: bigint;
  readonly ratePerMinute: bigint;
  readonly active: boolean;
  readonly updatedAtMs?: number;
}

export const isFundingStreamPaused = (stream: OptionsFundingStream): boolean =>
  stream.ratePerSecond === 0n && stream.ratePerMinute === 0n;

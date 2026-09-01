// --- exports ---

import type { UserAddress, VaultId } from "./ids.js";
import type { OptionsVaultSide } from "./vault.js";

export interface OptionsSidePosition {
  readonly side: OptionsVaultSide;
  readonly streamed: bigint;
  readonly shares: bigint;
  readonly currentValue: bigint;
  readonly claimable: bigint;
  readonly released: boolean;
  readonly lossClaimable?: bigint;
}

export interface OptionsUserVaultPosition {
  readonly account: UserAddress;
  readonly vaultId: VaultId;
  readonly positions: {
    readonly yes: OptionsSidePosition;
    readonly no: OptionsSidePosition;
  };
}

export const emptySidePosition = (side: OptionsVaultSide): OptionsSidePosition => ({
  side,
  streamed: 0n,
  shares: 0n,
  currentValue: 0n,
  claimable: 0n,
  released: false,
  lossClaimable: 0n
});

export const hasVaultExposure = (position: OptionsUserVaultPosition): boolean =>
  position.positions.yes.streamed > 0n ||
  position.positions.yes.shares > 0n ||
  position.positions.no.streamed > 0n ||
  position.positions.no.shares > 0n;

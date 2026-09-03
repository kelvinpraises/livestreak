// --- exports ---

import type { MarketId, TokenId, UserAddress, VaultId } from "./ids.js";
import type { OptionsVaultSide, OptionsVaultStatus } from "./vault.js";

export interface OptionsClaimEntry {
  readonly tokenId: TokenId;
  readonly vaultId: VaultId;
  readonly marketId: MarketId;
  readonly status: OptionsVaultStatus;
  readonly side: OptionsVaultSide;
  readonly claimableUSDC: string;
  readonly lossClaimableLVST: string;
  readonly won?: boolean;
  readonly canClaimWin: boolean;
  readonly canClaimLoss: boolean;
}

export interface OptionsClaimsView {
  readonly account: UserAddress;
  readonly claims: readonly OptionsClaimEntry[];
}

export type UserVaultClaimRow = {
  readonly tokenId: TokenId;
  readonly vaultId: VaultId;
  readonly marketId: MarketId;
  readonly status: OptionsVaultStatus;
  readonly side: OptionsVaultSide;
  readonly winningSide?: OptionsVaultSide;
  readonly claimable: bigint;
  readonly lossClaimable: bigint;
  readonly won?: boolean;
};

export const projectClaimsView = (
  account: UserAddress,
  rows: readonly UserVaultClaimRow[]
): OptionsClaimsView => ({
  account,
  claims: rows.map((row) => ({
    tokenId: row.tokenId,
    vaultId: row.vaultId,
    marketId: row.marketId,
    status: row.status,
    side: row.side,
    claimableUSDC: row.claimable.toString(),
    lossClaimableLVST: row.lossClaimable.toString(),
    ...(row.won === undefined ? {} : { won: row.won }),
    canClaimWin: row.claimable > 0n,
    canClaimLoss: row.lossClaimable > 0n
  }))
});

// --- exports ---

import type {
  LvstAccount,
  MarketId,
  OptionsBoardState,
  OptionsMarket,
  OptionsNft,
  OptionsProtocolSummary,
  OptionsStreamState,
  TokenId,
  UserAddress,
  VaultId
} from "../model/index.js";
import type { OptionsVault, OptionsVaultShareTotals, OptionsVaultSide } from "../model/vault.js";

export interface OptionsReadTransport {
  readMarket(marketId: MarketId): Promise<OptionsMarket>;
  readStreamState(marketId: MarketId): Promise<OptionsStreamState>;
  listMarketVaults(marketId: MarketId): Promise<readonly VaultId[]>;
  readVault(vaultId: VaultId): Promise<OptionsVault>;
  readVaultShareTotals(vaultId: VaultId): Promise<OptionsVaultShareTotals>;
  listOwnerTokens(owner: UserAddress): Promise<readonly TokenId[]>;
  readNft(tokenId: TokenId, owner: UserAddress): Promise<OptionsNft>;
  readLvstAccount(user: UserAddress): Promise<LvstAccount>;
  readClaimable(tokenId: TokenId, vaultId: VaultId, side: OptionsVaultSide): Promise<bigint>;
  readLossClaimable(tokenId: TokenId, vaultId: VaultId, side: OptionsVaultSide): Promise<bigint>;
  readPot(vaultId: VaultId): Promise<bigint>;
  readCollected(vaultId: VaultId): Promise<boolean>;
  readAccountVaultIds(tokenId: TokenId): Promise<readonly VaultId[]>;
  readWinningSide(vaultId: VaultId): Promise<OptionsVaultSide | undefined>;
  readBoard(vaultId: VaultId, side: OptionsVaultSide): Promise<OptionsBoardState>;
  readSharePrice(vaultId: VaultId, side: OptionsVaultSide): Promise<bigint>;
  readPendingShares(
    vaultId: VaultId,
    side: OptionsVaultSide,
    tokenId: TokenId
  ): Promise<bigint>;
  readUsdcAddress(): Promise<`0x${string}`>;
  readNftBalance(tokenId: TokenId): Promise<bigint>;
  readOwnerOf(tokenId: TokenId): Promise<UserAddress>;
  readApproved(tokenId: TokenId): Promise<UserAddress | undefined>;
  readIsApprovedForAll(owner: UserAddress, operator: UserAddress): Promise<boolean>;
  readProtocolSummary?(): Promise<OptionsProtocolSummary>;
}

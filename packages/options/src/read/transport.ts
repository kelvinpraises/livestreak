// --- exports ---

import type {
  LvstAccount,
  MarketId,
  OptionsFundingStream,
  OptionsMarket,
  OptionsUserVaultPosition,
  OptionsVault,
  OptionsVaultSide,
  UserAddress,
  VaultId
} from "../model/index.js";
import type { OptionsProtocolSummary } from "../model/snapshot.js";

export interface OptionsReadTransport {
  readMarket(marketId: MarketId): Promise<OptionsMarket>;
  listMarketVaults(marketId: MarketId): Promise<readonly VaultId[]>;
  readVault(vaultId: VaultId): Promise<OptionsVault>;
  readUserVaultPosition(
    user: UserAddress,
    vaultId: VaultId
  ): Promise<OptionsUserVaultPosition>;
  readFundingStream(
    user: UserAddress,
    vaultId: VaultId,
    side: OptionsVaultSide
  ): Promise<OptionsFundingStream>;
  readLvstAccount(user: UserAddress): Promise<LvstAccount>;
  readProtocolSummary?(): Promise<OptionsProtocolSummary>;
}

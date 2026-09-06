// --- exports ---

import type { WalletInit } from "@livestreak/schema";

import type { LvstAccount } from "../model/lvst.js";
import type {
  MarketId,
  TokenId,
  UserAddress,
  VaultId
} from "../model/ids.js";
import type { OptionsBoardState } from "../model/math/accrual.js";
import type { OptionsMarket } from "../model/market.js";
import type { OptionsNft } from "../model/nft.js";
import type { OptionsProtocolSummary } from "../model/snapshot.js";
import type { OptionsStreamState } from "../model/stream.js";
import type {
  OptionsVault,
  OptionsVaultShareTotals,
  OptionsVaultSide
} from "../model/vault.js";
import type { OptionsContractAddresses } from "./evm/addresses.js";
import type { OptionsSuiObjectIds } from "./sui/addresses.js";

export type TxId = string & { readonly __brand: "TxId" };

export const asTxId = (hash: string): TxId => hash as TxId;

export type MintNftInput = {
  readonly marketId: MarketId;
  readonly to: UserAddress;
};

export type MintWithSaltInput = {
  readonly marketId: MarketId;
  readonly salt: bigint; // uint64 — deterministic tokenId salt (MarketDriver.mintWithSalt / calcTokenIdWithSalt)
  readonly to: UserAddress;
};

// A write that CREATES an addressable entity returns both the tx id and the new entity's id, so the
// CLI/app get the tokenId without a follow-up read.
export type MintResult = {
  readonly txId: TxId;
  readonly tokenId: TokenId;
};

export type FundStreamInput = {
  readonly tokenId: TokenId;
  readonly vaultId: VaultId;
  readonly side: OptionsVaultSide;
  readonly rate: bigint;
  readonly deposit: bigint;
};

export type LaneWriteInput = {
  readonly vaultId: VaultId;
  readonly side: OptionsVaultSide;
  readonly rate: bigint;
};

export type SetLanesInput = {
  readonly tokenId: TokenId;
  readonly lanes: readonly LaneWriteInput[];
  readonly addDeposit: bigint;
};

export type StopFundingInput = {
  readonly tokenId: TokenId;
  readonly vaultId: VaultId;
  readonly side: OptionsVaultSide;
};

export type StopAllFundingInput = {
  readonly tokenId: TokenId;
};

export type WithdrawInput = {
  readonly tokenId: TokenId;
  readonly vaultId: VaultId;
  readonly to: UserAddress;
};

export type WithdrawManyInput = {
  readonly tokenId: TokenId;
  readonly vaultIds: readonly VaultId[];
  readonly to: UserAddress;
};

export type ClaimLossLvstInput = {
  readonly tokenId: TokenId;
  readonly vaultId: VaultId;
  readonly side: OptionsVaultSide;
  readonly to: UserAddress;
};

export type StakeLvstInput = {
  readonly amount: bigint;
};

export type UnstakeLvstInput = {
  readonly amount: bigint;
};

export type TransferNftInput = {
  readonly from: UserAddress;
  readonly to: UserAddress;
  readonly tokenId: TokenId;
};

export type ApproveNftInput = {
  readonly operator: UserAddress;
  readonly tokenId: TokenId;
};

export type SetApprovalForAllInput = {
  readonly operator: UserAddress;
  readonly approved: boolean;
};

export type AdvanceInput = {
  readonly vaultId: VaultId;
  readonly side: OptionsVaultSide;
  readonly maxSteps?: bigint;
};

export interface OptionsReader {
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
  readPendingBoundaries(vaultId: VaultId, side: OptionsVaultSide): Promise<bigint>;
  readPendingShares(
    vaultId: VaultId,
    side: OptionsVaultSide,
    tokenId: TokenId
  ): Promise<bigint>;
  readUsdcAddress(): Promise<`0x${string}`>;
  readUsdcBalance(owner: UserAddress): Promise<bigint>;
  readNftBalance(tokenId: TokenId): Promise<bigint>;
  readOwnerOf(tokenId: TokenId): Promise<UserAddress>;
  readApproved(tokenId: TokenId): Promise<UserAddress | undefined>;
  readIsApprovedForAll(owner: UserAddress, operator: UserAddress): Promise<boolean>;
  readProtocolSummary?(): Promise<OptionsProtocolSummary>;
}

export interface OptionsWriter {
  mint(input: MintNftInput): Promise<MintResult>;
  mintWithSalt(input: MintWithSaltInput): Promise<MintResult>;
  fund(input: FundStreamInput): Promise<TxId>;
  advance(input: AdvanceInput): Promise<TxId>;
  setLanes(input: SetLanesInput): Promise<TxId>;
  stopFunding(input: StopFundingInput): Promise<TxId>;
  stopAllFunding(input: StopAllFundingInput): Promise<TxId>;
  withdraw(input: WithdrawInput): Promise<TxId>;
  withdrawMany(input: WithdrawManyInput): Promise<TxId>;
  claimLossLvst(input: ClaimLossLvstInput): Promise<TxId>;
  stakeLvst(input: StakeLvstInput): Promise<TxId>;
  unstakeLvst(input: UnstakeLvstInput): Promise<TxId>;
  claimDividends(): Promise<TxId>;
  transferNft(input: TransferNftInput): Promise<TxId>;
  approveNft(input: ApproveNftInput): Promise<TxId>;
  setApprovalForAll(input: SetApprovalForAllInput): Promise<TxId>;
}

export type OptionsChain = {
  readonly reader: OptionsReader;
  readonly writer: OptionsWriter;
};

export type ContractChain = "evm" | "sui" | "solana";

export type OptionsChainConfig = {
  readonly walletInit: WalletInit;
  readonly seed: string | Uint8Array;
  readonly addresses: OptionsContractAddresses | OptionsSuiObjectIds;
  readonly readRpcUrl?: string;
  readonly includeProtocolSummary?: boolean;
  readonly transferOperator?: UserAddress;
  readonly autoAdvanceOverflow?: boolean;
};

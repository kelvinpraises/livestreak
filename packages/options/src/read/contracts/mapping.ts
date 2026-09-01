// --- exports ---

import { sideFromSolidityValue } from "./sides.js";

import { asMarketId, asUserAddress, asVaultId } from "../../model/ids.js";
import { emptySidePosition } from "../../model/position.js";
import type { LvstAccount } from "../../model/lvst.js";
import type { OptionsFundingStream } from "../../model/funding.js";
import type { MarketId, UserAddress, VaultId } from "../../model/ids.js";
import type { OptionsMarket } from "../../model/market.js";
import type { OptionsProtocolSummary } from "../../model/snapshot.js";
import type { OptionsSidePosition, OptionsUserVaultPosition } from "../../model/position.js";
import type {
  OptionsVault,
  OptionsVaultOutcome,
  OptionsVaultPools,
  OptionsVaultSide,
  OptionsVaultStatus,
  OptionsVaultStewardState,
  OptionsVaultTiming
} from "../../model/vault.js";

export type RawMarketData = {
  readonly id: `0x${string}`;
  readonly title: string;
  readonly streamId: `0x${string}`;
  readonly createdAt: bigint;
  readonly exists: boolean;
};

export type RawVaultData = {
  readonly id: `0x${string}`;
  readonly marketId: `0x${string}`;
  readonly question: string;
  readonly creator: `0x${string}`;
  readonly status: number;
  readonly outcome: number;
  readonly yesPool: bigint;
  readonly noPool: bigint;
  readonly exists: boolean;
};

export type RawSidePosition = {
  readonly shares: bigint;
  readonly deposited: bigint;
};

export type RawHotState = {
  readonly active: boolean;
  readonly until: bigint;
  readonly severity: number;
  readonly reasonHash: `0x${string}`;
};

export type RawDisputeState = {
  readonly active: boolean;
  readonly challengeUntil: bigint;
  readonly proofRef: `0x${string}`;
};

const VAULT_STATUSES = ["open", "hot", "locked", "resolved", "disputed"] as const satisfies readonly OptionsVaultStatus[];
const VAULT_OUTCOMES = ["pending", "yes", "no"] as const satisfies readonly OptionsVaultOutcome[];

export const bytes32ToHex = (value: `0x${string}` | string): string => {
  const normalized = value.toLowerCase();
  return normalized.startsWith("0x") ? normalized : `0x${normalized}`;
};

export const mapMarket = (
  marketId: MarketId,
  data: RawMarketData,
  vaultIds: readonly VaultId[]
): OptionsMarket => ({
  marketId,
  title: data.title,
  streamId: bytes32ToHex(data.streamId),
  status: "open",
  vaultIds,
  timing: {
    createdAtMs: Number(data.createdAt) * 1000
  }
});

export const mapVaultIds = (ids: readonly `0x${string}`[]): readonly VaultId[] =>
  ids.map((id) => asVaultId(bytes32ToHex(id)));

export const mapVault = (
  data: RawVaultData,
  hot?: RawHotState,
  dispute?: RawDisputeState
): OptionsVault => {
  const timing: OptionsVaultTiming = {
    createdAtMs: 0,
    expiresAtMs: 0
  };

  const steward: OptionsVaultStewardState = {
    hot: hot?.active ?? false,
    hotUntilMs: hot?.active ? Number(hot.until) * 1000 : undefined,
    disputeId: dispute?.active ? bytes32ToHex(dispute.proofRef) : undefined
  };

  const pools: OptionsVaultPools = {
    yes: data.yesPool,
    no: data.noPool
  };

  return {
    vaultId: asVaultId(bytes32ToHex(data.id)),
    marketId: asMarketId(bytes32ToHex(data.marketId)),
    question: data.question,
    type: "timing",
    creator: data.creator,
    status: VAULT_STATUSES[data.status] ?? "open",
    outcome: VAULT_OUTCOMES[data.outcome] ?? "pending",
    pools,
    timing,
    steward
  };
};

export const mapSidePosition = (side: OptionsVaultSide, data: RawSidePosition): OptionsSidePosition => {
  if (data.shares === 0n && data.deposited === 0n) {
    return emptySidePosition(side);
  }

  return {
    side,
    streamed: data.deposited,
    shares: data.shares,
    currentValue: data.deposited,
    claimable: 0n,
    released: false,
    lossClaimable: 0n
  };
};

export const mapUserVaultPosition = (
  user: UserAddress,
  vaultId: VaultId,
  yes: RawSidePosition,
  no: RawSidePosition
): OptionsUserVaultPosition => ({
  account: user,
  vaultId,
  positions: {
    yes: mapSidePosition("yes", yes),
    no: mapSidePosition("no", no)
  }
});

export const mapFundingStream = (
  user: UserAddress,
  vaultId: VaultId,
  side: OptionsVaultSide,
  ratePerSecond: bigint,
  active: boolean
): OptionsFundingStream => ({
  account: user,
  vaultId,
  side,
  ratePerSecond,
  ratePerMinute: ratePerSecond * 60n,
  active
});

export const mapLvstAccount = (
  user: UserAddress,
  balance: bigint,
  staked: bigint
): LvstAccount => ({
  account: user,
  balance,
  staked,
  pendingDividends: 0n,
  lossClaims: {
    claimable: 0n,
    claimed: 0n,
    stakedFromClaims: 0n
  }
});

export const mapProtocolSummary = (
  marketCount: bigint,
  vaultCount: number
): OptionsProtocolSummary => ({
  marketCount: Number(marketCount),
  vaultCount
});

export const soliditySideToOptionsSide = (value: number): OptionsVaultSide =>
  sideFromSolidityValue(value);

// --- exports ---

import type { PointerScheme } from "@livestreak/host";

import { LiveStreakConfigError, LiveStreakRuntimeError } from "@livestreak/core";

import { sideFromSolidityValue } from "./encode.js";
import type { OptionsStreamState } from "../../model/stream.js";

import { asMarketId, asTokenId, asUserAddress, asVaultId } from "../../model/ids.js";
import type { LvstAccount } from "../../model/lvst.js";
import type { OptionsLane } from "../../model/lane.js";
import type { MarketId, TokenId, UserAddress, VaultId } from "../../model/ids.js";
import type { OptionsMarket } from "../../model/market.js";
import type { OptionsNft } from "../../model/nft.js";
import type { OptionsProtocolSummary } from "../../model/snapshot.js";
import type {
  OptionsVault,
  OptionsVaultOutcome,
  OptionsVaultPools,
  OptionsVaultShareTotals,
  OptionsVaultSide,
  OptionsVaultStatus,
  OptionsVaultStewardState,
  OptionsVaultTiming
} from "../../model/vault.js";

export type RawMarketData = {
  readonly id: `0x${string}`;
  readonly title: string;
  readonly streamId: `0x${string}`;
  readonly creator: `0x${string}`;
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
  readonly resolvedAt: number;
  readonly exists: boolean;
};

export type RawVaultPools = {
  readonly yesTotal: bigint;
  readonly noTotal: bigint;
  readonly yesShareTotal: bigint;
  readonly noShareTotal: bigint;
};

export type RawStreamState = {
  readonly status: number;
  readonly scheme: number;
  readonly id: string;
  readonly updatedAt: bigint;
  readonly endedAt: bigint;
};

export type RawLane = {
  readonly vaultId: `0x${string}`;
  readonly side: number;
  readonly rate: bigint;
};

export type RawPosition = {
  readonly rate: bigint;
  readonly gPaid: bigint;
  readonly sharesAccrued: bigint;
  readonly maxEnd: number;
  readonly depleted: boolean;
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
const STREAM_STATUSES = ["none", "live", "ended"] as const;
const STORAGE_SCHEMES = [
  "walrus-testnet",
  "walrus-mainnet",
  "ipfs",
  "arweave"
] as const satisfies readonly PointerScheme[];

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
  creator: asUserAddress(data.creator),
  streamId: bytes32ToHex(data.streamId),
  status: "open",
  vaultIds,
  timing: {
    createdAtMs: Number(data.createdAt) * 1000
  }
});

export const mapVaultIds = (ids: readonly `0x${string}`[]): readonly VaultId[] =>
  ids.map((id) => asVaultId(bytes32ToHex(id)));

export const mapVaultPools = (data: RawVaultPools): OptionsVaultPools => ({
  yes: data.yesTotal,
  no: data.noTotal
});

export const mapVaultShareTotals = (data: RawVaultPools): OptionsVaultShareTotals => ({
  yes: data.yesShareTotal,
  no: data.noShareTotal
});

export const mapStreamState = (data: RawStreamState): OptionsStreamState => {
  const status = STREAM_STATUSES[data.status];
  const scheme = STORAGE_SCHEMES[data.scheme];

  if (status === undefined || scheme === undefined) {
    throw new LiveStreakConfigError({
      message: "Invalid stream state from contracts",
      metadata: { details: `status=${data.status} scheme=${data.scheme}` }
    });
  }

  return {
    status,
    scheme,
    id: data.id,
    updatedAtMs: Number(data.updatedAt) * 1000,
    endedAtMs: Number(data.endedAt) * 1000
  };
};

export const mapVault = (
  data: RawVaultData,
  pools: RawVaultPools,
  hot?: RawHotState,
  dispute?: RawDisputeState
): OptionsVault => {
  const timing: OptionsVaultTiming = {
    createdAtMs: 0,
    expiresAtMs: 0,
    ...(data.resolvedAt > 0 ? { resolvedAtMs: data.resolvedAt * 1000 } : {})
  };

  const steward: OptionsVaultStewardState = {
    hot: hot?.active ?? false,
    hotUntilMs: hot?.active ? Number(hot.until) * 1000 : undefined,
    severity: hot?.active ? hot.severity : undefined,
    disputeId: dispute?.active ? bytes32ToHex(dispute.proofRef) : undefined
  };

  return {
    vaultId: asVaultId(bytes32ToHex(data.id)),
    marketId: asMarketId(bytes32ToHex(data.marketId)),
    question: data.question,
    type: "timing",
    creator: data.creator,
    status: VAULT_STATUSES[data.status] ?? "open",
    outcome: VAULT_OUTCOMES[data.outcome] ?? "pending",
    pools: mapVaultPools(pools),
    timing,
    steward
  };
};

export const mapLane = (
  tokenId: TokenId,
  lane: RawLane,
  position: RawPosition
): OptionsLane => ({
  tokenId,
  vaultId: asVaultId(bytes32ToHex(lane.vaultId)),
  side: sideFromSolidityValue(lane.side),
  rate: lane.rate,
  gPaid: position.gPaid,
  sharesAccrued: position.sharesAccrued,
  maxEndMs: position.maxEnd > 0 ? position.maxEnd * 1000 : undefined,
  depleted: position.depleted
});

export const enrichLane = (
  lane: OptionsLane,
  claimable: bigint,
  lossClaimable: bigint,
  winningSide?: OptionsVaultSide
): OptionsLane => ({
  ...lane,
  claimable,
  lossClaimable,
  ...(winningSide === undefined ? {} : { won: lane.side === winningSide })
});

export type RawBoard = {
  readonly pool: bigint;
  readonly sideRate: bigint;
  readonly g: bigint;
  readonly lastAdvance: number;
};

export const mapBoard = (data: RawBoard) => ({
  pool: data.pool,
  sideRate: data.sideRate,
  g: data.g,
  lastAdvanceMs: data.lastAdvance * 1000
});

export const mapNft = (
  tokenId: TokenId,
  owner: UserAddress,
  marketId: MarketId,
  laneCount: number,
  lanes: readonly OptionsLane[],
  transfer?: { readonly approved?: UserAddress; readonly isOperator?: boolean }
): OptionsNft => ({
  tokenId,
  owner,
  marketId,
  laneCount,
  lanes,
  ...(transfer?.approved === undefined ? {} : { approved: transfer.approved }),
  ...(transfer?.isOperator === undefined ? {} : { isOperator: transfer.isOperator })
});

export type RawStreamsState = {
  readonly streamsHash: `0x${string}`;
  readonly streamsHistoryHash: `0x${string}`;
  readonly updateTime: number;
  readonly balance: bigint;
  readonly maxEnd: number;
};

export const mapStreamsStateBalance = (state: RawStreamsState): bigint => state.balance;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const mapApprovedAddress = (value: `0x${string}`): UserAddress | undefined => {
  if (value.toLowerCase() === ZERO_ADDRESS) {
    return undefined;
  }

  return asUserAddress(value);
};

export const mapLvstAccount = (
  user: UserAddress,
  balance: bigint,
  staked: bigint,
  pendingDividends: bigint
): LvstAccount => ({
  account: user,
  balance,
  staked,
  pendingDividends
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

export type ContractsReadEntity =
  | "market"
  | "vault"
  | "vault share totals"
  | "owner tokens"
  | "nft"
  | "LVST account"
  | "protocol summary"
  | "claimable"
  | "loss claimable"
  | "pot"
  | "collected"
  | "account vault ids"
  | "winning side"
  | "board"
  | "share price"
  | "pending shares"
  | "USDC address"
  | "USDC balance"
  | "NFT balance"
  | "ownerOf"
  | "getApproved"
  | "isApprovedForAll"
  | "stream state";

export const contractsReadNotFound = (
  entity: ContractsReadEntity,
  id: string
): LiveStreakConfigError =>
  new LiveStreakConfigError({
    message: `${entity} not found`,
    metadata: { details: id }
  });

export const contractsReadFailed = (
  entity: ContractsReadEntity,
  cause: unknown
): LiveStreakRuntimeError =>
  new LiveStreakRuntimeError({
    message: `Failed to read ${entity} from contracts`,
    metadata: { cause, retryable: true }
  });

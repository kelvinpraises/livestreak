// --- exports ---

import { bcs } from "@livestreak/wallet";
import type { PointerScheme } from "@livestreak/host";

import { LiveStreakConfigError, LiveStreakRuntimeError } from "@livestreak/core";
import { asMarketId, asUserAddress, asVaultId } from "../../model/ids.js";
import { WAD } from "../../model/math/curve.js";
import type { LvstAccount } from "../../model/lvst.js";
import type { OptionsLane } from "../../model/lane.js";
import type { MarketId, TokenId, UserAddress, VaultId } from "../../model/ids.js";
import type { OptionsMarket } from "../../model/market.js";
import type { OptionsNft } from "../../model/nft.js";
import type {
  OptionsVault,
  OptionsVaultOutcome,
  OptionsVaultPools,
  OptionsVaultShareTotals,
  OptionsVaultSide,
  OptionsVaultStatus,
  OptionsVaultStewardState
} from "../../model/vault.js";
import type { OptionsStreamState } from "../../model/stream.js";
import type { OptionsBoardState } from "../../model/math/accrual.js";

// Sui devInspect returns values as [bytes, type] tuples.
export type InspectReturnValue = readonly [number[], string];

const VAULT_STATUSES = ["open", "hot", "locked", "resolved", "disputed"] as const satisfies readonly OptionsVaultStatus[];
const VAULT_OUTCOMES = ["pending", "yes", "no"] as const satisfies readonly OptionsVaultOutcome[];
const STREAM_STATUSES = ["none", "live", "ended"] as const;
const STORAGE_SCHEMES = [
  "walrus-testnet",
  "walrus-mainnet",
  "ipfs",
  "arweave"
] as const satisfies readonly PointerScheme[];

// Side encoding: 0 = yes, 1 = no (matches EVM).
export const sideToSuiValue = (side: OptionsVaultSide): 0 | 1 =>
  side === "yes" ? 0 : 1;

export const sideFromSuiValue = (value: number): OptionsVaultSide => {
  if (value === 0) return "yes";
  if (value === 1) return "no";
  throw new LiveStreakConfigError({
    message: `Invalid Sui side value: ${value}`
  });
};

// Decode helpers for BCS return values.
export const readU8 = (ret: InspectReturnValue): number =>
  bcs.u8().parse(Uint8Array.from(ret[0]));

export const readU64 = (ret: InspectReturnValue): bigint =>
  BigInt(bcs.u64().parse(Uint8Array.from(ret[0])));

export const readU128 = (ret: InspectReturnValue): bigint =>
  BigInt(bcs.u128().parse(Uint8Array.from(ret[0])));

export const readU256 = (ret: InspectReturnValue): bigint =>
  BigInt(bcs.u256().parse(Uint8Array.from(ret[0])));

export const readBool = (ret: InspectReturnValue): boolean =>
  bcs.bool().parse(Uint8Array.from(ret[0]));

export const readString = (ret: InspectReturnValue): string =>
  bcs.string().parse(Uint8Array.from(ret[0]));

export const readBytes32 = (ret: InspectReturnValue): `0x${string}` => {
  const raw = bcs.bytes(32).parse(Uint8Array.from(ret[0]));
  return `0x${Array.from(raw).map((b) => b.toString(16).padStart(2, "0")).join("")}` as `0x${string}`;
};

// Vault ID from Move is a vector<u8> of length 32.
export const readVaultIdBytes = (ret: InspectReturnValue): `0x${string}` => {
  const raw = bcs.vector(bcs.u8()).parse(Uint8Array.from(ret[0]));
  return `0x${raw.map((b: number) => b.toString(16).padStart(2, "0")).join("")}` as `0x${string}`;
};

export const mapVaultStatus = (value: number): OptionsVaultStatus =>
  VAULT_STATUSES[value] ?? "open";

export const mapVaultOutcome = (value: number): OptionsVaultOutcome =>
  VAULT_OUTCOMES[value] ?? "pending";

export const mapStreamStatus = (
  value: number
): "none" | "live" | "ended" => {
  const status = STREAM_STATUSES[value];
  if (status === undefined) {
    throw new LiveStreakConfigError({
      message: `Invalid Sui stream status: ${value}`
    });
  }
  return status;
};

export const mapStorageScheme = (value: number): PointerScheme => {
  const scheme = STORAGE_SCHEMES[value];
  if (scheme === undefined) {
    throw new LiveStreakConfigError({
      message: `Invalid Sui storage scheme: ${value}`
    });
  }
  return scheme;
};

export type SuiVaultData = {
  readonly id: `0x${string}`;
  readonly marketId: `0x${string}`;
  readonly question: string;
  readonly creator: string;
  readonly status: number;
  readonly outcome: number;
  readonly resolvedAt: bigint;
};

export type SuiVaultPools = {
  readonly yesPool: bigint;
  readonly noPool: bigint;
  readonly yesShares: bigint;
  readonly noShares: bigint;
};

export type SuiHotState = {
  readonly active: boolean;
  readonly until: bigint;
  readonly severity: number;
  readonly reasonHash?: string;
};

export type SuiPosition = {
  readonly rate: bigint;
  readonly gPaid: bigint;
  readonly sharesAccrued: bigint;
  readonly maxEnd: bigint;
  readonly depleted: boolean;
  readonly fundStart: bigint;
  readonly lostUsdc: bigint;
};

export type SuiBoardState = {
  readonly pool: bigint;
  readonly sideRate: bigint;
  readonly g: bigint;
  readonly lastAdvance: bigint;
};

export type SuiMarketData = {
  readonly id: `0x${string}`;
  readonly title: string;
  readonly streamId: `0x${string}`;
  readonly creator: string;
  readonly createdAt: bigint;
};

export type SuiStreamState = {
  readonly status: number;
  readonly scheme: number;
  readonly contentId: string;
  readonly endedAt: bigint;
};

export const mapSuiVault = (
  data: SuiVaultData,
  pools: SuiVaultPools,
  hot: SuiHotState
): OptionsVault => {
  const steward: OptionsVaultStewardState = {
    hot: hot.active,
    ...(hot.active ? { hotUntilMs: Number(hot.until) * 1000 } : {}),
    ...(hot.active ? { severity: hot.severity } : {}),
    ...(hot.active && hot.reasonHash !== undefined ? { hotReason: hot.reasonHash } : {})
  };

  return {
    vaultId: asVaultId(data.id),
    marketId: asMarketId(data.marketId),
    question: data.question,
    type: "timing",
    creator: data.creator,
    status: mapVaultStatus(data.status),
    outcome: mapVaultOutcome(data.outcome),
    pools: {
      yes: pools.yesPool,
      no: pools.noPool
    },
    timing: {
      createdAtMs: 0,
      expiresAtMs: 0,
      ...(data.resolvedAt > 0n ? { resolvedAtMs: Number(data.resolvedAt) * 1000 } : {})
    },
    steward
  };
};

export const mapSuiVaultShareTotals = (pools: SuiVaultPools): OptionsVaultShareTotals => ({
  yes: pools.yesShares,
  no: pools.noShares
});

export const mapSuiVaultPools = (pools: SuiVaultPools): OptionsVaultPools => ({
  yes: pools.yesPool,
  no: pools.noPool
});

export const mapSuiBoard = (data: SuiBoardState): OptionsBoardState => ({
  pool: data.pool,
  sideRate: data.sideRate,
  g: data.g,
  lastAdvanceMs: Number(data.lastAdvance) * 1000
});

export const mapSuiLane = (
  tokenId: TokenId,
  vaultId: VaultId,
  side: OptionsVaultSide,
  laneRate: bigint,
  position: SuiPosition,
  nowSec?: number // Sui chain clock (s); reports a dry lane depleted before any tx flips the flag
): OptionsLane => {
  // Stored `depleted` only flips on a write; also treat maxEnd ≤ chain-now as dry (parity with EVM).
  const depleted =
    position.depleted ||
    (nowSec !== undefined &&
      position.rate > 0n &&
      position.maxEnd > 0n &&
      position.maxEnd <= BigInt(nowSec));
  return {
    tokenId,
    vaultId,
    side,
    rate: depleted ? 0n : laneRate, // depleted ⇒ 0 (bookkeeping keeps the stale rate)
    committedRate: laneRate, // on-chain bookkeeping rate, retained for setLanes re-assertion
    gPaid: position.gPaid,
    // WAD·SCALE (1e24, accumulator precision) → canonical SHARE_SCALE (1e6), matching board_side_shares' ÷wad
    // and sharesFromG — so the model speaks one share unit and percentOfSide isn't inflated by 1e18.
    sharesAccrued: position.sharesAccrued / WAD,
    ...(position.maxEnd > 0n ? { maxEndMs: Number(position.maxEnd) * 1000 } : {}),
    depleted
  };
};

export const enrichSuiLane = (
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

export const mapSuiNft = (
  tokenId: TokenId,
  owner: UserAddress,
  marketId: MarketId,
  laneCount: number,
  lanes: readonly OptionsLane[]
): OptionsNft => ({
  tokenId,
  owner,
  marketId,
  laneCount,
  lanes
});

export const mapSuiMarket = (
  data: SuiMarketData,
  vaultIds: readonly VaultId[]
): OptionsMarket => ({
  marketId: asMarketId(data.id),
  title: data.title,
  creator: asUserAddress(data.creator),
  streamId: data.streamId,
  status: "open",
  vaultIds,
  timing: {
    createdAtMs: Number(data.createdAt) * 1000
  }
});

export const mapSuiStreamState = (data: SuiStreamState): OptionsStreamState => ({
  status: mapStreamStatus(data.status),
  scheme: mapStorageScheme(data.scheme),
  id: data.contentId,
  updatedAtMs: 0,
  endedAtMs: Number(data.endedAt) * 1000
});

export const mapSuiLvstAccount = (
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

export type SuiContractsReadEntity =
  | "market"
  | "vault"
  | "vault share totals"
  | "owner tokens"
  | "nft"
  | "LVST account"
  | "claimable"
  | "loss claimable"
  | "pot"
  | "collected"
  | "account vault ids"
  | "winning side"
  | "board"
  | "share price"
  | "pending boundaries"
  | "boundaries"
  | "pending shares"
  | "USDC address"
  | "USDC balance"
  | "NFT balance"
  | "stream state";

export const suiReadNotFound = (
  entity: SuiContractsReadEntity,
  id: string
): LiveStreakConfigError =>
  new LiveStreakConfigError({
    message: `${entity} not found`,
    metadata: { details: id }
  });

export const suiReadFailed = (
  entity: SuiContractsReadEntity,
  cause: unknown
): LiveStreakRuntimeError =>
  new LiveStreakRuntimeError({
    message: `Failed to read ${entity} from Sui contracts`,
    metadata: { cause, retryable: true }
  });

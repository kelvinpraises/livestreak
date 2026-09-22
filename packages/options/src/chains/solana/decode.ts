// --- exports ---

// Pure mappers from the WASM EngineView shapes (byte-exact engine views) to the canonical options
// model. No @solana/* here — the engine numbers are already engine-exact, we only re-shape + rescale
// times (secs → ms) and share units (WAD·SCALE accumulator → SHARE_SCALE), matching the Sui leg.
import { LiveStreakConfigError } from "@livestreak/core";
import type { PointerScheme } from "@livestreak/host";
import type {
  EngineBoard,
  EnginePosition,
  EngineVault
} from "@livestreak/contracts/solana";

import { asMarketId, asVaultId } from "../../model/ids.js";
import { WAD } from "../../model/math/curve.js";
import type { MarketId, TokenId, UserAddress, VaultId } from "../../model/ids.js";
import type { LvstAccount } from "../../model/lvst.js";
import type { OptionsLane } from "../../model/lane.js";
import type { OptionsBoardState } from "../../model/math/accrual.js";
import type { OptionsMarket } from "../../model/market.js";
import type { OptionsNft } from "../../model/nft.js";
import type { OptionsStreamState } from "../../model/stream.js";
import type {
  OptionsVault,
  OptionsVaultShareTotals,
  OptionsVaultSide,
  OptionsVaultStatus,
  OptionsVaultOutcome
} from "../../model/vault.js";

// Engine side encoding: 0 = yes, 1 = no (vault.rs SIDE_YES/SIDE_NO — parity with EVM/Sui).
export const sideToSolana = (side: OptionsVaultSide): 0 | 1 => (side === "yes" ? 0 : 1);

export const sideFromSolana = (value: number): OptionsVaultSide => {
  if (value === 0) return "yes";
  if (value === 1) return "no";
  throw new LiveStreakConfigError({ message: `Invalid Solana side value: ${value}` });
};

// Numeric enum maps — same codes as the Move/EVM legs (vault.rs: STATUS_OPEN=0, STATUS_LOCKED=2,
// STATUS_RESOLVED=3; OUTCOME_PENDING=0, OUTCOME_YES=1, OUTCOME_NO=2). Index positions line up with
// the Sui decode arrays, so display parity is exact.
const VAULT_STATUSES = ["open", "hot", "locked", "resolved", "disputed"] as const satisfies readonly OptionsVaultStatus[];
const VAULT_OUTCOMES = ["pending", "yes", "no"] as const satisfies readonly OptionsVaultOutcome[];
const STREAM_STATUSES = ["none", "live", "ended"] as const;
const STORAGE_SCHEMES = [
  "walrus-testnet",
  "walrus-mainnet",
  "ipfs",
  "arweave"
] as const satisfies readonly PointerScheme[];

export const mapVaultStatus = (value: number): OptionsVaultStatus => VAULT_STATUSES[value] ?? "open";
export const mapVaultOutcome = (value: number): OptionsVaultOutcome => VAULT_OUTCOMES[value] ?? "pending";

export const mapStreamStatus = (value: number): "none" | "live" | "ended" => {
  const status = STREAM_STATUSES[value];
  if (status === undefined) {
    throw new LiveStreakConfigError({ message: `Invalid Solana stream status: ${value}` });
  }
  return status;
};

export const mapStorageScheme = (value: number): PointerScheme => {
  const scheme = STORAGE_SCHEMES[value];
  if (scheme === undefined) {
    throw new LiveStreakConfigError({ message: `Invalid Solana storage scheme: ${value}` });
  }
  return scheme;
};

export const mapSolanaBoard = (board: EngineBoard): OptionsBoardState => ({
  pool: board.pool,
  sideRate: board.sideRate,
  g: board.g,
  lastAdvanceMs: board.lastAdvance * 1000
});

export const mapSolanaVault = (vault: EngineVault): OptionsVault => ({
  vaultId: asVaultId(vault.id),
  marketId: asMarketId(vault.marketId),
  question: vault.question,
  type: "timing",
  creator: vault.creator,
  status: mapVaultStatus(vault.status),
  outcome: mapVaultOutcome(vault.outcome),
  // Per-side pools come from vaultPools; the vault view carries no pool split, so 0/0 here and the
  // reader overlays the real split via readVaultShareTotals / boards where value math needs it.
  pools: { yes: 0n, no: 0n },
  timing: {
    createdAtMs: 0,
    expiresAtMs: 0,
    ...(vault.resolvedAt > 0 ? { resolvedAtMs: vault.resolvedAt * 1000 } : {})
  },
  steward: { hot: false }
});

export const mapSolanaVaultShareTotals = (pools: {
  readonly yesShares: bigint;
  readonly noShares: bigint;
}): OptionsVaultShareTotals => ({ yes: pools.yesShares, no: pools.noShares });

export const mapSolanaLane = (
  tokenId: TokenId,
  vaultId: VaultId,
  side: OptionsVaultSide,
  position: EnginePosition,
  nowSec: number,
  claimable: bigint,
  lossClaimable: bigint,
  winningSide?: OptionsVaultSide
): OptionsLane => {
  // Stored `depleted` only flips on a write; also treat maxEnd ≤ wall-clock-now as dry (EVM/Sui parity).
  const depleted =
    position.depleted ||
    (position.rate > 0n && position.maxEnd > 0 && position.maxEnd <= nowSec);
  return {
    tokenId,
    vaultId,
    side,
    rate: depleted ? 0n : position.rate,
    committedRate: position.rate,
    gPaid: position.gPaid,
    // WAD·SCALE accumulator precision → canonical SHARE_SCALE, matching board_side_shares' ÷wad.
    sharesAccrued: position.sharesAccrued / WAD,
    ...(position.maxEnd > 0 ? { maxEndMs: position.maxEnd * 1000 } : {}),
    depleted,
    claimable,
    lossClaimable,
    ...(winningSide === undefined ? {} : { won: side === winningSide })
  };
};

export const mapSolanaNft = (
  tokenId: TokenId,
  owner: UserAddress,
  marketId: MarketId,
  laneCount: number,
  lanes: readonly OptionsLane[],
  // Shared streaming balance (USDC raw units) from the engine's per-token streams state. Always set on
  // Solana now (the reader reads it via the wasm view), so the app's balance readout lights up — parity
  // with EVM. `undefined` only if the caller couldn't resolve it.
  balance?: bigint
): OptionsNft => ({ tokenId, owner, marketId, laneCount, lanes, ...(balance === undefined ? {} : { balance }) });

export const mapSolanaMarket = (
  marketId: MarketId,
  title: string,
  creator: UserAddress,
  streamId: string,
  createdAtSec: bigint,
  vaultIds: readonly VaultId[]
): OptionsMarket => ({
  marketId,
  title,
  creator,
  streamId,
  status: "open",
  vaultIds,
  timing: { createdAtMs: Number(createdAtSec) * 1000 }
});

export const mapSolanaStreamState = (data: {
  readonly status: number;
  readonly scheme: number;
  readonly pointer: string;
  readonly endedAtSec: bigint;
  readonly updatedAtSec: bigint;
}): OptionsStreamState => ({
  status: mapStreamStatus(data.status),
  scheme: mapStorageScheme(data.scheme),
  id: data.pointer,
  updatedAtMs: Number(data.updatedAtSec) * 1000,
  endedAtMs: Number(data.endedAtSec) * 1000
});

export const mapSolanaLvstAccount = (
  user: UserAddress,
  balance: bigint,
  staked: bigint,
  pendingDividends: bigint
): LvstAccount => ({ account: user, balance, staked, pendingDividends });

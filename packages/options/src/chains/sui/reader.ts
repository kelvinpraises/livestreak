// --- exports ---

// Multichain-hygiene: read VIA @livestreak/wallet (the single @mysten/sui v2 owner).
import { bcs, SuiJsonRpcClient, Transaction, createSuiReadClient } from "@livestreak/wallet";
import { LiveStreakConfigError } from "@livestreak/core";
import { MODULES, target } from "@livestreak/contracts/sui";

import { asMarketId, asTokenId, asVaultId } from "../../model/ids.js";
import { priceOf } from "../../model/math/curve.js";
import type { LvstAccount } from "../../model/lvst.js";
import type { MarketId, TokenId, UserAddress, VaultId } from "../../model/ids.js";
import type { OptionsBoardState } from "../../model/math/accrual.js";
import type { FunderBoundary } from "../../model/math/live-pool.js";
import type { OptionsMarket } from "../../model/market.js";
import type { OptionsNft } from "../../model/nft.js";
import type { OptionsStreamState } from "../../model/stream.js";
import type {
  OptionsVault,
  OptionsVaultShareTotals,
  OptionsVaultSide
} from "../../model/vault.js";
import type { OptionsReader } from "../types.js";
import type { OptionsSuiObjectIds } from "./addresses.js";
import {
  enrichSuiLane,
  mapSuiBoard,
  mapSuiLane,
  mapSuiLvstAccount,
  mapSuiMarket,
  mapSuiNft,
  mapSuiStreamState,
  mapSuiVault,
  mapSuiVaultShareTotals,
  readBool,
  readU64,
  readU128,
  readU256,
  readU8,
  sideFromSuiValue,
  sideToSuiValue,
  suiReadFailed,
  suiReadNotFound,
  type InspectReturnValue,
  type SuiBoardState,
  type SuiHotState,
  type SuiPosition,
  type SuiVaultData,
  type SuiVaultPools
} from "./decode.js";

// Sui clock object is always the same system object.
const SUI_CLOCK_OBJECT_ID = "0x6";

// USDC coin type is constructed from the package ID.
const usdcCoinType = (packageId: string): string =>
  `${packageId}::mock_usdc::MOCK_USDC`;

// Bytes32-encoded ID → hex string for model types.
const bytesVecToHex = (bytes: readonly number[]): `0x${string}` =>
  `0x${bytes.map((b) => b.toString(16).padStart(2, "0")).join("")}` as `0x${string}`;

type ReaderContext = {
  readonly client: SuiJsonRpcClient;
  readonly ids: OptionsSuiObjectIds;
  readonly packageId: string;
  readonly coinType: string;
};

export const createSuiOptionsReader = (
  ids: OptionsSuiObjectIds,
  rpcUrl: string
): OptionsReader => {
  const client = createSuiReadClient(rpcUrl);
  const ctx: ReaderContext = {
    client,
    ids,
    packageId: ids.packageId,
    coinType: usdcCoinType(ids.packageId)
  };

  return buildReader(ctx);
};

const buildReader = (ctx: ReaderContext): OptionsReader => ({
  readMarket: (marketId) => readMarket(ctx, marketId),
  readStreamState: (marketId) => readStreamState(ctx, marketId),
  listMarketVaults: (marketId) => listMarketVaults(ctx, marketId),
  readVault: (vaultId) => readVault(ctx, vaultId),
  readVaultShareTotals: (vaultId) => readVaultShareTotals(ctx, vaultId),
  listOwnerTokens: (owner) => listOwnerTokens(ctx, owner),
  readNft: (tokenId, owner) => readNft(ctx, tokenId, owner),
  readLvstAccount: (user) => readLvstAccount(ctx, user),
  readClaimable: (tokenId, vaultId, side) => readClaimable(ctx, tokenId, vaultId, side),
  readLossClaimable: (tokenId, vaultId, side) => readLossClaimable(ctx, tokenId, vaultId, side),
  readPot: (vaultId) => readPot(ctx, vaultId),
  readCollected: (vaultId) => readCollected(ctx, vaultId),
  readAccountVaultIds: (tokenId) => readAccountVaultIds(ctx, tokenId),
  readWinningSide: (vaultId) => readWinningSide(ctx, vaultId),
  readBoard: (vaultId, side) => readBoard(ctx, vaultId, side),
  readSharePrice: (vaultId, side) => readSharePrice(ctx, vaultId, side),
  readPendingBoundaries: (vaultId, side) => readPendingBoundaries(ctx, vaultId, side),
  readBoundaries: (vaultId, side) => readBoundaries(ctx, vaultId, side),
  readPendingShares: (vaultId, side, tokenId) => readPendingShares(ctx, vaultId, side, tokenId),
  readUsdcAddress: () => readUsdcAddress(ctx),
  readUsdcBalance: (owner) => readUsdcBalance(ctx, owner),
  readNftBalance: (tokenId) => readNftBalance(ctx, tokenId),
  readOwnerOf: async () => {
    throw new LiveStreakConfigError({
      message: "Sui: readOwnerOf not supported (owned-object model)"
    });
  },
  readApproved: async () => {
    throw new LiveStreakConfigError({
      message: "Sui: readApproved not supported (owned-object model)"
    });
  },
  readIsApprovedForAll: async () => {
    throw new LiveStreakConfigError({
      message: "Sui: readIsApprovedForAll not supported (owned-object model)"
    });
  }
});

// --- reads ---

const inspect = async (
  ctx: ReaderContext,
  tx: Transaction
): Promise<readonly InspectReturnValue[][]> => {
  // devInspect uses the zero address as sender for read-only calls.
  const result = await ctx.client.devInspectTransactionBlock({
    sender: "0x0000000000000000000000000000000000000000000000000000000000000000",
    transactionBlock: tx
  });

  return (result.results ?? []).map((r) =>
    (r.returnValues ?? []) as InspectReturnValue[]
  );
};

const readMarket = async (ctx: ReaderContext, marketId: MarketId): Promise<OptionsMarket> => {
  const marketHex = marketId.startsWith("0x") ? marketId.slice(2) : marketId;
  const marketBytes = Array.from({ length: 32 }, (_, i) =>
    parseInt(marketHex.slice(i * 2, i * 2 + 2) || "0", 16)
  );
  const marketBytesArg = (tx: Transaction) =>
    tx.pure(bcs.vector(bcs.u8()).serialize(marketBytes).toBytes());

  try {
    // Check existence.
    const existsTx = new Transaction();
    existsTx.moveCall({
      target: target(ctx.packageId, MODULES.marketRegistry, "market_exists"),
      arguments: [existsTx.object(ctx.ids.marketRegistry), marketBytesArg(existsTx)]
    });
    const existsResults = await inspect(ctx, existsTx);
    const existsVal = existsResults[0]?.[0];
    if (existsVal === undefined || !readBool(existsVal)) {
      throw suiReadNotFound("market", marketId);
    }

    // get_market returns MarketData by value — decode BCS struct in one call.
    const dataTx = new Transaction();
    dataTx.moveCall({
      target: target(ctx.packageId, MODULES.marketRegistry, "get_market"),
      arguments: [dataTx.object(ctx.ids.marketRegistry), marketBytesArg(dataTx)]
    });
    const dataResults = await inspect(ctx, dataTx);
    const dataVal = dataResults[0]?.[0];
    if (dataVal === undefined) {
      throw suiReadFailed("market", new Error("No result from get_market"));
    }
    const { title, streamId, creator, createdAt } = decodeMarketDataStruct(dataVal);

    // get_vault_ids returns &vector<vector<u8>>.
    const vaultIdsTx = new Transaction();
    vaultIdsTx.moveCall({
      target: target(ctx.packageId, MODULES.marketRegistry, "get_vault_ids"),
      arguments: [vaultIdsTx.object(ctx.ids.marketRegistry), marketBytesArg(vaultIdsTx)]
    });
    const vaultIdsResults = await inspect(ctx, vaultIdsTx);
    const vaultIdsVal = vaultIdsResults[0]?.[0];
    const vaultIds = vaultIdsVal !== undefined ? decodeVaultIdsList(vaultIdsVal) : [];

    return mapSuiMarket(
      {
        id: bytesVecToHex(marketBytes) as `0x${string}`,
        title,
        streamId: streamId as `0x${string}`,
        creator,
        createdAt
      },
      vaultIds
    );
  } catch (error) {
    if (error instanceof LiveStreakConfigError) throw error;
    throw suiReadFailed("market", error);
  }
};

// BCS layout of MarketData:
// id: vector<u8> (length-prefixed), title: vector<u8>, stream_id: vector<u8>,
// creator: address (32 bytes), created_at: u64 (LE), exists: bool
const decodeMarketDataStruct = (
  ret: InspectReturnValue
): { title: string; streamId: string; creator: string; createdAt: bigint } => {
  const bytes = Uint8Array.from(ret[0]);
  const MarketDataBcs = bcs.struct("MarketData", {
    id: bcs.vector(bcs.u8()),
    title: bcs.vector(bcs.u8()),
    stream_id: bcs.vector(bcs.u8()),
    creator: bcs.bytes(32),
    created_at: bcs.u64(),
    exists: bcs.bool()
  });
  const parsed = MarketDataBcs.parse(bytes);
  const title = new TextDecoder().decode(Uint8Array.from(parsed.title as number[]));
  const streamIdHex = bytesVecToHex(parsed.stream_id as number[]);
  const creatorHex = bytesVecToHex(Array.from(parsed.creator as Uint8Array));
  return {
    title,
    streamId: streamIdHex,
    creator: `0x${creatorHex.slice(2)}`,
    createdAt: BigInt(parsed.created_at)
  };
};

// get_vault_ids returns &vector<vector<u8>> — decode as a vector of byte vectors.
const decodeVaultIdsList = (ret: InspectReturnValue): readonly VaultId[] => {
  const bytes = Uint8Array.from(ret[0]);
  const VaultIdListBcs = bcs.vector(bcs.vector(bcs.u8()));
  const parsed = VaultIdListBcs.parse(bytes) as number[][];
  return parsed.map((v) => asVaultId(bytesVecToHex(v)));
};

const readStreamState = async (
  ctx: ReaderContext,
  marketId: MarketId
): Promise<OptionsStreamState> => {
  const marketHex = marketId.startsWith("0x") ? marketId.slice(2) : marketId;
  const marketBytes = Array.from({ length: 32 }, (_, i) =>
    parseInt(marketHex.slice(i * 2, i * 2 + 2) || "0", 16)
  );

  try {
    const tx = new Transaction();
    tx.moveCall({
      target: target(ctx.packageId, MODULES.marketRegistry, "stream_state"),
      arguments: [
        tx.object(ctx.ids.marketRegistry),
        tx.pure(bcs.vector(bcs.u8()).serialize(marketBytes).toBytes())
      ]
    });
    const results = await inspect(ctx, tx);
    const structVal = results[0]?.[0];
    if (structVal === undefined) {
      throw suiReadFailed("stream state", new Error("No result from stream_state"));
    }

    const StreamStateBcs = bcs.struct("StreamState", {
      status: bcs.u8(),
      scheme: bcs.u8(),
      id: bcs.vector(bcs.u8()),
      updated_at: bcs.u64(),
      ended_at: bcs.u64()
    });
    const parsed = StreamStateBcs.parse(Uint8Array.from(structVal[0]));
    const contentId = new TextDecoder().decode(Uint8Array.from(parsed.id as number[]));

    return mapSuiStreamState({
      status: parsed.status as number,
      scheme: parsed.scheme as number,
      contentId,
      endedAt: BigInt(parsed.ended_at)
    });
  } catch (error) {
    if (error instanceof LiveStreakConfigError) throw error;
    throw suiReadFailed("stream state", error);
  }
};

const listMarketVaults = async (
  ctx: ReaderContext,
  marketId: MarketId
): Promise<readonly VaultId[]> => {
  const market = await readMarket(ctx, marketId);
  return market.vaultIds;
};

const readVaultData = async (
  ctx: ReaderContext,
  vaultId: VaultId
): Promise<{ data: SuiVaultData; pools: SuiVaultPools; hot: SuiHotState }> => {
  const vaultHex = vaultId.startsWith("0x") ? vaultId.slice(2) : vaultId;
  const vaultBytes = Array.from({ length: 32 }, (_, i) =>
    parseInt(vaultHex.slice(i * 2, i * 2 + 2) || "0", 16)
  );
  const vaultBytesArg = (tx: Transaction) =>
    tx.pure(bcs.vector(bcs.u8()).serialize(vaultBytes).toBytes());

  // Check vault exists.
  const existsTx = new Transaction();
  existsTx.moveCall({
    target: target(ctx.packageId, MODULES.vault, "vault_exists"),
    typeArguments: [ctx.coinType],
    arguments: [existsTx.object(ctx.ids.vaultRegistry), vaultBytesArg(existsTx)]
  });
  const existsResults = await inspect(ctx, existsTx);
  const existsVal = existsResults[0]?.[0];
  if (existsVal === undefined || !readBool(existsVal)) {
    throw suiReadNotFound("vault", vaultId);
  }

  // Read vault data struct.
  const dataTx = new Transaction();
  dataTx.moveCall({
    target: target(ctx.packageId, MODULES.vault, "get_vault"),
    typeArguments: [ctx.coinType],
    arguments: [dataTx.object(ctx.ids.vaultRegistry), vaultBytesArg(dataTx)]
  });
  const dataResults = await inspect(ctx, dataTx);
  const dataVal = dataResults[0]?.[0];
  if (dataVal === undefined) {
    throw suiReadFailed("vault", new Error("No result from get_vault"));
  }

  // BCS layout of VaultData: id: vector<u8>, market_id: vector<u8>, question: vector<u8>,
  // creator: address (32 bytes), status: u8, outcome: u8, resolved_at: u64, exists: bool
  const VaultDataBcs = bcs.struct("VaultData", {
    id: bcs.vector(bcs.u8()),
    market_id: bcs.vector(bcs.u8()),
    question: bcs.vector(bcs.u8()),
    creator: bcs.bytes(32),
    status: bcs.u8(),
    outcome: bcs.u8(),
    resolved_at: bcs.u64(),
    exists: bcs.bool()
  });
  const parsedData = VaultDataBcs.parse(Uint8Array.from(dataVal[0]));

  const data: SuiVaultData = {
    id: bytesVecToHex(Array.from(parsedData.id as number[])),
    marketId: bytesVecToHex(Array.from(parsedData.market_id as number[])),
    question: new TextDecoder().decode(Uint8Array.from(parsedData.question as number[])),
    creator: `0x${bytesVecToHex(Array.from(parsedData.creator as Uint8Array)).slice(2)}`,
    status: parsedData.status as number,
    outcome: parsedData.outcome as number,
    resolvedAt: BigInt(parsedData.resolved_at as unknown as string)
  };

  // Read pools.
  const poolsTx = new Transaction();
  poolsTx.moveCall({
    target: target(ctx.packageId, MODULES.vault, "get_vault_pools"),
    typeArguments: [ctx.coinType],
    arguments: [poolsTx.object(ctx.ids.vaultRegistry), vaultBytesArg(poolsTx)]
  });
  const poolsResults = await inspect(ctx, poolsTx);
  const poolsVals = poolsResults[0] ?? [];
  const pools: SuiVaultPools = {
    yesPool: poolsVals[0] !== undefined ? readU256(poolsVals[0]) : 0n,
    noPool: poolsVals[1] !== undefined ? readU256(poolsVals[1]) : 0n,
    yesShares: poolsVals[2] !== undefined ? readU256(poolsVals[2]) : 0n,
    noShares: poolsVals[3] !== undefined ? readU256(poolsVals[3]) : 0n
  };

  // Read hot state via an Option<HotState> return from hot_state.
  // hot_state returns Option<HotState>. Since BCS for Option is: 0 for none, 1+struct for some.
  const hotTx = new Transaction();
  hotTx.moveCall({
    target: target(ctx.packageId, MODULES.stewardRegistry, "hot_state"),
    arguments: [hotTx.object(ctx.ids.stewardRegistry), vaultBytesArg(hotTx)]
  });
  const hotResults = await inspect(ctx, hotTx);
  const hotVal = hotResults[0]?.[0];
  const hot = decodeHotState(hotVal);

  return { data, pools, hot };
};

const decodeHotState = (ret: InspectReturnValue | undefined): SuiHotState => {
  if (ret === undefined) return { active: false, until: 0n, severity: 0 };
  try {
    // Option<HotState>: first byte is 0 (none) or 1 (some).
    const bytes = Uint8Array.from(ret[0]);
    if (bytes[0] === 0) return { active: false, until: 0n, severity: 0 };
    // Some(HotState): remaining bytes are the struct.
    // HotState: active: bool, until: u64, severity: u8, reason_hash: vector<u8>
    const HotStateBcs = bcs.struct("HotState", {
      active: bcs.bool(),
      until: bcs.u64(),
      severity: bcs.u8(),
      reason_hash: bcs.vector(bcs.u8())
    });
    const parsed = HotStateBcs.parse(bytes.slice(1));
    const reasonBytes = parsed.reason_hash as number[];
    const reasonHash =
      reasonBytes.length > 0
        ? `0x${reasonBytes.map((b) => b.toString(16).padStart(2, "0")).join("")}`
        : undefined;
    return {
      active: parsed.active as boolean,
      until: BigInt(parsed.until as unknown as string),
      severity: parsed.severity as number,
      ...(reasonHash === undefined ? {} : { reasonHash })
    };
  } catch {
    return { active: false, until: 0n, severity: 0 };
  }
};

const readVault = async (ctx: ReaderContext, vaultId: VaultId): Promise<OptionsVault> => {
  try {
    const { data, pools, hot } = await readVaultData(ctx, vaultId);
    return mapSuiVault(data, pools, hot);
  } catch (error) {
    if (error instanceof LiveStreakConfigError) throw error;
    throw suiReadFailed("vault", error);
  }
};

const readVaultShareTotals = async (
  ctx: ReaderContext,
  vaultId: VaultId
): Promise<OptionsVaultShareTotals> => {
  try {
    const { pools } = await readVaultData(ctx, vaultId);
    return mapSuiVaultShareTotals(pools);
  } catch (error) {
    if (error instanceof LiveStreakConfigError) throw error;
    throw suiReadFailed("vault share totals", error);
  }
};

const readWinningSide = async (
  ctx: ReaderContext,
  vaultId: VaultId
): Promise<OptionsVaultSide | undefined> => {
  try {
    const vault = await readVault(ctx, vaultId);
    if (vault.status !== "resolved") return undefined;
    if (vault.outcome === "yes") return "yes";
    if (vault.outcome === "no") return "no";
    return undefined;
  } catch (error) {
    if (error instanceof LiveStreakConfigError) throw error;
    throw suiReadFailed("winning side", error);
  }
};

const readBoard = async (
  ctx: ReaderContext,
  vaultId: VaultId,
  side: OptionsVaultSide
): Promise<OptionsBoardState> => {
  const vaultHex = vaultId.startsWith("0x") ? vaultId.slice(2) : vaultId;
  const vaultBytes = Array.from({ length: 32 }, (_, i) =>
    parseInt(vaultHex.slice(i * 2, i * 2 + 2) || "0", 16)
  );

  try {
    const tx = new Transaction();
    tx.moveCall({
      target: target(ctx.packageId, MODULES.vault, "get_board"),
      typeArguments: [ctx.coinType],
      arguments: [
        tx.object(ctx.ids.vaultRegistry),
        tx.pure(bcs.vector(bcs.u8()).serialize(vaultBytes).toBytes()),
        tx.pure.u8(sideToSuiValue(side))
      ]
    });
    const results = await inspect(ctx, tx);
    const vals = results[0] ?? [];
    const board: SuiBoardState = {
      pool: vals[0] !== undefined ? readU256(vals[0]) : 0n,
      sideRate: vals[1] !== undefined ? readU256(vals[1]) : 0n,
      g: vals[2] !== undefined ? readU256(vals[2]) : 0n,
      lastAdvance: vals[3] !== undefined ? readU64(vals[3]) : 0n
    };
    return mapSuiBoard(board);
  } catch (error) {
    if (error instanceof LiveStreakConfigError) throw error;
    throw suiReadFailed("board", error);
  }
};

const readSharePrice = async (
  ctx: ReaderContext,
  vaultId: VaultId,
  side: OptionsVaultSide
): Promise<bigint> => {
  // O4: share price is the bonding-curve price of the pool (BASE_PRICE + BASE_PRICE*pool/CURVE_K),
  // byte-identical to Move `bonding_board::price` and the EVM `getSharePrice` — NOT the raw pool.
  const board = await readBoard(ctx, vaultId, side);
  return priceOf(board.pool);
};

const readPendingBoundaries = async (
  ctx: ReaderContext,
  vaultId: VaultId,
  side: OptionsVaultSide
): Promise<bigint> => {
  const vaultHex = vaultId.startsWith("0x") ? vaultId.slice(2) : vaultId;
  const vaultBytes = Array.from({ length: 32 }, (_, i) =>
    parseInt(vaultHex.slice(i * 2, i * 2 + 2) || "0", 16)
  );

  try {
    const tx = new Transaction();
    tx.moveCall({
      target: target(ctx.packageId, MODULES.vault, "pending_boundaries"),
      typeArguments: [ctx.coinType],
      arguments: [
        tx.object(ctx.ids.vaultRegistry),
        tx.pure(bcs.vector(bcs.u8()).serialize(vaultBytes).toBytes()),
        tx.pure.u8(sideToSuiValue(side))
      ]
    });
    const results = await inspect(ctx, tx);
    const val = results[0]?.[0];
    return val !== undefined ? readU64(val) : 0n;
  } catch (error) {
    if (error instanceof LiveStreakConfigError) throw error;
    throw suiReadFailed("pending boundaries", error);
  }
};

// Canonical unsettled funder depletion schedule (Move get_boundaries → (vector<u64>, vector<u256>)).
// Parity with EVM readBoundaries: every active funder's (maxEnd, rate), summing to side_rate, so the
// live-pool projection caps exactly at what was funded.
const readBoundaries = async (
  ctx: ReaderContext,
  vaultId: VaultId,
  side: OptionsVaultSide
): Promise<readonly FunderBoundary[]> => {
  const vaultHex = vaultId.startsWith("0x") ? vaultId.slice(2) : vaultId;
  const vaultBytes = Array.from({ length: 32 }, (_, i) =>
    parseInt(vaultHex.slice(i * 2, i * 2 + 2) || "0", 16)
  );

  try {
    const tx = new Transaction();
    tx.moveCall({
      target: target(ctx.packageId, MODULES.vault, "get_boundaries"),
      typeArguments: [ctx.coinType],
      arguments: [
        tx.object(ctx.ids.vaultRegistry),
        tx.pure(bcs.vector(bcs.u8()).serialize(vaultBytes).toBytes()),
        tx.pure.u8(sideToSuiValue(side))
      ]
    });
    const results = await inspect(ctx, tx);
    const vals = results[0] ?? [];
    const maxEnds = vals[0] ? (bcs.vector(bcs.u64()).parse(Uint8Array.from(vals[0][0])) as string[]) : [];
    const rates = vals[1] ? (bcs.vector(bcs.u256()).parse(Uint8Array.from(vals[1][0])) as string[]) : [];
    return maxEnds.map((maxEnd, i) => ({ maxEndMs: Number(maxEnd) * 1000, rate: BigInt(rates[i] ?? "0") }));
  } catch (error) {
    if (error instanceof LiveStreakConfigError) throw error;
    throw suiReadFailed("boundaries", error);
  }
};

const readPendingShares = async (
  ctx: ReaderContext,
  vaultId: VaultId,
  side: OptionsVaultSide,
  tokenId: TokenId
): Promise<bigint> => {
  const vaultHex = vaultId.startsWith("0x") ? vaultId.slice(2) : vaultId;
  const vaultBytes = Array.from({ length: 32 }, (_, i) =>
    parseInt(vaultHex.slice(i * 2, i * 2 + 2) || "0", 16)
  );

  try {
    const tx = new Transaction();
    tx.moveCall({
      target: target(ctx.packageId, MODULES.vault, "pending_shares"),
      typeArguments: [ctx.coinType],
      arguments: [
        tx.object(ctx.ids.vaultRegistry),
        tx.pure(bcs.vector(bcs.u8()).serialize(vaultBytes).toBytes()),
        tx.pure.u8(sideToSuiValue(side)),
        tx.pure.u256(tokenId),
        tx.object(SUI_CLOCK_OBJECT_ID)
      ]
    });
    const results = await inspect(ctx, tx);
    const val = results[0]?.[0];
    return val !== undefined ? readU256(val) : 0n;
  } catch (error) {
    if (error instanceof LiveStreakConfigError) throw error;
    throw suiReadFailed("pending shares", error);
  }
};

const readClaimable = async (
  ctx: ReaderContext,
  tokenId: TokenId,
  vaultId: VaultId,
  side: OptionsVaultSide
): Promise<bigint> => {
  const vaultHex = vaultId.startsWith("0x") ? vaultId.slice(2) : vaultId;
  const vaultBytes = Array.from({ length: 32 }, (_, i) =>
    parseInt(vaultHex.slice(i * 2, i * 2 + 2) || "0", 16)
  );

  try {
    const tx = new Transaction();
    tx.moveCall({
      target: target(ctx.packageId, MODULES.vault, "claimable"),
      typeArguments: [ctx.coinType],
      arguments: [
        tx.object(ctx.ids.vaultRegistry),
        tx.pure.u256(tokenId),
        tx.pure(bcs.vector(bcs.u8()).serialize(vaultBytes).toBytes()),
        tx.pure.u8(sideToSuiValue(side))
      ]
    });
    const results = await inspect(ctx, tx);
    const val = results[0]?.[0];
    return val !== undefined ? readU256(val) : 0n;
  } catch (error) {
    if (error instanceof LiveStreakConfigError) throw error;
    throw suiReadFailed("claimable", error);
  }
};

const readLossClaimable = async (
  ctx: ReaderContext,
  tokenId: TokenId,
  vaultId: VaultId,
  side: OptionsVaultSide
): Promise<bigint> => {
  const vaultHex = vaultId.startsWith("0x") ? vaultId.slice(2) : vaultId;
  const vaultBytes = Array.from({ length: 32 }, (_, i) =>
    parseInt(vaultHex.slice(i * 2, i * 2 + 2) || "0", 16)
  );

  try {
    const tx = new Transaction();
    tx.moveCall({
      target: target(ctx.packageId, MODULES.vault, "loss_claimable"),
      typeArguments: [ctx.coinType],
      arguments: [
        tx.object(ctx.ids.vaultRegistry),
        tx.pure.u256(tokenId),
        tx.pure(bcs.vector(bcs.u8()).serialize(vaultBytes).toBytes()),
        tx.pure.u8(sideToSuiValue(side))
      ]
    });
    const results = await inspect(ctx, tx);
    const val = results[0]?.[0];
    return val !== undefined ? readU256(val) : 0n;
  } catch (error) {
    if (error instanceof LiveStreakConfigError) throw error;
    throw suiReadFailed("loss claimable", error);
  }
};

const readPot = async (ctx: ReaderContext, vaultId: VaultId): Promise<bigint> => {
  const vaultHex = vaultId.startsWith("0x") ? vaultId.slice(2) : vaultId;
  const vaultBytes = Array.from({ length: 32 }, (_, i) =>
    parseInt(vaultHex.slice(i * 2, i * 2 + 2) || "0", 16)
  );

  try {
    const tx = new Transaction();
    tx.moveCall({
      target: target(ctx.packageId, MODULES.vault, "pot"),
      typeArguments: [ctx.coinType],
      arguments: [
        tx.object(ctx.ids.vaultRegistry),
        tx.pure(bcs.vector(bcs.u8()).serialize(vaultBytes).toBytes())
      ]
    });
    const results = await inspect(ctx, tx);
    const val = results[0]?.[0];
    return val !== undefined ? readU256(val) : 0n;
  } catch (error) {
    if (error instanceof LiveStreakConfigError) throw error;
    throw suiReadFailed("pot", error);
  }
};

const readCollected = async (ctx: ReaderContext, vaultId: VaultId): Promise<boolean> => {
  // No direct collected() accessor — derive from vault data.
  // Vault is "collected" when outcome != pending and pot has been settled.
  // The claimable fn checks `collected` table internally; we approximate as outcome resolved.
  try {
    const vault = await readVault(ctx, vaultId);
    return vault.status === "resolved";
  } catch (error) {
    if (error instanceof LiveStreakConfigError) throw error;
    throw suiReadFailed("collected", error);
  }
};

const readAccountVaultIds = async (
  ctx: ReaderContext,
  tokenId: TokenId
): Promise<readonly VaultId[]> => {
  const laneCount = await readLaneCount(ctx, tokenId);
  const vaultIds: VaultId[] = [];

  for (let i = 0; i < laneCount; i += 1) {
    const tx = new Transaction();
    tx.moveCall({
      target: target(ctx.packageId, MODULES.marketDriver, "lane_vault_at"),
      arguments: [
        tx.object(ctx.ids.marketDriverRegistry),
        tx.pure.u256(tokenId),
        tx.pure.u64(i)
      ]
    });
    const results = await inspect(ctx, tx);
    const val = results[0]?.[0];
    if (val !== undefined) {
      const rawBytes = bcs.vector(bcs.u8()).parse(Uint8Array.from(val[0])) as number[];
      vaultIds.push(asVaultId(bytesVecToHex(rawBytes)));
    }
  }

  return vaultIds;
};

const readLaneCount = async (ctx: ReaderContext, tokenId: TokenId): Promise<number> => {
  const tx = new Transaction();
  tx.moveCall({
    target: target(ctx.packageId, MODULES.marketDriver, "lane_count"),
    arguments: [tx.object(ctx.ids.marketDriverRegistry), tx.pure.u256(tokenId)]
  });
  const results = await inspect(ctx, tx);
  const val = results[0]?.[0];
  return val !== undefined ? Number(readU64(val)) : 0;
};

// listOwnerTokens: no on-chain fn — use Sui RPC getOwnedObjects.
const listOwnerTokens = async (
  ctx: ReaderContext,
  owner: UserAddress
): Promise<readonly TokenId[]> => {
  try {
    const nftType = `${ctx.packageId}::market_driver::MarketPositionNFT`;
    const owned = await ctx.client.getOwnedObjects({
      owner,
      filter: { StructType: nftType },
      options: { showContent: true }
    });

    const tokenIds: TokenId[] = [];
    for (const obj of owned.data) {
      if (obj.data?.content?.dataType === "moveObject") {
        const fields = obj.data.content.fields as Record<string, unknown>;
        const rawId = fields["token_id"];
        if (rawId !== undefined) {
          tokenIds.push(asTokenId(BigInt(String(rawId))));
        }
      }
    }
    return tokenIds;
  } catch (error) {
    throw suiReadFailed("owner tokens", error);
  }
};

const readNft = async (
  ctx: ReaderContext,
  tokenId: TokenId,
  owner: UserAddress
): Promise<OptionsNft> => {
  try {
    const laneCount = await readLaneCount(ctx, tokenId);
    // Wall clock for effective depletion — parity with EVM; a lane reads depleted the moment its runway
    // elapses in real time, matching the UI countdown (chain clock can lag a frozen dev chain).
    const nowSec = Math.floor(Date.now() / 1000);
    const lanes = [];
    const winningSideByVault = new Map<string, OptionsVaultSide | undefined>();

    for (let i = 0; i < laneCount; i += 1) {
      // Get vault ID for this lane.
      const vaultAtTx = new Transaction();
      vaultAtTx.moveCall({
        target: target(ctx.packageId, MODULES.marketDriver, "lane_vault_at"),
        arguments: [
          vaultAtTx.object(ctx.ids.marketDriverRegistry),
          vaultAtTx.pure.u256(tokenId),
          vaultAtTx.pure.u64(i)
        ]
      });
      const vaultAtResults = await inspect(ctx, vaultAtTx);
      const vaultAtVal = vaultAtResults[0]?.[0];
      if (vaultAtVal === undefined) continue;
      const rawVaultBytes = bcs.vector(bcs.u8()).parse(Uint8Array.from(vaultAtVal[0])) as number[];
      const vaultId = asVaultId(bytesVecToHex(rawVaultBytes));
      const vaultHex = vaultId.startsWith("0x") ? vaultId.slice(2) : vaultId;
      const vaultBytes = Array.from({ length: 32 }, (_, j) =>
        parseInt(vaultHex.slice(j * 2, j * 2 + 2) || "0", 16)
      );

      // Get side and rate for this lane.
      const laneTx = new Transaction();
      laneTx.moveCall({
        target: target(ctx.packageId, MODULES.marketDriver, "lane_at"),
        arguments: [
          laneTx.object(ctx.ids.marketDriverRegistry),
          laneTx.pure.u256(tokenId),
          laneTx.pure(bcs.vector(bcs.u8()).serialize(vaultBytes).toBytes())
        ]
      });
      const laneResults = await inspect(ctx, laneTx);
      const laneVals = laneResults[0] ?? [];
      const side = laneVals[0] !== undefined ? sideFromSuiValue(readU8(laneVals[0])) : "yes";
      const laneRate = laneVals[1] !== undefined ? readU256(laneVals[1]) : 0n;

      // Get position.
      const posTx = new Transaction();
      posTx.moveCall({
        target: target(ctx.packageId, MODULES.vault, "get_position"),
        typeArguments: [ctx.coinType],
        arguments: [
          posTx.object(ctx.ids.vaultRegistry),
          posTx.pure(bcs.vector(bcs.u8()).serialize(vaultBytes).toBytes()),
          posTx.pure.u8(sideToSuiValue(side)),
          posTx.pure.u256(tokenId)
        ]
      });
      const posResults = await inspect(ctx, posTx);
      const posVals = posResults[0] ?? [];
      const position: SuiPosition = {
        rate: posVals[0] !== undefined ? readU256(posVals[0]) : 0n,
        gPaid: posVals[1] !== undefined ? readU256(posVals[1]) : 0n,
        sharesAccrued: posVals[2] !== undefined ? readU256(posVals[2]) : 0n,
        maxEnd: posVals[3] !== undefined ? readU64(posVals[3]) : 0n,
        depleted: posVals[4] !== undefined ? readBool(posVals[4]) : false,
        fundStart: posVals[5] !== undefined ? readU64(posVals[5]) : 0n,
        lostUsdc: posVals[6] !== undefined ? readU256(posVals[6]) : 0n
      };

      const lane = mapSuiLane(tokenId, vaultId, side, laneRate, position, nowSec);

      if (!winningSideByVault.has(vaultId)) {
        const ws = await readWinningSide(ctx, vaultId);
        winningSideByVault.set(vaultId, ws);
      }

      const claimable = await readClaimable(ctx, tokenId, vaultId, side);
      const lossClaimable = await readLossClaimable(ctx, tokenId, vaultId, side);
      lanes.push(
        enrichSuiLane(lane, claimable, lossClaimable, winningSideByVault.get(vaultId))
      );
    }

    // Derive market ID from the first vault's market_id (no public market_id_of accessor).
    let marketId = asMarketId(`0x${"0".repeat(64)}`);
    if (lanes.length > 0) {
      const firstVaultId = lanes[0]!.vaultId;
      try {
        const vaultHex2 = firstVaultId.startsWith("0x") ? firstVaultId.slice(2) : firstVaultId;
        const vaultBytes2 = Array.from({ length: 32 }, (_, j) =>
          parseInt(vaultHex2.slice(j * 2, j * 2 + 2) || "0", 16)
        );
        const mktTx = new Transaction();
        mktTx.moveCall({
          target: target(ctx.packageId, MODULES.vault, "market_id"),
          typeArguments: [ctx.coinType],
          arguments: [
            mktTx.object(ctx.ids.vaultRegistry),
            mktTx.pure(bcs.vector(bcs.u8()).serialize(vaultBytes2).toBytes())
          ]
        });
        const mktResults = await inspect(ctx, mktTx);
        const mktVal = mktResults[0]?.[0];
        if (mktVal !== undefined) {
          const rawMktBytes = bcs.vector(bcs.u8()).parse(Uint8Array.from(mktVal[0])) as number[];
          marketId = asMarketId(bytesVecToHex(rawMktBytes));
        }
      } catch {
        // leave as zero-id if vault lookup fails
      }
    } else {
      // O6: a laneless NFT has no lane[0] to derive the market from. Read the NFT object's OWN
      // market_id field (the MarketPositionNFT struct carries it) so the NFT isn't dropped from the
      // snapshot (snapshot filters by marketId === 0x000…).
      try {
        const nftType = `${ctx.packageId}::market_driver::MarketPositionNFT`;
        const owned = await ctx.client.getOwnedObjects({
          owner,
          filter: { StructType: nftType },
          options: { showContent: true }
        });
        for (const obj of owned.data) {
          if (obj.data?.content?.dataType === "moveObject") {
            const fields = obj.data.content.fields as Record<string, unknown>;
            if (BigInt(String(fields["token_id"])) === tokenId) {
              const raw = fields["market_id"];
              if (Array.isArray(raw)) {
                marketId = asMarketId(bytesVecToHex(raw as number[]));
              }
              break;
            }
          }
        }
      } catch {
        // leave as zero-id if the owned-object scan fails
      }
    }

    return mapSuiNft(tokenId, owner, marketId, laneCount, lanes);
  } catch (error) {
    if (error instanceof LiveStreakConfigError) throw error;
    throw suiReadFailed("nft", error);
  }
};

const readLvstAccount = async (
  ctx: ReaderContext,
  user: UserAddress
): Promise<LvstAccount> => {
  // The user address MUST be normalized to a full 32-byte Sui address before it hits `pure.address`
  // or `getBalance` — a short/unpadded id is the classic "can't resolve the user/LVST objects against
  // the localnet deployment" failure. normalizeSuiAddress is idempotent for already-valid ids.
  const account = normalizeSuiUserAddress(user);

  // LVST wallet balance is the PRIMARY field the board needs to resolve. getBalance returns
  // {totalBalance:"0"} when the user holds no LVST coins, so a 0 here is a real 0 — not an error.
  let balance = 0n;
  try {
    const lvstCoinType = `${ctx.packageId}::lvst::LVST`;
    const balanceRes = await ctx.client.getBalance({ owner: account, coinType: lvstCoinType });
    balance = BigInt(balanceRes.totalBalance);
  } catch (error) {
    if (error instanceof LiveStreakConfigError) throw error;
    throw suiReadFailed("LVST account", error);
  }

  // Staked + pending-dividends are treasury devInspect reads. RESILIENCE: a treasury read that
  // reverts (e.g. the user has never interacted with the treasury, so no per-user entry exists yet)
  // must NOT block Sui connect/board — default to 0 and keep the resolved wallet balance. Without
  // this, the FIRST read in readUserOptionsSnapshot threw and the entire Sui connect failed
  // ("Failed to read LVST account").
  const staked = await readTreasuryU128(ctx, account, "lvst_staked");
  const pendingDividends = await readTreasuryU128(ctx, account, "pending_dividends");

  return mapSuiLvstAccount(user, balance, staked, pendingDividends);
};

// Normalize a user address to Sui's canonical 0x + 64-hex form. Sui Move calls and getBalance reject
// short/unpadded ids; left-pad the hex body to 32 bytes so a derived address always resolves.
const normalizeSuiUserAddress = (user: UserAddress): string => {
  const hex = (user.startsWith("0x") ? user.slice(2) : user).toLowerCase();
  if (hex.length === 0 || hex.length > 64 || /[^0-9a-f]/.test(hex)) {
    return user;
  }
  return `0x${hex.padStart(64, "0")}`;
};

// Read a single-u128 treasury accessor by name; treat a per-user revert as a non-fatal 0 so one
// missing treasury entry can't fail the whole Sui user snapshot (board resolve).
const readTreasuryU128 = async (
  ctx: ReaderContext,
  account: string,
  fn: "lvst_staked" | "pending_dividends"
): Promise<bigint> => {
  try {
    const tx = new Transaction();
    tx.moveCall({
      target: target(ctx.packageId, MODULES.treasury, fn),
      typeArguments: [ctx.coinType],
      arguments: [tx.object(ctx.ids.treasuryRegistry), tx.pure.address(account)]
    });
    const results = await inspect(ctx, tx);
    const val = results[0]?.[0];
    return val !== undefined ? readU128(val) : 0n;
  } catch {
    return 0n;
  }
};

const readUsdcAddress = async (ctx: ReaderContext): Promise<`0x${string}`> => {
  // On Sui, USDC is identified by coin type not address — return the package ID as a placeholder.
  return ctx.packageId as `0x${string}`;
};

const readUsdcBalance = async (ctx: ReaderContext, owner: UserAddress): Promise<bigint> => {
  try {
    const res = await ctx.client.getBalance({ owner, coinType: ctx.coinType });
    return BigInt(res.totalBalance);
  } catch (error) {
    throw suiReadFailed("USDC balance", error);
  }
};

const readNftBalance = async (ctx: ReaderContext, tokenId: TokenId): Promise<bigint> => {
  // streams_state(registry, account_id) → (hash, history_hash, update_time, balance, max_end); account_id
  // is the token_id (same as EVM, where readNftBalance reads Drips streamsState(tokenId).balance).
  try {
    const tx = new Transaction();
    tx.moveCall({
      target: target(ctx.packageId, MODULES.streams, "streams_state"),
      typeArguments: [ctx.coinType],
      arguments: [tx.object(ctx.ids.streamsRegistry), tx.pure.u256(tokenId)]
    });
    const vals = (await inspect(ctx, tx))[0] ?? [];
    return vals[3] !== undefined ? readU128(vals[3]) : 0n;
  } catch (error) {
    throw suiReadFailed("NFT balance", error);
  }
};


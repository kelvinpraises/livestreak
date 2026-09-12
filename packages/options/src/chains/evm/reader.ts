// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";
import { createPublicClient, http, type Abi } from "viem";

import { asMarketId, asTokenId } from "../../model/ids.js";
import type {
  MarketId,
  TokenId,
  UserAddress,
  VaultId
} from "../../model/ids.js";
import type { LvstAccount } from "../../model/lvst.js";
import type { OptionsBoardState } from "../../model/math/accrual.js";
import type { FunderBoundary } from "../../model/math/live-pool.js";
import type { OptionsMarket } from "../../model/market.js";
import type { OptionsNft } from "../../model/nft.js";
import type { OptionsProtocolSummary } from "../../model/snapshot.js";
import type { OptionsStreamState } from "../../model/stream.js";
import type {
  OptionsVault,
  OptionsVaultShareTotals,
  OptionsVaultSide
} from "../../model/vault.js";
import type { OptionsChainConfig, OptionsReader } from "../types.js";
import { DEFAULT_ABIS, type OptionsContractAbis } from "./abis.js";
import {
  validateOptionsContractAddresses,
  type OptionsContractAddresses
} from "./addresses.js";
import {
  bytes32ToHex,
  contractsReadFailed,
  contractsReadNotFound,
  enrichLane,
  mapApprovedAddress,
  mapBoard,
  mapLane,
  mapLvstAccount,
  mapMarket,
  mapNft,
  mapProtocolSummary,
  mapStreamState,
  mapStreamsStateBalance,
  mapStreamsStateLive,
  mapVault,
  mapVaultIds,
  mapVaultShareTotals,
  tupleToObject,
  type RawBoard,
  type RawDisputeState,
  type RawHotState,
  type RawLane,
  type RawMarketData,
  type RawPosition,
  type RawStreamState,
  type RawStreamsState,
  type RawVaultData,
  type RawVaultPools
} from "./decode.js";
import {
  sideFromSolidityValue,
  sideToSolidityValue,
  validateMarketIdForContracts,
  validateTokenIdForContracts,
  validateUserAddress,
  validateVaultIdForContracts,
  validateContractAddress
} from "./encode.js";

type ReaderContext = {
  readonly contractCall: EvmContractCall;
  readonly addresses: OptionsContractAddresses;
  readonly abis: OptionsContractAbis;
  readonly transferOperator?: UserAddress;
  usdcAddress?: `0x${string}`;
  dripsAddress?: `0x${string}`;
};

export type EvmContractCall = (
  address: `0x${string}`,
  abi: readonly unknown[],
  functionName: string,
  args?: readonly unknown[]
) => Promise<unknown>;

export const createEvmOptionsReaderFromCall = (
  addresses: OptionsContractAddresses,
  contractCall: EvmContractCall,
  options: {
    readonly transferOperator?: UserAddress;
    readonly includeProtocolSummary?: boolean;
  } = {}
): OptionsReader => {
  const ctx: ReaderContext = {
    contractCall,
    addresses: validateOptionsContractAddresses(addresses),
    abis: DEFAULT_ABIS,
    ...(options.transferOperator === undefined
      ? {}
      : { transferOperator: validateUserAddress(options.transferOperator, "transferOperator") })
  };

  const reader = buildReader(ctx);

  if (options.includeProtocolSummary === true) {
    reader.readProtocolSummary = async () => loadProtocolSummary(ctx);
  }

  return reader;
};

export const createEvmOptionsReader = (config: OptionsChainConfig): OptionsReader => {
  if (config.walletInit.chain !== "evm") {
    throw new LiveStreakConfigError({
      message: "EVM options reader requires walletInit.chain === evm"
    });
  }

  const evmConfig = config.walletInit.config as { provider: string };
  const rpcUrl = config.readRpcUrl ?? String(evmConfig.provider);
  const publicClient = createPublicClient({ transport: http(rpcUrl) });

  return createEvmOptionsReaderFromCall(
    config.addresses as OptionsContractAddresses,
    async <T,>(
      address: `0x${string}`,
      abi: readonly unknown[],
      functionName: string,
      args: readonly unknown[] = []
    ) =>
      publicClient.readContract({
        address,
        abi: abi as Abi,
        functionName,
        args: args as readonly unknown[] | undefined
      }) as Promise<T>,
    {
      ...(config.transferOperator === undefined
        ? {}
        : { transferOperator: config.transferOperator }),
      ...(config.includeProtocolSummary === true ? { includeProtocolSummary: true } : {})
    }
  );
};

const buildReader = (ctx: ReaderContext): OptionsReader => ({
  readMarket: (marketId) => readMarket(ctx, marketId),
  readStreamState: (marketId) => readStreamState(ctx, marketId),
  listMarketIds: () => listMarketIds(ctx),
  listMarketVaults: (marketId) => listMarketVaults(ctx, marketId),
  readVault: (vaultId) => readVault(ctx, vaultId),
  readVaultShareTotals: (vaultId) => readVaultShareTotals(ctx, vaultId),
  listOwnerTokens: (owner) => listOwnerTokens(ctx, owner),
  readNft: (tokenId, owner) => readNft(ctx, tokenId, owner),
  readLvstAccount: (user) => readLvstAccount(ctx, user),
  readClaimable: (tokenId, vaultId, side) => readClaimable(ctx, tokenId, vaultId, side),
  readLossClaimable: (tokenId, vaultId, side) =>
    readLossClaimable(ctx, tokenId, vaultId, side),
  readPot: (vaultId) => readPot(ctx, vaultId),
  readCollected: (vaultId) => readCollected(ctx, vaultId),
  readAccountVaultIds: (tokenId) => readAccountVaultIds(ctx, tokenId),
  readWinningSide: (vaultId) => readWinningSide(ctx, vaultId),
  readBoard: (vaultId, side) => readBoard(ctx, vaultId, side),
  readSharePrice: (vaultId, side) => readSharePrice(ctx, vaultId, side),
  readPendingBoundaries: (vaultId, side) => readPendingBoundaries(ctx, vaultId, side),
  readBoundaries: (vaultId, side) => readBoundaries(ctx, vaultId, side),
  readPendingShares: (vaultId, side, tokenId) =>
    readPendingShares(ctx, vaultId, side, tokenId),
  readUsdcAddress: () => readUsdcAddress(ctx),
  readUsdcBalance: (owner) => readUsdcBalance(ctx, owner),
  readNftBalance: (tokenId) => readNftBalance(ctx, tokenId),
  readOwnerOf: (tokenId) => readOwnerOf(ctx, tokenId),
  readApproved: (tokenId) => readApproved(ctx, tokenId),
  readIsApprovedForAll: (owner, operator) => readIsApprovedForAll(ctx, owner, operator)
});

// --- reads ---

const call = async <T>(
  ctx: ReaderContext,
  address: `0x${string}`,
  abi: readonly unknown[],
  functionName: string,
  args: readonly unknown[] = []
): Promise<T> => (await ctx.contractCall(address, abi, functionName, args)) as T;

const readMarket = async (ctx: ReaderContext, marketId: MarketId): Promise<OptionsMarket> => {
  const marketBytes = validateMarketIdForContracts(marketId);

  try {
    const exists = await call<boolean>(
      ctx,
      ctx.addresses.marketRegistry,
      ctx.abis.MarketRegistry,
      "marketExists",
      [marketBytes]
    );

    if (!exists) {
      throw contractsReadNotFound("market", marketId);
    }

    const market = await call<RawMarketData>(
      ctx,
      ctx.addresses.marketRegistry,
      ctx.abis.MarketRegistry,
      "getMarket",
      [marketBytes]
    );

    const vaultIdsRaw = await call<readonly `0x${string}`[]>(
      ctx,
      ctx.addresses.marketRegistry,
      ctx.abis.MarketRegistry,
      "getVaultIds",
      [marketBytes]
    );

    return mapMarket(asMarketId(bytes32ToHex(market.id)), market, mapVaultIds(vaultIdsRaw));
  } catch (error) {
    if (error instanceof LiveStreakConfigError) {
      throw error;
    }

    throw contractsReadFailed("market", error);
  }
};

const readStreamState = async (
  ctx: ReaderContext,
  marketId: MarketId
): Promise<OptionsStreamState> => {
  const marketBytes = validateMarketIdForContracts(marketId);

  try {
    const stateRaw = await call<unknown>(
      ctx,
      ctx.addresses.marketRegistry,
      ctx.abis.MarketRegistry,
      "streamState",
      [marketBytes]
    );
    const state = tupleToObject<RawStreamState>(stateRaw, [
      "status",
      "scheme",
      "id",
      "updatedAt",
      "endedAt"
    ]);

    return mapStreamState(state);
  } catch (error) {
    if (error instanceof LiveStreakConfigError) {
      throw error;
    }

    throw contractsReadFailed("stream state", error);
  }
};

// Enumerate every registered market straight off the registry (marketCount + marketIdAt).
// The host indexer uses this so observe-registered markets surface on the homepage without
// relying on the in-memory discovery store or an env seed.
const listMarketIds = async (ctx: ReaderContext): Promise<readonly MarketId[]> => {
  const marketCount = await call<bigint>(
    ctx,
    ctx.addresses.marketRegistry,
    ctx.abis.MarketRegistry,
    "marketCount",
    []
  );
  const count = Number(marketCount);
  const ids: MarketId[] = [];
  for (let index = 0; index < count; index += 1) {
    const raw = await call<`0x${string}`>(
      ctx,
      ctx.addresses.marketRegistry,
      ctx.abis.MarketRegistry,
      "marketIdAt",
      [BigInt(index)]
    );
    ids.push(asMarketId(raw));
  }
  return ids;
};

const listMarketVaults = async (
  ctx: ReaderContext,
  marketId: MarketId
): Promise<readonly VaultId[]> => {
  const market = await readMarket(ctx, marketId);
  return market.vaultIds;
};

const loadProtocolSummary = async (ctx: ReaderContext): Promise<OptionsProtocolSummary> => {
  try {
    const marketCount = await call<bigint>(
      ctx,
      ctx.addresses.marketRegistry,
      ctx.abis.MarketRegistry,
      "marketCount",
      []
    );

    let vaultCount = 0;
    const count = Number(marketCount);

    for (let index = 0; index < count; index += 1) {
      const marketId = await call<`0x${string}`>(
        ctx,
        ctx.addresses.marketRegistry,
        ctx.abis.MarketRegistry,
        "marketIdAt",
        [BigInt(index)]
      );
      const ids = await call<readonly `0x${string}`[]>(
        ctx,
        ctx.addresses.marketRegistry,
        ctx.abis.MarketRegistry,
        "getVaultIds",
        [marketId]
      );
      vaultCount += ids.length;
    }

    return mapProtocolSummary(marketCount, vaultCount);
  } catch (error) {
    throw contractsReadFailed("protocol summary", error);
  }
};

const readVault = async (ctx: ReaderContext, vaultId: VaultId): Promise<OptionsVault> => {
  const vaultBytes = validateVaultIdForContracts(vaultId);

  try {
    const data = await call<RawVaultData>(ctx, ctx.addresses.vault, ctx.abis.Vault, "getVault", [
      vaultBytes
    ]);

    if (!data.exists) {
      throw contractsReadNotFound("vault", vaultId);
    }

    const poolsRaw = await call<unknown>(
      ctx,
      ctx.addresses.vault,
      ctx.abis.Vault,
      "getVaultPools",
      [vaultBytes]
    );
    const pools = tupleToObject<RawVaultPools>(poolsRaw, [
      "yesTotal",
      "noTotal",
      "yesShareTotal",
      "noShareTotal"
    ]);

    const hotRaw = await call<unknown>(
      ctx,
      ctx.addresses.stewardRegistry,
      ctx.abis.StewardRegistry,
      "vaultHotState",
      [vaultBytes]
    );
    const hot = tupleToObject<RawHotState>(hotRaw, [
      "active",
      "until",
      "severity",
      "reasonHash"
    ]);

    const disputeRaw = await call<unknown>(
      ctx,
      ctx.addresses.stewardRegistry,
      ctx.abis.StewardRegistry,
      "disputeState",
      [vaultBytes]
    );
    const dispute = tupleToObject<RawDisputeState>(disputeRaw, [
      "active",
      "challengeUntil",
      "proofRef"
    ]);

    return mapVault(data, pools, hot, dispute);
  } catch (error) {
    if (error instanceof LiveStreakConfigError) {
      throw error;
    }

    throw contractsReadFailed("vault", error);
  }
};

const readVaultPools = async (ctx: ReaderContext, vaultId: VaultId): Promise<RawVaultPools> => {
  const vaultBytes = validateVaultIdForContracts(vaultId);
  const poolsRaw = await call<unknown>(ctx, ctx.addresses.vault, ctx.abis.Vault, "getVaultPools", [
    vaultBytes
  ]);
  return tupleToObject<RawVaultPools>(poolsRaw, [
    "yesTotal",
    "noTotal",
    "yesShareTotal",
    "noShareTotal"
  ]);
};

const readVaultShareTotals = async (
  ctx: ReaderContext,
  vaultId: VaultId
): Promise<OptionsVaultShareTotals> => {
  const poolsRaw = await readVaultPools(ctx, vaultId);
  return mapVaultShareTotals(poolsRaw);
};

const readBoard = async (
  ctx: ReaderContext,
  vaultId: VaultId,
  side: OptionsVaultSide
): Promise<OptionsBoardState> => {
  const vaultBytes = validateVaultIdForContracts(vaultId);

  try {
    const boardRaw = await call<unknown>(ctx, ctx.addresses.vault, ctx.abis.Vault, "getBoard", [
      vaultBytes,
      sideToSolidityValue(side)
    ]);
    const board = tupleToObject<RawBoard>(boardRaw, [
      "pool",
      "sideRate",
      "g",
      "lastAdvance"
    ]);

    return mapBoard(board);
  } catch (error) {
    throw contractsReadFailed("board", error);
  }
};

const readSharePrice = async (
  ctx: ReaderContext,
  vaultId: VaultId,
  side: OptionsVaultSide
): Promise<bigint> => {
  const vaultBytes = validateVaultIdForContracts(vaultId);

  try {
    return await call<bigint>(ctx, ctx.addresses.vault, ctx.abis.Vault, "getSharePrice", [
      vaultBytes,
      sideToSolidityValue(side)
    ]);
  } catch (error) {
    throw contractsReadFailed("share price", error);
  }
};

const readPendingBoundaries = async (
  ctx: ReaderContext,
  vaultId: VaultId,
  side: OptionsVaultSide
): Promise<bigint> => {
  const vaultBytes = validateVaultIdForContracts(vaultId);

  try {
    return await call<bigint>(ctx, ctx.addresses.vault, ctx.abis.Vault, "pendingBoundaries", [
      vaultBytes,
      sideToSolidityValue(side)
    ]);
  } catch (error) {
    throw contractsReadFailed("pending boundaries", error);
  }
};

const readPendingShares = async (
  ctx: ReaderContext,
  vaultId: VaultId,
  side: OptionsVaultSide,
  tokenId: TokenId
): Promise<bigint> => {
  const vaultBytes = validateVaultIdForContracts(vaultId);
  const id = validateTokenIdForContracts(tokenId);

  try {
    return await call<bigint>(ctx, ctx.addresses.vault, ctx.abis.Vault, "pendingShares", [
      vaultBytes,
      sideToSolidityValue(side),
      id
    ]);
  } catch (error) {
    throw contractsReadFailed("pending shares", error);
  }
};

const readClaimable = async (
  ctx: ReaderContext,
  tokenId: TokenId,
  vaultId: VaultId,
  side: OptionsVaultSide
): Promise<bigint> => {
  const id = validateTokenIdForContracts(tokenId);
  const vaultBytes = validateVaultIdForContracts(vaultId);

  try {
    return await call<bigint>(ctx, ctx.addresses.vault, ctx.abis.Vault, "claimable", [
      id,
      vaultBytes,
      sideToSolidityValue(side)
    ]);
  } catch (error) {
    throw contractsReadFailed("claimable", error);
  }
};

const readLossClaimable = async (
  ctx: ReaderContext,
  tokenId: TokenId,
  vaultId: VaultId,
  side: OptionsVaultSide
): Promise<bigint> => {
  const id = validateTokenIdForContracts(tokenId);
  const vaultBytes = validateVaultIdForContracts(vaultId);

  try {
    return await call<bigint>(ctx, ctx.addresses.vault, ctx.abis.Vault, "lossClaimable", [
      id,
      vaultBytes,
      sideToSolidityValue(side)
    ]);
  } catch (error) {
    throw contractsReadFailed("loss claimable", error);
  }
};

const readPot = async (ctx: ReaderContext, vaultId: VaultId): Promise<bigint> => {
  const vaultBytes = validateVaultIdForContracts(vaultId);

  try {
    return await call<bigint>(ctx, ctx.addresses.vault, ctx.abis.Vault, "pot", [vaultBytes]);
  } catch (error) {
    throw contractsReadFailed("pot", error);
  }
};

const readCollected = async (ctx: ReaderContext, vaultId: VaultId): Promise<boolean> => {
  const vaultBytes = validateVaultIdForContracts(vaultId);

  try {
    return await call<boolean>(ctx, ctx.addresses.vault, ctx.abis.Vault, "collected", [vaultBytes]);
  } catch (error) {
    throw contractsReadFailed("collected", error);
  }
};

const readAccountVaultIds = async (
  ctx: ReaderContext,
  tokenId: TokenId
): Promise<readonly VaultId[]> => {
  const id = validateTokenIdForContracts(tokenId);

  try {
    const vaultIds = await call<readonly `0x${string}`[]>(
      ctx,
      ctx.addresses.vault,
      ctx.abis.Vault,
      "getAccountVaultIds",
      [id]
    );

    return mapVaultIds(vaultIds);
  } catch (error) {
    throw contractsReadFailed("account vault ids", error);
  }
};

const readWinningSide = async (
  ctx: ReaderContext,
  vaultId: VaultId
): Promise<OptionsVaultSide | undefined> => {
  const vault = await readVault(ctx, vaultId);

  if (vault.status !== "resolved") {
    return undefined;
  }

  const vaultBytes = validateVaultIdForContracts(vaultId);

  try {
    const side = await call<number>(ctx, ctx.addresses.vault, ctx.abis.Vault, "winningSide", [
      vaultBytes
    ]);

    return sideFromSolidityValue(side);
  } catch (error) {
    throw contractsReadFailed("winning side", error);
  }
};

const listOwnerTokens = async (
  ctx: ReaderContext,
  owner: UserAddress
): Promise<readonly TokenId[]> => {
  const account = validateUserAddress(owner);

  try {
    const tokenIds = await call<readonly bigint[]>(
      ctx,
      ctx.addresses.marketDriver,
      ctx.abis.MarketDriver,
      "tokensOfOwner",
      [account as `0x${string}`]
    );

    return tokenIds.map((id) => asTokenId(id));
  } catch (error) {
    throw contractsReadFailed("owner tokens", error);
  }
};

const readNft = async (
  ctx: ReaderContext,
  tokenId: TokenId,
  owner: UserAddress
): Promise<OptionsNft> => {
  const id = validateTokenIdForContracts(tokenId);
  const account = validateUserAddress(owner);

  try {
    const marketIdRaw = await call<`0x${string}`>(
      ctx,
      ctx.addresses.marketDriver,
      ctx.abis.MarketDriver,
      "marketIdOf",
      [id]
    );

    const laneCount = await call<bigint>(
      ctx,
      ctx.addresses.marketDriver,
      ctx.abis.MarketDriver,
      "laneCount",
      [id]
    );

    const count = Number(laneCount);
    // Wall clock for the effective-depletion check: a lane reads depleted the moment its runway elapses
    // in real time, matching the UI countdown (chain block.timestamp freezes between txs on a dev chain).
    const nowSec = Math.floor(Date.now() / 1000);

    // Active lanes (in _laneKeys): (vaultId:side) → on-chain bookkeeping rate. This IS the committedRate
    // setLanes re-asserts; a side with no entry here has no active stream (paused/depleted by balance).
    const activeRates = new Map<string, bigint>();
    for (let index = 0; index < count; index += 1) {
      const laneRaw = await call<unknown>(
        ctx,
        ctx.addresses.marketDriver,
        ctx.abis.MarketDriver,
        "laneAt",
        [id, BigInt(index)]
      );
      const lane = tupleToObject<RawLane>(laneRaw, ["vaultId", "side", "rate"]);
      activeRates.set(`${bytes32ToHex(lane.vaultId)}:${sideFromSolidityValue(lane.side)}`, lane.rate);
    }

    // Positions come from the SHARE LEDGER, not the active lanes: getAccountVaultIds is append-only (every
    // vault ever funded, never pruned), so a swept / switched-away / depleted side keeps surfacing its
    // banked shares instead of vanishing. Read BOTH sides per vault to show sequential-hedge legs.
    const vaultIds = await readAccountVaultIds(ctx, asTokenId(id));
    const winningSideByVault = new Map<string, OptionsVaultSide | undefined>();
    const lanes = [];
    let totalActiveRate = 0n;

    for (const vaultId of vaultIds) {
      const vaultBytes = validateVaultIdForContracts(vaultId);
      let winningSide = winningSideByVault.get(vaultId);
      if (!winningSideByVault.has(vaultId)) {
        winningSide = await readWinningSide(ctx, vaultId);
        winningSideByVault.set(vaultId, winningSide);
      }

      for (const side of ["yes", "no"] as const) {
        const positionRaw = await call<unknown>(
          ctx,
          ctx.addresses.vault,
          ctx.abis.Vault,
          "getPosition",
          [vaultBytes, sideToSolidityValue(side), id]
        );
        const position = tupleToObject<RawPosition>(positionRaw, [
          "rate",
          "gPaid",
          "sharesAccrued",
          "maxEnd",
          "depleted"
        ]);

        const committedRate = activeRates.get(`${vaultId}:${side}`) ?? 0n;
        // Never-touched side: no banked shares and no active lane — skip.
        if (position.sharesAccrued === 0n && position.rate === 0n && committedRate === 0n) {
          continue;
        }
        totalActiveRate += committedRate;

        const rawLane: RawLane = {
          vaultId: vaultBytes,
          side: sideToSolidityValue(side),
          rate: committedRate
        };
        const mapped = mapLane(asTokenId(id), rawLane, position, nowSec);
        const claimable = await readClaimable(ctx, asTokenId(id), vaultId, side);
        const lossClaimable = await readLossClaimable(ctx, asTokenId(id), vaultId, side);
        lanes.push(enrichLane(mapped, claimable, lossClaimable, winningSide));
      }
    }

    const transferFlags = await readTransferFlags(ctx, id);

    // Account balance: LIVE balance + runway. Live = stored − streamed-since-update at the total active
    // rate (see mapStreamsStateLive) so the UI shows the real draining number, not the stale stored value.
    let nftAccount: { balance?: bigint; runwayEndMs?: number } | undefined;
    try {
      const usdc = await readUsdcAddress(ctx);
      const drips = await readDripsAddress(ctx);
      const streamsStateRaw = await call<unknown>(
        ctx,
        drips,
        ctx.abis.DripsStreaming,
        "streamsState",
        [id, usdc]
      );
      const streamsState = tupleToObject<RawStreamsState>(streamsStateRaw, [
        "streamsHash",
        "streamsHistoryHash",
        "updateTime",
        "balance",
        "maxEnd"
      ]);
      nftAccount = mapStreamsStateLive(streamsState, totalActiveRate, nowSec);
    } catch {
      // Non-fatal: balance/runway stay undefined if Drips is unavailable.
    }

    return mapNft(
      asTokenId(id),
      account,
      asMarketId(bytes32ToHex(marketIdRaw)),
      count,
      lanes,
      transferFlags,
      nftAccount
    );
  } catch (error) {
    if (error instanceof LiveStreakConfigError) {
      throw error;
    }

    throw contractsReadFailed("nft", error);
  }
};

const readNftBalance = async (ctx: ReaderContext, tokenId: TokenId): Promise<bigint> => {
  const id = validateTokenIdForContracts(tokenId);

  try {
    const usdc = await readUsdcAddress(ctx);
    const stateRaw = await call<unknown>(
      ctx,
      ctx.addresses.dripsStreaming,
      ctx.abis.DripsStreaming,
      "streamsState",
      [id, usdc]
    );
    const state = tupleToObject<RawStreamsState>(stateRaw, [
      "streamsHash",
      "streamsHistoryHash",
      "updateTime",
      "balance",
      "maxEnd"
    ]);

    return mapStreamsStateBalance(state);
  } catch (error) {
    throw contractsReadFailed("NFT balance", error);
  }
};

const readOwnerOf = async (ctx: ReaderContext, tokenId: TokenId): Promise<UserAddress> => {
  const id = validateTokenIdForContracts(tokenId);

  try {
    const owner = await call<`0x${string}`>(
      ctx,
      ctx.addresses.marketDriver,
      ctx.abis.MarketDriver,
      "ownerOf",
      [id]
    );

    return validateUserAddress(owner, "ownerOf");
  } catch (error) {
    throw contractsReadFailed("ownerOf", error);
  }
};

const readApproved = async (
  ctx: ReaderContext,
  tokenId: TokenId
): Promise<UserAddress | undefined> => {
  const id = validateTokenIdForContracts(tokenId);

  try {
    const approved = await call<`0x${string}`>(
      ctx,
      ctx.addresses.marketDriver,
      ctx.abis.MarketDriver,
      "getApproved",
      [id]
    );

    return mapApprovedAddress(approved);
  } catch (error) {
    throw contractsReadFailed("getApproved", error);
  }
};

const readIsApprovedForAll = async (
  ctx: ReaderContext,
  owner: UserAddress,
  operator: UserAddress
): Promise<boolean> => {
  const account = validateUserAddress(owner);
  const approvedOperator = validateUserAddress(operator, "operator");

  try {
    return await call<boolean>(
      ctx,
      ctx.addresses.marketDriver,
      ctx.abis.MarketDriver,
      "isApprovedForAll",
      [account as `0x${string}`, approvedOperator as `0x${string}`]
    );
  } catch (error) {
    throw contractsReadFailed("isApprovedForAll", error);
  }
};

const readUsdcAddress = async (ctx: ReaderContext): Promise<`0x${string}`> => {
  if (ctx.usdcAddress !== undefined) {
    return ctx.usdcAddress;
  }

  try {
    const address = await call<`0x${string}`>(
      ctx,
      ctx.addresses.marketDriver,
      ctx.abis.MarketDriver,
      "USDC",
      []
    );
    ctx.usdcAddress = validateContractAddress(address, "USDC");
    return ctx.usdcAddress;
  } catch (error) {
    throw contractsReadFailed("USDC address", error);
  }
};

// The streaming contract the MarketDriver ACTUALLY uses for this NFT's Drips account — read straight
// off MarketDriver.DRIPS(), not the deployment's `dripsStreaming` field, which can point at a
// different Drips instance. Querying the wrong one returns an all-zero streamsState, which surfaced
// as a position NFT stuck at "$0.00 balance / — runway" even while it was actively streaming.
const readDripsAddress = async (ctx: ReaderContext): Promise<`0x${string}`> => {
  if (ctx.dripsAddress !== undefined) {
    return ctx.dripsAddress;
  }

  try {
    const address = await call<`0x${string}`>(
      ctx,
      ctx.addresses.marketDriver,
      ctx.abis.MarketDriver,
      "DRIPS",
      []
    );
    ctx.dripsAddress = validateContractAddress(address, "DRIPS");
    return ctx.dripsAddress;
  } catch (error) {
    throw contractsReadFailed("DRIPS address", error);
  }
};

// The canonical unsettled funder depletion schedule for (vaultId, side), straight from the contract
// (Vault.getBoundaries applies the same validity gate `_advance`/`_previewG` use). Each entry's rate
// is still summed into board.sideRate, so the live-pool projection caps exactly at what was funded —
// covering every funder (seed + all NFTs), not a per-connected-user reconstruction.
const readBoundaries = async (
  ctx: ReaderContext,
  vaultId: VaultId,
  side: OptionsVaultSide
): Promise<readonly FunderBoundary[]> => {
  const vaultBytes = validateVaultIdForContracts(vaultId);
  try {
    const [maxEnds, rates] = await call<readonly [readonly number[], readonly bigint[]]>(
      ctx,
      ctx.addresses.vault,
      ctx.abis.Vault,
      "getBoundaries",
      [vaultBytes, sideToSolidityValue(side)]
    );
    return maxEnds.map((maxEnd, i) => ({ maxEndMs: Number(maxEnd) * 1000, rate: rates[i]! }));
  } catch (error) {
    throw contractsReadFailed("boundaries", error);
  }
};

const readUsdcBalance = async (ctx: ReaderContext, owner: UserAddress): Promise<bigint> => {
  const account = validateUserAddress(owner);
  const usdc = await readUsdcAddress(ctx);

  try {
    return await call<bigint>(ctx, usdc, ctx.abis.LvstToken, "balanceOf", [
      account as `0x${string}`
    ]);
  } catch (error) {
    throw contractsReadFailed("USDC balance", error);
  }
};

const readLvstAccount = async (ctx: ReaderContext, user: UserAddress): Promise<LvstAccount> => {
  const account = validateUserAddress(user);

  try {
    const balance = await call<bigint>(
      ctx,
      ctx.addresses.lvstToken,
      ctx.abis.LvstToken,
      "balanceOf",
      [account as `0x${string}`]
    );

    const staked = await call<bigint>(
      ctx,
      ctx.addresses.treasury,
      ctx.abis.Treasury,
      "lvstStaked",
      [account as `0x${string}`]
    );

    const pendingDividends = await call<bigint>(
      ctx,
      ctx.addresses.treasury,
      ctx.abis.Treasury,
      "lvstPendingDividends",
      [account as `0x${string}`]
    );

    return mapLvstAccount(account, balance, staked, pendingDividends);
  } catch (error) {
    throw contractsReadFailed("LVST account", error);
  }
};

const readTransferFlags = async (
  ctx: ReaderContext,
  tokenId: bigint
): Promise<{ readonly approved?: UserAddress; readonly isOperator?: boolean }> => {
  const [approved, ownerOnChain] = await Promise.all([
    readApproved(ctx, asTokenId(tokenId)),
    readOwnerOf(ctx, asTokenId(tokenId))
  ]);

  const isOperator =
    ctx.transferOperator === undefined
      ? undefined
      : await readIsApprovedForAll(ctx, ownerOnChain, ctx.transferOperator);

  if (approved === undefined && isOperator === undefined) {
    return {};
  }

  return {
    ...(approved === undefined ? {} : { approved }),
    ...(isOperator === undefined ? {} : { isOperator })
  };
};

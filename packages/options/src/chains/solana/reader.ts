// --- exports ---

// The Solana options reader. THE architectural win: nearly the whole surface collapses into ONE
// account fetch per market — decode the ProtocolState blob into a byte-exact EngineView and serve
// every vault/board/position read locally (no per-field devInspect round-trips like Sui). Market +
// position-owner metadata come from the small non-engine PDAs via the wallet's account decoders.
// Multichain-hygiene: @livestreak/wallet is the single @solana/* owner — all RPC + codecs + PDAs +
// decoders come from its re-exports; ProtocolState decoding via @livestreak/contracts/solana.
import { LiveStreakConfigError } from "@livestreak/core";
import {
  accountDiscriminator,
  address,
  decodeMarketAccount,
  decodePositionOwnerAccount,
  findMarketPda,
  findPositionPda,
  findProtocolStatePda,
  findUsdcAta,
  getBase58Decoder,
  getBase64Encoder,
  type Hex32
} from "@livestreak/wallet";
import { decodeProtocolState, type EngineView } from "@livestreak/contracts/solana";

import { asMarketId, asTokenId, asVaultId } from "../../model/ids.js";
import type { LvstAccount } from "../../model/lvst.js";
import type { MarketId, TokenId, UserAddress, VaultId } from "../../model/ids.js";
import type { OptionsBoardState } from "../../model/math/accrual.js";
import type { FunderBoundary } from "../../model/math/live-pool.js";
import type { OptionsLane } from "../../model/lane.js";
import type { OptionsMarket } from "../../model/market.js";
import type { OptionsNft } from "../../model/nft.js";
import type { OptionsProtocolSummary } from "../../model/snapshot.js";
import type { OptionsStreamState } from "../../model/stream.js";
import type {
  OptionsVault,
  OptionsVaultShareTotals,
  OptionsVaultSide
} from "../../model/vault.js";
import type { OptionsReader } from "../types.js";
import { validateSolanaUserAddress } from "./account.js";
import {
  fetchAccountBytes,
  listMarketIds as listMarketIdsCtx,
  resolveSolanaContext,
  tokenIdToHex32,
  vaultIdHex,
  withProtocolView,
  type SolanaOptionsContext
} from "./config.js";
import {
  mapSolanaBoard,
  mapSolanaLane,
  mapSolanaLvstAccount,
  mapSolanaMarket,
  mapSolanaNft,
  mapSolanaStreamState,
  mapSolanaVault,
  mapSolanaVaultShareTotals,
  sideFromSolana,
  sideToSolana
} from "./decode.js";

const nowSec = (): number => Math.floor(Date.now() / 1000);
const ZERO_ID = `0x${"0".repeat(64)}`;

const utf8 = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const bytesToHex = (bytes: Uint8Array): string =>
  `0x${Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")}`;

export const createSolanaOptionsReader = (
  ctx: SolanaOptionsContext,
  options?: { readonly includeProtocolSummary?: boolean }
): OptionsReader => {
  // Open the ONE engine view that holds `vaultId` (scanning market shards), run `fn`, always free().
  // Single fetch+decode per candidate market until the owning shard is found.
  const withVaultView = async <T>(
    vaultId: VaultId,
    fn: (view: EngineView, target: Hex32, marketId: Hex32) => T
  ): Promise<T> => {
    const target = vaultIdHex(vaultId);
    for (const marketId of await listMarketIdsCtx(ctx)) {
      const [pda] = await findProtocolStatePda(ctx.programId, marketId);
      const bytes = await fetchAccountBytes(ctx.rpc, pda);
      if (bytes === undefined) continue;
      const view = await decodeProtocolState(bytes);
      try {
        if (view.listVaultIds().some((id) => id.toLowerCase() === target)) {
          return fn(view, target, marketId);
        }
      } finally {
        view.free();
      }
    }
    throw new LiveStreakConfigError({
      message: "Solana: vault not found in any market shard",
      metadata: { details: vaultId }
    });
  };

  // Open the engine view whose engine footprint (accrued vaults or lanes) includes `tokenId`. Returns
  // undefined for a laneless token (freshly minted, never funded — no engine footprint yet).
  const withTokenView = async <T>(
    tokenId: TokenId,
    fn: (view: EngineView, tokenHex: Hex32, marketId: Hex32) => T
  ): Promise<T | undefined> => {
    const tokenHex = tokenIdToHex32(tokenId);
    for (const marketId of await listMarketIdsCtx(ctx)) {
      const [pda] = await findProtocolStatePda(ctx.programId, marketId);
      const bytes = await fetchAccountBytes(ctx.rpc, pda);
      if (bytes === undefined) continue;
      const view = await decodeProtocolState(bytes);
      try {
        if (view.accountVaultIds(tokenHex).length > 0 || view.laneCount(tokenHex) > 0) {
          return fn(view, tokenHex, marketId);
        }
      } finally {
        view.free();
      }
    }
    return undefined;
  };

  const reader: OptionsReader = {
    readMarket: (marketId) => readMarket(ctx, marketId),
    readStreamState: (marketId) => readStreamState(ctx, marketId),
    listMarketIds: () => listMarketIds(ctx),
    listMarketVaults: (marketId) => listMarketVaults(ctx, marketId),

    readVault: (vaultId) =>
      withVaultView(vaultId, (view, target) => {
        const vault = mapSolanaVault(view.vault(target));
        const pools = view.vaultPools(target);
        return { ...vault, pools: { yes: pools.yesPool, no: pools.noPool } } satisfies OptionsVault;
      }),
    readVaultShareTotals: (vaultId) =>
      withVaultView(vaultId, (view, target) => mapSolanaVaultShareTotals(view.vaultPools(target))),
    readWinningSide: (vaultId) =>
      withVaultView(vaultId, (view, target) => {
        const vault = view.vault(target);
        if (vault.status !== 3) return undefined; // STATUS_RESOLVED
        if (vault.outcome === 1) return "yes" as OptionsVaultSide; // OUTCOME_YES
        if (vault.outcome === 2) return "no" as OptionsVaultSide; // OUTCOME_NO
        return undefined;
      }),
    readBoard: (vaultId, side) =>
      withVaultView(vaultId, (view, target) =>
        mapSolanaBoard(view.board(target, sideToSolana(side)))
      ),
    readSharePrice: (vaultId, side) =>
      withVaultView(vaultId, (view, target) => view.sharePrice(target, sideToSolana(side))),
    readPendingBoundaries: (vaultId, side) =>
      withVaultView(vaultId, (view, target) => view.pendingBoundaries(target, sideToSolana(side))),
    readBoundaries: (vaultId, side) =>
      withVaultView(vaultId, (view, target) =>
        view
          .boundaries(target, sideToSolana(side))
          .map((b) => ({ maxEndMs: b.maxEnd * 1000, rate: b.rate }) satisfies FunderBoundary)
      ),
    readPendingShares: (vaultId, side, tokenId) =>
      withVaultView(vaultId, (view, target) =>
        view.pendingShares(target, sideToSolana(side), tokenIdToHex32(tokenId), nowSec())
      ),
    readClaimable: (tokenId, vaultId, side) =>
      withVaultView(vaultId, (view, target) =>
        view.claimable(tokenIdToHex32(tokenId), target, sideToSolana(side))
      ),
    readLossClaimable: (tokenId, vaultId, side) =>
      withVaultView(vaultId, (view, target) =>
        view.lossClaimable(tokenIdToHex32(tokenId), target, sideToSolana(side))
      ),
    readPot: (vaultId) => withVaultView(vaultId, (view, target) => view.pot(target)),
    readCollected: (vaultId) => withVaultView(vaultId, (view, target) => view.collected(target)),

    readAccountVaultIds: async (tokenId) => {
      const result = await withTokenView(tokenId, (view, tokenHex) =>
        view.accountVaultIds(tokenHex).map((id) => asVaultId(id))
      );
      return result ?? [];
    },

    readNft: (tokenId, owner) => readNft(ctx, withTokenView, tokenId, owner),

    listOwnerTokens: (owner) => listOwnerTokens(ctx, owner),

    readLvstAccount: async (user) =>
      // LVST staking/dividends have no on-chain instruction set this phase (money-complete engine ops
      // land later), and LVST balance is a not-yet-deployed SPL mint — return a zeroed account so the
      // board stays functional. Divergence from EVM/Sui (which read real balances). See report.
      mapSolanaLvstAccount(validateSolanaUserAddress(user, "user"), 0n, 0n, 0n) as LvstAccount,

    readUsdcAddress: async () => ctx.usdcMint as unknown as `0x${string}`,
    readUsdcBalance: (owner) => readUsdcBalance(ctx, owner),

    // Engine exposes no per-token Drips balance view; PnL remainingUSDC reads 0 on Solana (parity gap
    // with EVM's streamsState.balance). Documented divergence.
    readNftBalance: async () => 0n,

    readOwnerOf: (tokenId) => readOwnerOf(ctx, tokenId),
    readApproved: async () => {
      throw new LiveStreakConfigError({
        message: "Solana: readApproved not supported (PositionOwner PDA model, no approvals)"
      });
    },
    readIsApprovedForAll: async () => {
      throw new LiveStreakConfigError({
        message: "Solana: readIsApprovedForAll not supported (PositionOwner PDA model, no approvals)"
      });
    }
  };

  if (options?.includeProtocolSummary === true) {
    reader.readProtocolSummary = () => loadProtocolSummary(ctx);
  }

  return reader;
};

// --- reads ---

const readMarket = async (ctx: SolanaOptionsContext, marketId: MarketId): Promise<OptionsMarket> => {
  const [marketPda] = await findMarketPda(ctx.programId, marketId as unknown as Hex32);
  const bytes = await fetchAccountBytes(ctx.rpc, marketPda);
  if (bytes === undefined) {
    throw new LiveStreakConfigError({ message: "Solana: market not found", metadata: { details: marketId } });
  }
  const m = decodeMarketAccount(bytes);

  let vaultIds: readonly VaultId[] = [];
  try {
    vaultIds = await withProtocolView(ctx, marketId as unknown as Hex32, (view) =>
      view.listVaultIds().map((id) => asVaultId(id))
    );
  } catch {
    // ProtocolState not yet allocated (init_protocol not run) — no vaults.
  }

  return mapSolanaMarket(
    asMarketId(m.marketId),
    utf8(m.title),
    validateSolanaUserAddress(String(m.creator), "creator"),
    bytesToHex(m.streamId),
    m.createdAt,
    vaultIds
  );
};

const readStreamState = async (
  ctx: SolanaOptionsContext,
  marketId: MarketId
): Promise<OptionsStreamState> => {
  const [marketPda] = await findMarketPda(ctx.programId, marketId as unknown as Hex32);
  const bytes = await fetchAccountBytes(ctx.rpc, marketPda);
  if (bytes === undefined) {
    throw new LiveStreakConfigError({ message: "Solana: market not found", metadata: { details: marketId } });
  }
  const m = decodeMarketAccount(bytes);
  return mapSolanaStreamState({
    status: m.streamStatus,
    scheme: m.streamScheme,
    pointer: utf8(m.streamPointer),
    endedAtSec: m.streamEndedAt,
    updatedAtSec: m.streamUpdatedAt
  });
};

const listMarketIds = async (ctx: SolanaOptionsContext): Promise<readonly MarketId[]> =>
  (await listMarketIdsCtx(ctx)).map((id) => asMarketId(id));

const listMarketVaults = async (
  ctx: SolanaOptionsContext,
  marketId: MarketId
): Promise<readonly VaultId[]> => {
  try {
    return await withProtocolView(ctx, marketId as unknown as Hex32, (view) =>
      view.listVaultIds().map((id) => asVaultId(id))
    );
  } catch {
    return [];
  }
};

const readNft = async (
  ctx: SolanaOptionsContext,
  withTokenView: <T>(
    tokenId: TokenId,
    fn: (view: EngineView, tokenHex: Hex32, marketId: Hex32) => T
  ) => Promise<T | undefined>,
  tokenId: TokenId,
  owner: UserAddress
): Promise<OptionsNft> => {
  const now = nowSec();
  const nft = await withTokenView(tokenId, (view, tokenHex, marketId) => {
    const laneCount = view.laneCount(tokenHex);
    const lanes: OptionsLane[] = [];
    for (const vId of view.accountVaultIds(tokenHex)) {
      const vault = view.vault(vId);
      const winning: OptionsVaultSide | undefined =
        vault.status === 3
          ? vault.outcome === 1
            ? "yes"
            : vault.outcome === 2
              ? "no"
              : undefined
          : undefined;
      for (const sideNum of [0, 1] as const) {
        const pos = view.position(vId, sideNum, tokenHex);
        if (pos.rate === 0n && pos.sharesAccrued === 0n && pos.gPaid === 0n) continue;
        const claimable = view.claimable(tokenHex, vId, sideNum);
        const lossClaimable = view.lossClaimable(tokenHex, vId, sideNum);
        lanes.push(
          mapSolanaLane(
            tokenId,
            asVaultId(vId),
            sideFromSolana(sideNum),
            pos,
            now,
            claimable,
            lossClaimable,
            winning
          )
        );
      }
    }
    return mapSolanaNft(tokenId, owner, asMarketId(marketId), laneCount, lanes);
  });

  // Laneless token (minted, not yet funded): no engine shard owns it, so the market can't be derived
  // from engine state. Return a zero-market NFT (dropped by the snapshot market filter until it funds
  // — the same tradeoff EVM/Sui's laneless case carried before per-token market accessors). See report.
  return nft ?? mapSolanaNft(tokenId, owner, asMarketId(ZERO_ID), 0, []);
};

const listOwnerTokens = async (
  ctx: SolanaOptionsContext,
  owner: UserAddress
): Promise<readonly TokenId[]> => {
  // No on-chain owner→tokens index — scan PositionOwner PDAs by discriminator + owner memcmp. Owner
  // field sits at offset 40 (8 discriminator + 32 token_id); its base58 IS the owner address string.
  const disc = accountDiscriminator("PositionOwner");
  const discBase58 = getBase58Decoder().decode(disc);
  const response = await ctx.rpc
    .getProgramAccounts(ctx.programId, {
      encoding: "base64",
      filters: [
        { memcmp: { offset: 0n, bytes: discBase58 as never, encoding: "base58" } },
        { memcmp: { offset: 40n, bytes: String(owner) as never, encoding: "base58" } }
      ]
    })
    .send();
  const accounts = Array.isArray(response)
    ? response
    : ((response as { value?: unknown[] }).value ?? []);
  const tokens: TokenId[] = [];
  for (const acc of accounts as Array<{ account: { data: [string, string] } }>) {
    const [data] = acc.account.data;
    const bytes = new Uint8Array(getBase64Encoder().encode(data));
    tokens.push(asTokenId(BigInt(decodePositionOwnerAccount(bytes).tokenId)));
  }
  return tokens;
};

const readOwnerOf = async (ctx: SolanaOptionsContext, tokenId: TokenId): Promise<UserAddress> => {
  const [posPda] = await findPositionPda(ctx.programId, tokenIdToHex32(tokenId));
  const bytes = await fetchAccountBytes(ctx.rpc, posPda);
  if (bytes === undefined) {
    throw new LiveStreakConfigError({
      message: "Solana: position owner not found",
      metadata: { details: tokenId.toString() }
    });
  }
  return validateSolanaUserAddress(String(decodePositionOwnerAccount(bytes).owner), "owner");
};

const readUsdcBalance = async (ctx: SolanaOptionsContext, owner: UserAddress): Promise<bigint> => {
  const [ata] = await findUsdcAta(address(String(owner)), ctx.usdcMint);
  const bytes = await fetchAccountBytes(ctx.rpc, ata);
  if (bytes === undefined || bytes.length < 72) return 0n;
  // SPL token account: mint(32) owner(32) amount:u64-LE @64.
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return dv.getBigUint64(64, true);
};

const loadProtocolSummary = async (ctx: SolanaOptionsContext): Promise<OptionsProtocolSummary> => {
  const ids = await listMarketIdsCtx(ctx);
  let vaultCount = 0;
  for (const id of ids) {
    try {
      vaultCount += await withProtocolView(ctx, id, (view) => view.listVaultIds().length);
    } catch {
      // ProtocolState not allocated — contributes 0.
    }
  }
  return { marketCount: ids.length, vaultCount };
};

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
import { WAD } from "../../model/math/curve.js";
import { computeWinClaimable, lossBasisToLvst } from "../../model/units.js";
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
  resolveMarketForTokenOrOwner,
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
        // The EARNED LVST for this loss (basis × mintRate), shown even after claiming. The claimed state
        // is a separate flag (readNft derives it from the claimed-aware view) so the row can say "claimed".
        lossBasisToLvst(
          view.lossClaimable(tokenIdToHex32(tokenId), target, sideToSolana(side)),
          BigInt(view.mintRate())
        )
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

    readLvstAccount: async (user) => {
      // LVST is a DEPLOYED SPL mint now — read the user's real LVST ATA balance (loss-mint credits it).
      // Staking/dividends have no on-chain READ wired this phase (per-market treasury; unblocks with the
      // global-treasury shard), so those stay 0. The projection scales `balance` by the chain's LVST
      // decimals (9 on Solana).
      const validated = validateSolanaUserAddress(user, "user");
      const balance = await readLvstBalance(ctx, validated);
      return mapSolanaLvstAccount(validated, balance, 0n, 0n) as LvstAccount;
    },

    readUsdcAddress: async () => ctx.usdcMint as unknown as `0x${string}`,
    readUsdcBalance: (owner) => readUsdcBalance(ctx, owner),

    // Shared streaming balance for a position from the engine's per-token streams state (wasm view
    // nftBalance). Resolves the market via engine footprint OR the PositionOwner PDA, so it also
    // reports a parked balance on a laneless position (addFunds with no lanes). EVM parity.
    readNftBalance: async (tokenId) => {
      const marketId = await resolveMarketForTokenOrOwner(ctx, tokenId);
      if (marketId === undefined) return 0n;
      try {
        return await withProtocolView(ctx, marketId, (view) => view.nftBalance(tokenIdToHex32(tokenId)));
      } catch {
        return 0n; // ProtocolState not allocated for the market yet
      }
    },

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

// Fetch + decode the PositionOwner PDA once. Carries the market the position was minted for (the
// per-token accessor EVM/Sui already expose), so a laneless token is still attributable. undefined
// when the PDA doesn't exist (unminted token).
const readOwnerRecord = async (
  ctx: SolanaOptionsContext,
  tokenId: TokenId
): Promise<{ owner: UserAddress; marketId: Hex32 } | undefined> => {
  const [posPda] = await findPositionPda(ctx.programId, tokenIdToHex32(tokenId));
  const bytes = await fetchAccountBytes(ctx.rpc, posPda);
  if (bytes === undefined) return undefined;
  const rec = decodePositionOwnerAccount(bytes);
  return { owner: validateSolanaUserAddress(String(rec.owner), "owner"), marketId: rec.marketId };
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
    const balance = view.nftBalance(tokenHex);
    const mintRate = BigInt(view.mintRate()); // protocol-wide; loss basis → earned LVST for the whole NFT
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
      // The engine's `claimable()` view is gated to 0 until the vault is `collect`ed (the pot finalize).
      // Collect is permissionless + idempotent and always runs at cash-out, so a winning position on a
      // resolved-but-uncollected vault would otherwise read $0 — and, with no cash to claim, its Cash out
      // button would be disabled, a pure winner stuck. Read the pools ONCE here and project what
      // collect+withdraw will pay; once collected, the real view value (>0 unclaimed, 0 once claimed) wins.
      const uncollected = winning !== undefined && !view.collected(vId);
      const pools = uncollected ? view.vaultPools(vId) : undefined;
      for (const sideNum of [0, 1] as const) {
        const pos = view.position(vId, sideNum, tokenHex);
        if (pos.rate === 0n && pos.sharesAccrued === 0n && pos.gPaid === 0n) continue;
        let claimable = view.claimable(tokenHex, vId, sideNum);
        if (pools !== undefined && sideFromSolana(sideNum) === winning) {
          const winPool = winning === "yes" ? pools.yesPool : pools.noPool;
          const losePool = winning === "yes" ? pools.noPool : pools.yesPool;
          const winShares = winning === "yes" ? pools.yesShares : pools.noShares;
          claimable = computeWinClaimable(winPool, losePool, pos.sharesAccrued / WAD, winShares);
        }
        // Earned LVST for this loss (basis × mintRate) — shown even after claiming. The claimed-aware view
        // (loss_lvst_claimable) drops to 0 once claimed, so basis>0 with a zero claimable ⇒ already claimed.
        const basis = view.lossClaimable(tokenHex, vId, sideNum);
        const lossClaimable = lossBasisToLvst(basis, mintRate);
        const lossClaimed = basis > 0n && view.lossLvstClaimable(tokenHex, vId, sideNum) === 0n;
        // TRUE live shares = settled + real bonding-curve accrual to now (engine pending_shares), so the
        // absolute "sh" display grows honestly between advances instead of the app guessing with a rate.
        const livePendingRaw = view.pendingShares(vId, sideNum, tokenHex, now);
        lanes.push(
          mapSolanaLane(
            tokenId,
            asVaultId(vId),
            sideFromSolana(sideNum),
            pos,
            now,
            claimable,
            lossClaimable,
            winning,
            Number(vault.resolvedAt ?? 0),
            lossClaimed,
            basis,
            livePendingRaw
          )
        );
      }
    }
    return mapSolanaNft(tokenId, owner, asMarketId(marketId), laneCount, lanes, balance);
  });

  if (nft) return nft;
  // Laneless token (minted, not yet funded): no engine shard owns it, so the market can't be derived
  // from engine state. The PositionOwner PDA records the market it was minted for (parity with EVM
  // MarketDriver.marketIdOf / Sui's NFT market_id), so the snapshot keeps it under its market instead
  // of dropping it — this is what lets a fresh mint enable its first-bet controls. It can still hold a
  // parked balance (addFunds with no lanes), so read that too.
  const rec = await readOwnerRecord(ctx, tokenId);
  let balance = 0n;
  if (rec?.marketId !== undefined) {
    try {
      balance = await withProtocolView(ctx, rec.marketId, (view) => view.nftBalance(tokenIdToHex32(tokenId)));
    } catch {
      // ProtocolState not allocated — no balance to report
    }
  }
  return mapSolanaNft(tokenId, owner, asMarketId(rec?.marketId ?? ZERO_ID), 0, [], balance);
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
  const rec = await readOwnerRecord(ctx, tokenId);
  if (rec === undefined) {
    throw new LiveStreakConfigError({
      message: "Solana: position owner not found",
      metadata: { details: tokenId.toString() }
    });
  }
  return rec.owner;
};

const readUsdcBalance = async (ctx: SolanaOptionsContext, owner: UserAddress): Promise<bigint> => {
  const [ata] = await findUsdcAta(address(String(owner)), ctx.usdcMint);
  const bytes = await fetchAccountBytes(ctx.rpc, ata);
  if (bytes === undefined || bytes.length < 72) return 0n;
  // SPL token account: mint(32) owner(32) amount:u64-LE @64.
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return dv.getBigUint64(64, true);
};

// Loss preview uses the engine's claimed-aware `lossLvstClaimable` view (EVM parity with
// Treasury.lossLvstClaimable): it returns the LVST the claim mints AND 0 once claimed, so the panel
// both matches the mint and clears the row after Cash out.

// Same SPL token-account read as USDC, against the LVST mint's ATA (loss-mint / future staking credit it).
const readLvstBalance = async (ctx: SolanaOptionsContext, owner: UserAddress): Promise<bigint> => {
  if (ctx.lvstMint === undefined) return 0n;
  const [ata] = await findUsdcAta(address(String(owner)), ctx.lvstMint);
  const bytes = await fetchAccountBytes(ctx.rpc, ata);
  if (bytes === undefined || bytes.length < 72) return 0n;
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

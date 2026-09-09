// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import type {
  MarketId,
  OptionsMarketSnapshot,
  OptionsNftSnapshot,
  OptionsUserOptionsSnapshot,
  OptionsVault,
  OptionsVaultSnapshot,
  UserAddress,
  VaultId
} from "../model/index.js";
import type { OptionsReader } from "../chains/types.js";

export const readMarketSnapshot = async (
  reader: OptionsReader,
  marketId: MarketId
): Promise<OptionsMarketSnapshot> => {
  const market = await readOrThrow(() => reader.readMarket(marketId), "market", marketId);
  const vaultIds = await readOrThrow(
    () => reader.listMarketVaults(marketId),
    "market vault index",
    marketId
  );

  // Populate marketSnapshot.vaults by reading EACH vault the market indexes (this is what the panel
  // projection consumes → "see the vault in stream mode"). Read in parallel for latency. RESILIENCE:
  // a single vault that 404s or transiently fails must NOT zero out the whole board — drop it and
  // keep the rest, so a market with N vaults still surfaces its readable vaults. (LiveStreakConfigError
  // = a hard config/validation fault → rethrow; everything else for one vault is non-fatal here.)
  // Per-vault failures are non-fatal: the market + its vaultIds already read cleanly (so the registry
  // path is healthy), and one vault that is missing/!exists/transiently unreadable should drop out
  // rather than throw away the entire board. A genuinely systemic fault degrades to an empty vault
  // list — the same observable as "no vaults yet" — not a hard crash of the whole snapshot.
  const vaultResults = await Promise.all(
    vaultIds.map(async (vaultId) => {
      try {
        return await reader.readVault(vaultId);
      } catch {
        return undefined;
      }
    })
  );
  const vaults = vaultResults.filter(
    (vault): vault is OptionsVault => vault !== undefined
  );

  // Fetch the raw stream pointer. Non-fatal: a market may have no stream set yet.
  let streamState: import("../model/stream.js").OptionsStreamState | undefined;
  try {
    streamState = await reader.readStreamState(marketId);
  } catch {
    // Leave streamState undefined — stream pointer may not exist on-chain yet.
  }

  return {
    market,
    vaults,
    ...(streamState === undefined ? {} : { streamState })
  };
};

export const readVaultSnapshot = async (
  reader: OptionsReader,
  vaultId: VaultId
): Promise<OptionsVaultSnapshot> => {
  const vault = await readOrThrow(() => reader.readVault(vaultId), "vault", vaultId);
  const [shareTotals, boardYes, boardNo, pendingYes, pendingNo] = await Promise.all([
    readOrThrow(() => reader.readVaultShareTotals(vaultId), "vault share totals", vaultId),
    readOrThrow(() => reader.readBoard(vaultId, "yes"), "vault board yes", vaultId),
    readOrThrow(() => reader.readBoard(vaultId, "no"), "vault board no", vaultId),
    readOrThrow(() => reader.readPendingBoundaries(vaultId, "yes"), "pending boundaries yes", vaultId),
    readOrThrow(() => reader.readPendingBoundaries(vaultId, "no"), "pending boundaries no", vaultId)
  ]);

  return {
    vault,
    pools: vault.pools,
    shareTotals,
    boards: { yes: boardYes, no: boardNo },
    pendingBoundaries: { yes: pendingYes, no: pendingNo },
    hot: vault.steward,
    dispute: {
      active: vault.steward.disputeId !== undefined,
      disputeId: vault.steward.disputeId
    },
    ...(await enrichResolvedVaultFields(reader, vaultId, vault))
  };
};

export const readUserOptionsSnapshot = async (
  reader: OptionsReader,
  user: UserAddress,
  marketId?: MarketId
): Promise<OptionsUserOptionsSnapshot> => {
  const lvstAccount = await readOrThrow(
    () => reader.readLvstAccount(user),
    "LVST account",
    user
  );

  const usdcBalance = await readOrThrow(
    () => reader.readUsdcBalance(user),
    "USDC balance",
    user
  );

  const protocol =
    reader.readProtocolSummary === undefined
      ? undefined
      : await readOrThrow(() => reader.readProtocolSummary!(), "protocol summary", user);

  if (marketId === undefined) {
    return {
      account: user,
      markets: [],
      vaults: [],
      nfts: [],
      lvstAccount,
      usdcBalance,
      protocol
    };
  }

  const marketSnapshot = await readMarketSnapshot(reader, marketId);
  const tokenIds = await readOrThrow(
    () => reader.listOwnerTokens(user),
    "owner tokens",
    user
  );

  const nfts: OptionsNftSnapshot[] = [];
  for (const tokenId of tokenIds) {
    const nft = await readOrThrow(() => reader.readNft(tokenId, user), "nft", String(tokenId));
    if (nft.marketId === marketId) {
      nfts.push({ nft });
    }
  }

  const vaultIdSet = new Set<VaultId>(marketSnapshot.market.vaultIds);
  for (const entry of nfts) {
    for (const lane of entry.nft.lanes) {
      vaultIdSet.add(lane.vaultId);
    }
  }

  const vaults = await Promise.all(
    [...vaultIdSet].map((vaultId) => readVaultSnapshot(reader, vaultId))
  );

  return {
    account: user,
    marketId,
    markets: [marketSnapshot],
    vaults,
    nfts,
    lvstAccount,
    usdcBalance,
    protocol
  };
};

// --- helpers ---

const enrichResolvedVaultFields = async (
  reader: OptionsReader,
  vaultId: VaultId,
  vault: OptionsVault
): Promise<Pick<OptionsVaultSnapshot, "winningSide" | "pot" | "collected">> => {
  if (vault.status !== "resolved") {
    return {};
  }

  const [winningSide, pot, collected] = await Promise.all([
    reader.readWinningSide(vaultId),
    reader.readPot(vaultId),
    reader.readCollected(vaultId)
  ]);

  return {
    ...(winningSide === undefined ? {} : { winningSide }),
    pot,
    collected
  };
};

const readOrThrow = async <T>(
  read: () => Promise<T>,
  entity: string,
  id: string
): Promise<T> => {
  try {
    return await read();
  } catch (error) {
    if (error instanceof LiveStreakConfigError) {
      throw error;
    }

    throw new LiveStreakConfigError({
      message: `Failed to read ${entity}`,
      metadata: {
        details: id,
        cause: error
      }
    });
  }
};

// --- exports ---

import { LiveStreakConfigError, LiveStreakRuntimeError } from "@livestreak/core";

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

  // A failed child read is not an empty market. Reject the refresh so the runtime can
  // preserve its last complete board and explicitly report that it is unavailable/stale.
  const vaults = await Promise.all(
    vaultIds.map(vaultId => readOrThrow(() => reader.readVault(vaultId), "vault", vaultId))
  );
  if (market.marketId !== marketId || vaults.some((vault, index) =>
    vault.vaultId !== vaultIds[index] || vault.marketId !== marketId)) {
    throw new LiveStreakRuntimeError({ message: "Mismatched market graph" });
  }
  // Readers express an unset pointer as status=none. An RPC error must stay an error.
  const streamState = await readOrThrow(() => reader.readStreamState(marketId), "stream state", marketId);

  return {
    market,
    vaults,
    streamState
  };
};

export const readVaultSnapshot = async (
  reader: OptionsReader,
  vaultId: VaultId
): Promise<OptionsVaultSnapshot> => {
  const vault = await readOrThrow(() => reader.readVault(vaultId), "vault", vaultId);
  const [shareTotals, boardYes, boardNo, pendingYes, pendingNo, boundariesYes, boundariesNo] =
    await Promise.all([
      readOrThrow(() => reader.readVaultShareTotals(vaultId), "vault share totals", vaultId),
      readOrThrow(() => reader.readBoard(vaultId, "yes"), "vault board yes", vaultId),
      readOrThrow(() => reader.readBoard(vaultId, "no"), "vault board no", vaultId),
      readOrThrow(() => reader.readPendingBoundaries(vaultId, "yes"), "pending boundaries yes", vaultId),
      readOrThrow(() => reader.readPendingBoundaries(vaultId, "no"), "pending boundaries no", vaultId),
      readOrThrow(() => reader.readBoundaries(vaultId, "yes"), "vault boundaries yes", vaultId),
      readOrThrow(() => reader.readBoundaries(vaultId, "no"), "vault boundaries no", vaultId)
    ]);

  return {
    vault,
    pools: vault.pools,
    shareTotals,
    boards: { yes: boardYes, no: boardNo },
    pendingBoundaries: { yes: pendingYes, no: pendingNo },
    boundaries: { yes: boundariesYes, no: boundariesNo },
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
    // Config errors (bad ids/chain misconfig) pass through untouched; everything else is a
    // transport/runtime failure, not a configuration problem.
    if (error instanceof LiveStreakConfigError) {
      throw error;
    }

    throw new LiveStreakRuntimeError({
      message: `Failed to read ${entity}`,
      metadata: {
        details: id,
        cause: error
      }
    });
  }
};

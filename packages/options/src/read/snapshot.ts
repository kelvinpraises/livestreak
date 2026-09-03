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
import type { OptionsReadTransport } from "./transport.js";

export const readMarketSnapshot = async (
  transport: OptionsReadTransport,
  marketId: MarketId
): Promise<OptionsMarketSnapshot> => {
  const market = await readOrThrow(() => transport.readMarket(marketId), "market", marketId);
  const vaultIds = await readOrThrow(
    () => transport.listMarketVaults(marketId),
    "market vault index",
    marketId
  );

  const vaults = await Promise.all(
    vaultIds.map((vaultId) =>
      readOrThrow(() => transport.readVault(vaultId), "vault", vaultId)
    )
  );

  return { market, vaults };
};

export const readVaultSnapshot = async (
  transport: OptionsReadTransport,
  vaultId: VaultId
): Promise<OptionsVaultSnapshot> => {
  const vault = await readOrThrow(() => transport.readVault(vaultId), "vault", vaultId);
  const shareTotals = await readOrThrow(
    () => transport.readVaultShareTotals(vaultId),
    "vault share totals",
    vaultId
  );

  return {
    vault,
    pools: vault.pools,
    shareTotals,
    hot: vault.steward,
    dispute: {
      active: vault.steward.disputeId !== undefined,
      disputeId: vault.steward.disputeId
    },
    ...(await enrichResolvedVaultFields(transport, vaultId, vault))
  };
};

const enrichResolvedVaultFields = async (
  transport: OptionsReadTransport,
  vaultId: VaultId,
  vault: OptionsVault
): Promise<Pick<OptionsVaultSnapshot, "winningSide" | "pot" | "collected">> => {
  if (vault.status !== "resolved") {
    return {};
  }

  const [winningSide, pot, collected] = await Promise.all([
    transport.readWinningSide(vaultId),
    transport.readPot(vaultId),
    transport.readCollected(vaultId)
  ]);

  return {
    ...(winningSide === undefined ? {} : { winningSide }),
    pot,
    collected
  };
};

export const readUserOptionsSnapshot = async (
  transport: OptionsReadTransport,
  user: UserAddress,
  marketId?: MarketId
): Promise<OptionsUserOptionsSnapshot> => {
  const lvstAccount = await readOrThrow(
    () => transport.readLvstAccount(user),
    "LVST account",
    user
  );

  const protocol =
    transport.readProtocolSummary === undefined
      ? undefined
      : await readOrThrow(() => transport.readProtocolSummary!(), "protocol summary", user);

  if (marketId === undefined) {
    return {
      account: user,
      markets: [],
      vaults: [],
      nfts: [],
      lvstAccount,
      protocol
    };
  }

  const marketSnapshot = await readMarketSnapshot(transport, marketId);
  const tokenIds = await readOrThrow(
    () => transport.listOwnerTokens(user),
    "owner tokens",
    user
  );

  const nfts: OptionsNftSnapshot[] = [];
  for (const tokenId of tokenIds) {
    const nft = await readOrThrow(() => transport.readNft(tokenId, user), "nft", String(tokenId));
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
    [...vaultIdSet].map((vaultId) => readVaultSnapshot(transport, vaultId))
  );

  return {
    account: user,
    marketId,
    markets: [marketSnapshot],
    vaults,
    nfts,
    lvstAccount,
    protocol
  };
};

// --- helpers ---

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

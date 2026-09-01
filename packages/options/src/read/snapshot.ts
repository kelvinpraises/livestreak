// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import type {
  MarketId,
  OptionsMarketSnapshot,
  OptionsUserOptionsSnapshot,
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
  vaultId: VaultId,
  user?: UserAddress
): Promise<OptionsVaultSnapshot> => {
  const vault = await readOrThrow(() => transport.readVault(vaultId), "vault", vaultId);

  if (user === undefined) {
    return { vault };
  }

  const [userPosition, yesFunding, noFunding] = await Promise.all([
    readOrThrow(() => transport.readUserVaultPosition(user, vaultId), "user position", user),
    readOrThrow(() => transport.readFundingStream(user, vaultId, "yes"), "funding stream", user),
    readOrThrow(() => transport.readFundingStream(user, vaultId, "no"), "funding stream", user)
  ]);

  return {
    vault,
    userPosition,
    funding: {
      yes: yesFunding,
      no: noFunding
    }
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
      lvstAccount,
      protocol
    };
  }

  const marketSnapshot = await readMarketSnapshot(transport, marketId);
  const vaults = await Promise.all(
    marketSnapshot.vaults.map((vault) => readVaultSnapshot(transport, vault.vaultId, user))
  );

  return {
    account: user,
    marketId,
    markets: [marketSnapshot],
    vaults,
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

// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import type { UserAddress } from "../model/ids.js";
import type { UserVaultClaimRow } from "../model/claims.js";
import type { OptionsReadTransport } from "./transport.js";

export const gatherUserVaultClaims = async (
  transport: OptionsReadTransport,
  user: UserAddress
): Promise<readonly UserVaultClaimRow[]> => {
  const tokenIds = await readOrThrow(
    () => transport.listOwnerTokens(user),
    "owner tokens",
    user
  );

  const rows: UserVaultClaimRow[] = [];

  for (const tokenId of tokenIds) {
    const nft = await readOrThrow(
      () => transport.readNft(tokenId, user),
      "nft",
      String(tokenId)
    );

    const vaultIds = await readOrThrow(
      () => transport.readAccountVaultIds(tokenId),
      "account vault ids",
      String(tokenId)
    );

    const vaultIdSet = new Set(vaultIds);
    for (const lane of nft.lanes) {
      vaultIdSet.add(lane.vaultId);
    }

    for (const vaultId of vaultIdSet) {
      const lane = nft.lanes.find((entry) => entry.vaultId === vaultId);
      if (lane === undefined) {
        continue;
      }

      const vault = await readOrThrow(
        () => transport.readVault(vaultId),
        "vault",
        vaultId
      );
      const winningSide = await transport.readWinningSide(vaultId);
      const claimable = lane.claimable ?? (await transport.readClaimable(tokenId, vaultId, lane.side));
      const lossClaimable =
        lane.lossClaimable ??
        (await transport.readLossClaimable(tokenId, vaultId, lane.side));
      const won = winningSide === undefined ? undefined : lane.side === winningSide;

      rows.push({
        tokenId,
        vaultId,
        marketId: vault.marketId,
        status: vault.status,
        side: lane.side,
        ...(winningSide === undefined ? {} : { winningSide }),
        claimable,
        lossClaimable,
        ...(won === undefined ? {} : { won })
      });
    }
  }

  return rows;
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

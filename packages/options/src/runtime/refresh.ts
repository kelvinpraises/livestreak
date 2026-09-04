// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import type { MarketId, UserAddress, VaultId } from "../model/ids.js";
import type {
  OptionsMarketSnapshot,
  OptionsUserOptionsSnapshot,
  OptionsVaultSnapshot
} from "../model/snapshot.js";
import type { OptionsReader } from "../chains/types.js";
import {
  readMarketSnapshot,
  readUserOptionsSnapshot,
  readVaultSnapshot
} from "../flows/snapshot.js";
import type { OptionsRuntimeLastError } from "./store.js";

export const refreshMarketSnapshot = async (
  reader: OptionsReader,
  marketId: MarketId
): Promise<OptionsMarketSnapshot> => readMarketSnapshot(reader, marketId);

export const refreshVaultSnapshot = async (
  reader: OptionsReader,
  vaultId: VaultId
): Promise<OptionsVaultSnapshot> => readVaultSnapshot(reader, vaultId);

export const refreshUserSnapshot = async (
  reader: OptionsReader,
  user: UserAddress,
  marketId?: MarketId
): Promise<OptionsUserOptionsSnapshot> => readUserOptionsSnapshot(reader, user, marketId);

export const toRuntimeLastError = (error: unknown): OptionsRuntimeLastError => {
  if (error instanceof LiveStreakConfigError) {
    const details =
      typeof error.metadata?.details === "string" ? error.metadata.details : undefined;

    return {
      message: error.message,
      ...(details === undefined ? {} : { details })
    };
  }

  if (error instanceof Error) {
    return { message: error.message };
  }

  return { message: "Unknown refresh failure", details: String(error) };
};

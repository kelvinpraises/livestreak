// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import type { MarketId, UserAddress, VaultId } from "../model/ids.js";
import type {
  OptionsMarketSnapshot,
  OptionsUserOptionsSnapshot,
  OptionsVaultSnapshot
} from "../model/snapshot.js";
import {
  readMarketSnapshot,
  readUserOptionsSnapshot,
  readVaultSnapshot
} from "../read/snapshot.js";
import type { OptionsReadTransport } from "../read/transport.js";
import type { OptionsRuntimeLastError } from "./store.js";

export const refreshMarketSnapshot = async (
  transport: OptionsReadTransport,
  marketId: MarketId
): Promise<OptionsMarketSnapshot> => readMarketSnapshot(transport, marketId);

export const refreshVaultSnapshot = async (
  transport: OptionsReadTransport,
  vaultId: VaultId,
  user?: UserAddress
): Promise<OptionsVaultSnapshot> => readVaultSnapshot(transport, vaultId, user);

export const refreshUserSnapshot = async (
  transport: OptionsReadTransport,
  user: UserAddress,
  marketId?: MarketId
): Promise<OptionsUserOptionsSnapshot> => readUserOptionsSnapshot(transport, user, marketId);

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

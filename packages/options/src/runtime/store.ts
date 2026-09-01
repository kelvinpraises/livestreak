// --- exports ---

import type { MarketId, VaultId } from "../model/ids.js";
import type {
  OptionsMarketSnapshot,
  OptionsUserOptionsSnapshot,
  OptionsVaultSnapshot
} from "../model/snapshot.js";
import {
  copyMarketSnapshot,
  copyRuntimeState,
  copyUserOptionsSnapshot,
  copyVaultSnapshot
} from "./copy.js";

export interface OptionsRuntimeLastError {
  readonly message: string;
  readonly details?: string;
}

export interface OptionsRuntimeState {
  readonly runtimeId: string;
  readonly revision: number;
  readonly userSnapshot?: OptionsUserOptionsSnapshot;
  readonly markets: readonly OptionsMarketSnapshot[];
  readonly vaults: readonly OptionsVaultSnapshot[];
  readonly lastError?: OptionsRuntimeLastError;
}

export interface OptionsRuntimeStore {
  readState: () => OptionsRuntimeState;
  setUserSnapshot: (snapshot: OptionsUserOptionsSnapshot) => void;
  setMarketSnapshot: (snapshot: OptionsMarketSnapshot) => void;
  setVaultSnapshot: (snapshot: OptionsVaultSnapshot) => void;
  setLastError: (error: OptionsRuntimeLastError | undefined) => void;
}

export const createOptionsRuntimeStore = (runtimeId: string): OptionsRuntimeStore =>
  new OptionsRuntimeStoreInMemory(runtimeId);

class OptionsRuntimeStoreInMemory implements OptionsRuntimeStore {
  private revision = 0;
  private userSnapshot?: OptionsUserOptionsSnapshot;
  private readonly markets = new Map<MarketId, OptionsMarketSnapshot>();
  private readonly vaults = new Map<VaultId, OptionsVaultSnapshot>();
  private lastError?: OptionsRuntimeLastError;

  constructor(private readonly runtimeId: string) {}

  readState(): OptionsRuntimeState {
    return copyRuntimeState({
      runtimeId: this.runtimeId,
      revision: this.revision,
      ...(this.userSnapshot === undefined ? {} : { userSnapshot: this.userSnapshot }),
      markets: [...this.markets.values()],
      vaults: [...this.vaults.values()],
      ...(this.lastError === undefined ? {} : { lastError: this.lastError })
    });
  }

  setUserSnapshot(snapshot: OptionsUserOptionsSnapshot): void {
    this.userSnapshot = copyUserOptionsSnapshot(snapshot);

    for (const market of snapshot.markets) {
      this.markets.set(market.market.marketId, copyMarketSnapshot(market));
    }

    for (const vault of snapshot.vaults) {
      this.vaults.set(vault.vault.vaultId, copyVaultSnapshot(vault));
    }

    this.lastError = undefined;
    this.revision += 1;
  }

  setMarketSnapshot(snapshot: OptionsMarketSnapshot): void {
    const copy = copyMarketSnapshot(snapshot);
    this.markets.set(copy.market.marketId, copy);

    for (const vault of copy.vaults) {
      this.vaults.set(vault.vaultId, { vault });
    }

    this.lastError = undefined;
    this.revision += 1;
  }

  setVaultSnapshot(snapshot: OptionsVaultSnapshot): void {
    this.vaults.set(snapshot.vault.vaultId, copyVaultSnapshot(snapshot));
    this.lastError = undefined;
    this.revision += 1;
  }

  setLastError(error: OptionsRuntimeLastError | undefined): void {
    this.lastError =
      error === undefined
        ? undefined
        : {
            message: error.message,
            ...(error.details === undefined ? {} : { details: error.details })
          };
    this.revision += 1;
  }
}

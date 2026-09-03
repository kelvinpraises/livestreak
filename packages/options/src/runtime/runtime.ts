// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import type { MarketId, UserAddress, VaultId } from "../model/ids.js";
import type { OptionsUserOptionsSnapshot } from "../model/snapshot.js";
import { projectOptionsPanel } from "../panel/project.js";
import type { OptionsPanel } from "../panel/types.js";
import type { OptionsReadTransport } from "../read/transport.js";
import type { OptionsRuntimeConfig, OptionsRuntimeInput } from "./config.js";
import { validateOptionsRuntimeConfig } from "./config.js";
import {
  refreshMarketSnapshot,
  refreshUserSnapshot,
  refreshVaultSnapshot,
  toRuntimeLastError
} from "./refresh.js";
import {
  createOptionsRuntimeStore,
  type OptionsRuntimeState,
  type OptionsRuntimeStore
} from "./store.js";

export interface OptionsRuntime {
  readonly config: OptionsRuntimeConfig;
  readSnapshot: () => OptionsRuntimeState;
  readPanel: () => OptionsPanel;
  refresh: () => Promise<OptionsRuntimeState>;
  refreshMarket: (marketId: MarketId) => Promise<OptionsRuntimeState>;
  refreshVault: (vaultId: VaultId) => Promise<OptionsRuntimeState>;
  refreshUser: (user: UserAddress, marketId?: MarketId) => Promise<OptionsRuntimeState>;
  subscribeSnapshots: (listener: (state: OptionsRuntimeState) => void) => () => void;
  onChange: (listener: (state: OptionsRuntimeState) => void) => () => void;
  set: (key: string, value: unknown) => OptionsRuntimeState;
  get: <T>(key: string) => T | undefined;
  startPolling: () => { readonly stop: () => void };
}

export const createOptionsRuntime = (input: OptionsRuntimeInput): OptionsRuntime =>
  new OptionsRuntimeFacade(input);

class OptionsRuntimeFacade implements OptionsRuntime {
  readonly config: OptionsRuntimeConfig;
  private readonly store: OptionsRuntimeStore;
  private readonly listeners = new Set<(state: OptionsRuntimeState) => void>();
  private readonly changeListeners = new Set<(state: OptionsRuntimeState) => void>();
  private pollingTimer: ReturnType<typeof setInterval> | undefined;

  constructor(input: OptionsRuntimeInput) {
    this.config = validateOptionsRuntimeConfig(input.config);
    this.store = createOptionsRuntimeStore(this.config.runtimeId);
    this.transport = input.transport;
  }

  private readonly transport: OptionsReadTransport;

  readSnapshot(): OptionsRuntimeState {
    return this.store.readState();
  }

  readPanel(): OptionsPanel {
    const snapshot = this.requireUserSnapshot();
    return projectOptionsPanel(snapshot);
  }

  async refresh(): Promise<OptionsRuntimeState> {
    try {
      if (this.config.user !== undefined) {
        const marketId = this.config.defaultMarketId ?? this.config.marketIds?.[0];
        await this.refreshUser(this.config.user, marketId);
      } else if (this.config.marketIds !== undefined) {
        for (const marketId of this.config.marketIds) {
          await this.refreshMarket(marketId);
        }
      } else {
        throw new LiveStreakConfigError({
          message: "Options runtime refresh requires user or marketIds in config",
          metadata: { details: this.config.runtimeId }
        });
      }

      return this.publish();
    } catch (error) {
      this.fail(error);
    }
  }

  async refreshMarket(marketId: MarketId): Promise<OptionsRuntimeState> {
    try {
      const snapshot = await refreshMarketSnapshot(this.transport, marketId);
      this.store.setMarketSnapshot(snapshot);
      return this.publish();
    } catch (error) {
      this.fail(error);
    }
  }

  async refreshVault(vaultId: VaultId): Promise<OptionsRuntimeState> {
    try {
      const snapshot = await refreshVaultSnapshot(this.transport, vaultId);
      this.store.setVaultSnapshot(snapshot);
      return this.publish();
    } catch (error) {
      this.fail(error);
    }
  }

  async refreshUser(user: UserAddress, marketId?: MarketId): Promise<OptionsRuntimeState> {
    try {
      const snapshot = await refreshUserSnapshot(this.transport, user, marketId);
      this.store.setUserSnapshot(snapshot);
      return this.publish();
    } catch (error) {
      this.fail(error);
    }
  }

  subscribeSnapshots(listener: (state: OptionsRuntimeState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onChange(listener: (state: OptionsRuntimeState) => void): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  set(key: string, value: unknown): OptionsRuntimeState {
    this.store.setMemory(key, value);
    return this.publish();
  }

  get<T>(key: string): T | undefined {
    return this.store.getMemory<T>(key);
  }

  startPolling(): { readonly stop: () => void } {
    if (this.config.refreshIntervalMs === undefined) {
      throw new LiveStreakConfigError({
        message: "Options runtime polling requires refreshIntervalMs in config",
        metadata: { details: this.config.runtimeId }
      });
    }

    if (this.pollingTimer !== undefined) {
      throw new LiveStreakConfigError({
        message: "Options runtime polling is already active",
        metadata: { details: this.config.runtimeId }
      });
    }

    const intervalMs = this.config.refreshIntervalMs;
    this.pollingTimer = setInterval(() => {
      void this.refreshForPolling();
    }, intervalMs);

    return {
      stop: () => {
        if (this.pollingTimer !== undefined) {
          clearInterval(this.pollingTimer);
          this.pollingTimer = undefined;
        }
      }
    };
  }

  private async refreshForPolling(): Promise<void> {
    try {
      await this.refresh();
    } catch {
      // fail() records lastError and notifies subscribers before rethrowing
    }
  }

  private requireUserSnapshot(): OptionsUserOptionsSnapshot {
    const snapshot = this.store.readState().userSnapshot;
    if (snapshot === undefined) {
      throw new LiveStreakConfigError({
        message: "Options runtime has no user snapshot; call refreshUser or refresh first",
        metadata: { details: this.config.runtimeId }
      });
    }

    return snapshot;
  }

  private publish(): OptionsRuntimeState {
    const state = this.store.readState();
    for (const listener of this.listeners) {
      listener(state);
    }

    for (const listener of this.changeListeners) {
      listener(state);
    }

    return state;
  }

  private fail(error: unknown): never {
    this.store.setLastError(toRuntimeLastError(error));
    this.publish();
    throw error;
  }
}

// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import type { MarketId, UserAddress, VaultId } from "../model/ids.js";
import type { OptionsUserOptionsSnapshot } from "../model/snapshot.js";
import { createOptionsChain, type OptionsChain } from "../chains/index.js";
import { readClaimsView, readSessionPnl, readStreamState } from "../flows/index.js";
import type { OptionsClaimsView } from "../model/claims.js";
import type { OptionsSessionPnlView } from "../model/math/pnl.js";
import {
  projectAccrualPreview,
  type OptionsAccrualPreview,
  type PreviewAccrualInput
} from "../model/math/accrual.js";
import type { FundStreamInput, TxId } from "../chains/types.js";
import type { OptionsStreamState } from "../model/stream.js";
import { projectOptionsPanel } from "../bridge/panel/project.js";
import type { OptionsPanel } from "../bridge/panel/types.js";
import { assembleBoard, type OptionsBoard } from "./board.js";
import type { OptionsRuntimeConfig, OptionsRuntimeInput } from "./config.js";
import { validateOptionsRuntimeConfig } from "./config.js";
import {
  refreshMarketSnapshot,
  refreshUserSnapshot,
  refreshVaultSnapshot,
  toRuntimeLastError
} from "./refresh.js";
import { createBoardSubscriptionRegistry } from "./subscriptions.js";
import {
  createOptionsRuntimeStore,
  type OptionsRuntimeState,
  type OptionsRuntimeStore
} from "./store.js";

export interface OptionsRuntime {
  readonly config: OptionsRuntimeConfig;
  readonly chain: OptionsChain;
  readSnapshot: () => OptionsRuntimeState;
  readPanel: () => OptionsPanel;
  readBoard: () => OptionsBoard;
  readClaims: () => Promise<OptionsClaimsView>;
  readPnl: (investedUSDC?: bigint) => Promise<OptionsSessionPnlView>;
  readStreamState: (marketId: MarketId) => Promise<OptionsStreamState>;
  previewAccrual: (input: PreviewAccrualInput) => Promise<OptionsAccrualPreview>;
  fundStream: (input: FundStreamInput) => Promise<TxId>;
  refresh: () => Promise<OptionsRuntimeState>;
  refreshMarket: (marketId: MarketId) => Promise<OptionsRuntimeState>;
  refreshVault: (vaultId: VaultId) => Promise<OptionsRuntimeState>;
  refreshUser: (user: UserAddress, marketId?: MarketId) => Promise<OptionsRuntimeState>;
  subscribeSnapshots: (listener: (state: OptionsRuntimeState) => void) => () => void;
  subscribeBoard: (listener: (board: OptionsBoard) => void) => () => void;
  onChange: (listener: (state: OptionsRuntimeState) => void) => () => void;
  set: (key: string, value: unknown) => OptionsRuntimeState;
  get: <T>(key: string) => T | undefined;
  watchMemory: (key: string, listener: (value: unknown) => void) => () => void;
  startPolling: () => { readonly stop: () => void };
}

export const createOptionsRuntime = (input: OptionsRuntimeInput): OptionsRuntime =>
  new OptionsRuntimeFacade(input);

class OptionsRuntimeFacade implements OptionsRuntime {
  readonly config: OptionsRuntimeConfig;
  readonly chain: OptionsChain;
  private readonly autoAdvanceOverflow: boolean;
  private readonly store: OptionsRuntimeStore;
  private readonly boardSubscriptions = createBoardSubscriptionRegistry();
  private readonly listeners = new Set<(state: OptionsRuntimeState) => void>();
  private readonly changeListeners = new Set<(state: OptionsRuntimeState) => void>();
  private readonly memoryWatchers = new Map<string, Set<(value: unknown) => void>>();
  private pollingTimer: ReturnType<typeof setInterval> | undefined;

  constructor(input: OptionsRuntimeInput) {
    this.config = validateOptionsRuntimeConfig(input.config);
    this.store = createOptionsRuntimeStore(this.config.runtimeId);
    this.chain = input.chain ?? createOptionsChain(input.chainConfig);
    this.autoAdvanceOverflow = input.chainConfig.autoAdvanceOverflow === true;
  }

  readSnapshot(): OptionsRuntimeState {
    return this.store.readState();
  }

  readPanel(): OptionsPanel {
    const snapshot = this.requireUserSnapshot();
    return projectOptionsPanel(snapshot);
  }

  readBoard(): OptionsBoard {
    const state = this.store.readState();
    const snapshot = this.requireUserSnapshot();
    return assembleBoard(state.revision, snapshot, projectOptionsPanel(snapshot));
  }

  async readClaims(): Promise<OptionsClaimsView> {
    return readClaimsView(this.chain.reader, this.requireUser());
  }

  async readPnl(investedUSDC?: bigint): Promise<OptionsSessionPnlView> {
    return readSessionPnl(this.chain.reader, this.requireUser(), investedUSDC);
  }

  async readStreamState(marketId: MarketId): Promise<OptionsStreamState> {
    return readStreamState(this.chain.reader, marketId);
  }

  async previewAccrual(input: PreviewAccrualInput): Promise<OptionsAccrualPreview> {
    const board = await this.chain.reader.readBoard(input.vaultId, input.side);
    const vault = await this.chain.reader.readVault(input.vaultId);
    const shareTotals = await this.chain.reader.readVaultShareTotals(input.vaultId);

    return projectAccrualPreview({
      board,
      pools: vault.pools,
      shareTotals,
      side: input.side,
      rate: input.rate,
      horizonSec: input.horizonSec,
      resolvedAtMs: vault.timing.resolvedAtMs
    });
  }

  async fundStream(input: FundStreamInput): Promise<TxId> {
    const { reader, writer } = this.chain;

    if (this.autoAdvanceOverflow !== true) {
      return writer.fund(input);
    }

    const pending = await reader.readPendingBoundaries(input.vaultId, input.side);

    if (pending <= 64n) {
      return writer.fund(input);
    }

    // Rare backlog: drain (pending/64 - 1) full advance rounds before fund; cap loop count.
    let pre = (pending + 63n) / 64n - 1n;
    const MAX_PRE = 64n;
    if (pre > MAX_PRE) {
      pre = MAX_PRE;
    }

    for (let index = 0n; index < pre; index += 1n) {
      await writer.advance({ vaultId: input.vaultId, side: input.side });
    }

    return writer.fund(input);
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
      const snapshot = await refreshMarketSnapshot(this.chain.reader, marketId);
      this.store.setMarketSnapshot(snapshot);
      return this.publish();
    } catch (error) {
      this.fail(error);
    }
  }

  async refreshVault(vaultId: VaultId): Promise<OptionsRuntimeState> {
    try {
      const snapshot = await refreshVaultSnapshot(this.chain.reader, vaultId);
      this.store.setVaultSnapshot(snapshot);
      return this.publish();
    } catch (error) {
      this.fail(error);
    }
  }

  async refreshUser(user: UserAddress, marketId?: MarketId): Promise<OptionsRuntimeState> {
    try {
      const snapshot = await refreshUserSnapshot(this.chain.reader, user, marketId);
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

  subscribeBoard(listener: (board: OptionsBoard) => void): () => void {
    return this.boardSubscriptions.subscribe(listener);
  }

  onChange(listener: (state: OptionsRuntimeState) => void): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  set(key: string, value: unknown): OptionsRuntimeState {
    this.store.setMemory(key, value);
    this.notifyMemoryWatchers(key, value);
    return this.publish();
  }

  get<T>(key: string): T | undefined {
    return this.store.getMemory<T>(key);
  }

  watchMemory(key: string, listener: (value: unknown) => void): () => void {
    const watchers = this.memoryWatchers.get(key) ?? new Set();
    watchers.add(listener);
    this.memoryWatchers.set(key, watchers);

    const current = this.get(key);
    if (current !== undefined) {
      listener(current);
    }

    return () => {
      const set = this.memoryWatchers.get(key);
      if (set === undefined) {
        return;
      }

      set.delete(listener);
      if (set.size === 0) {
        this.memoryWatchers.delete(key);
      }
    };
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

  private requireUser(): UserAddress {
    if (this.config.user === undefined) {
      throw new LiveStreakConfigError({
        message: "Options runtime has no user; set user in config to read claims or PnL",
        metadata: { details: this.config.runtimeId }
      });
    }

    return this.config.user;
  }

  private publish(): OptionsRuntimeState {
    const state = this.store.readState();

    for (const listener of this.listeners) {
      listener(state);
    }

    for (const listener of this.changeListeners) {
      listener(state);
    }

    if (state.userSnapshot !== undefined) {
      this.boardSubscriptions.notify(
        assembleBoard(state.revision, state.userSnapshot, projectOptionsPanel(state.userSnapshot))
      );
    }

    return state;
  }

  private notifyMemoryWatchers(key: string, value: unknown): void {
    const watchers = this.memoryWatchers.get(key);
    if (watchers === undefined) {
      return;
    }

    for (const listener of watchers) {
      listener(value);
    }
  }

  private fail(error: unknown): never {
    this.store.setLastError(toRuntimeLastError(error));
    this.publish();
    throw error;
  }
}

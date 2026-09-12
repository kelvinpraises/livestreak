// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import type { MarketId, UserAddress, VaultId } from "../model/ids.js";
import type { OptionsNft } from "../model/nft.js";
import type { OptionsVaultSide } from "../model/vault.js";
import { lvstDecimalsForChain, perMinUSDCToRate } from "../model/units.js";
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
import type {
  FundStreamInput,
  LaneWriteInput,
  StopAllFundingInput,
  TxId
} from "../chains/types.js";
import type { OptionsStreamState } from "../model/stream.js";
import { projectOptionsPanel, type OptionsPausedLane } from "../bridge/panel/project.js";
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

/** Open / switch / re-rate a vault's stream in one setLanes (the active-card adjust + vault-card stream).
 *  A vault holds ONE lane: this drops whatever side it streamed and opens the chosen one, preserving every
 *  other lane on the NFT. Balance-first — draws from the shared balance; only the first stream (no balance
 *  yet) bundles a starter deposit. */
export interface StreamLaneInput {
  readonly vaultId: VaultId;
  readonly side: OptionsVaultSide;
  readonly ratePerMin: number;
  readonly starterMinutes?: number;
}

export interface PauseLaneInput {
  readonly vaultId: VaultId;
  readonly side: OptionsVaultSide;
}

export type ResumeLaneInput = PauseLaneInput;

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
  /** Open / switch / re-rate a vault's stream (balance-first). */
  streamLane: (input: StreamLaneInput) => Promise<TxId>;
  /** Pause a stream: drop its lane (deposit + accrued shares stay on-chain), remember the rate to resume. */
  pauseLane: (input: PauseLaneInput) => Promise<TxId>;
  /** Resume a paused stream at the remembered rate. */
  resumeLane: (input: ResumeLaneInput) => Promise<TxId>;
  /** Sweep to wallet: stop every lane and withdraw the shared balance. Positions persist via the ledger,
   *  now reading `depleted` (the money's gone); clears any paused intent for the NFT. */
  sweepNft: (input: StopAllFundingInput) => Promise<TxId>;
  /** The paused lanes the runtime currently remembers. */
  pausedLanes: () => readonly OptionsPausedLane[];
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

// Runway minutes for the STARTER deposit bundled only with the first stream (NFT has no shared balance yet).
const DEFAULT_STARTER_MINUTES = 60;
// Fallback resume rate ($/min) when a paused leg has no remembered rate (e.g. one paused by a side-switch).
const DEFAULT_RESUME_RATE_PER_MIN = 1;

export const createOptionsRuntime = (input: OptionsRuntimeInput): OptionsRuntime =>
  new OptionsRuntimeFacade(input);

class OptionsRuntimeFacade implements OptionsRuntime {
  readonly config: OptionsRuntimeConfig;
  readonly chain: OptionsChain;
  private readonly autoAdvanceOverflow: boolean;
  private readonly lvstDecimals: number;
  private readonly persistPausedLanes?: (lanes: readonly OptionsPausedLane[]) => void;
  private pausedLaneRegistry: OptionsPausedLane[];
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
    this.lvstDecimals = lvstDecimalsForChain(input.chainConfig.walletInit.chain);
    this.pausedLaneRegistry = [...(input.pausedLanes?.initial ?? [])];
    this.persistPausedLanes = input.pausedLanes?.onChange;
  }

  readSnapshot(): OptionsRuntimeState {
    return this.store.readState();
  }

  readPanel(): OptionsPanel {
    const snapshot = this.requireUserSnapshot();
    return this.projectPanel(snapshot);
  }

  readBoard(): OptionsBoard {
    const state = this.store.readState();
    const snapshot = this.requireUserSnapshot();
    return assembleBoard(state.revision, snapshot, this.projectPanel(snapshot));
  }

  private projectPanel(snapshot: OptionsUserOptionsSnapshot): OptionsPanel {
    return projectOptionsPanel(snapshot, {
      lvstDecimals: this.lvstDecimals,
      pausedLanes: this.pausedLaneRegistry
    });
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

  async streamLane(input: StreamLaneInput): Promise<TxId> {
    const snapshot = this.requireUserSnapshot();
    const nft = this.findNftForVault(snapshot, input.vaultId);
    if (nft === undefined) {
      throw new LiveStreakConfigError({
        message: "No position NFT for this vault's market — mint one first",
        metadata: { details: input.vaultId }
      });
    }

    const rate = perMinUSDCToRate(input.ratePerMin);
    const desired = this.existingLaneWrites(nft).filter((lane) => lane.vaultId !== input.vaultId);
    desired.push({ vaultId: input.vaultId, side: input.side, rate });

    const balance = nft.balance ?? 0n;
    const starterMinutes = input.starterMinutes ?? DEFAULT_STARTER_MINUTES;
    const addDeposit = balance > 0n ? 0n : rate * BigInt(Math.max(1, Math.round(starterMinutes * 60)));

    this.forgetPaused(nft.tokenId.toString(), input.vaultId);
    return this.chain.writer.setLanes({ tokenId: nft.tokenId, lanes: desired, addDeposit });
  }

  async pauseLane(input: PauseLaneInput): Promise<TxId> {
    const snapshot = this.requireUserSnapshot();
    const nft = this.findNftForVault(snapshot, input.vaultId);
    const target = nft?.lanes.find(
      (lane) =>
        lane.vaultId === input.vaultId && lane.side === input.side && lane.rate > 0n && !lane.depleted
    );
    if (nft === undefined || target === undefined) {
      throw new LiveStreakConfigError({
        message: "No active stream to pause",
        metadata: { details: `${input.vaultId}:${input.side}` }
      });
    }

    const desired = this.existingLaneWrites(nft).filter(
      (lane) => !(lane.vaultId === input.vaultId && lane.side === input.side)
    );
    // Remember the rate BEFORE the tx so a mid-flight refresh still resumes correctly; roll back on failure.
    this.rememberPaused({
      tokenId: nft.tokenId.toString(),
      vaultId: input.vaultId,
      side: input.side,
      rate: target.rate
    });
    try {
      return await this.chain.writer.setLanes({ tokenId: nft.tokenId, lanes: desired, addDeposit: 0n });
    } catch (error) {
      this.forgetPaused(nft.tokenId.toString(), input.vaultId, input.side);
      throw error;
    }
  }

  async resumeLane(input: ResumeLaneInput): Promise<TxId> {
    const snapshot = this.requireUserSnapshot();
    const nft = this.findNftForVault(snapshot, input.vaultId);
    if (nft === undefined) {
      throw new LiveStreakConfigError({
        message: "No position NFT for this vault's market — mint one first",
        metadata: { details: input.vaultId }
      });
    }
    const tokenId = nft.tokenId.toString();
    const remembered = this.pausedLaneRegistry.find(
      (lane) => lane.tokenId === tokenId && lane.vaultId === input.vaultId && lane.side === input.side
    );

    // Resume at the remembered rate (paused via the button), else a sensible default — a leg paused by a
    // side-switch has no remembered rate. One lane per vault, so this replaces any side currently on the
    // vault (doubles as switch-back), and re-funds deposit-free while the shared balance lasts.
    const rate = remembered?.rate ?? perMinUSDCToRate(DEFAULT_RESUME_RATE_PER_MIN);
    const desired = this.existingLaneWrites(nft).filter((lane) => lane.vaultId !== input.vaultId);
    desired.push({ vaultId: input.vaultId, side: input.side, rate });
    const balance = nft.balance ?? 0n;
    const addDeposit = balance > 0n ? 0n : rate * BigInt(Math.max(1, Math.round(DEFAULT_STARTER_MINUTES * 60)));
    const tx = await this.chain.writer.setLanes({ tokenId: nft.tokenId, lanes: desired, addDeposit });
    this.forgetPaused(tokenId, input.vaultId, input.side);
    return tx;
  }

  async sweepNft(input: StopAllFundingInput): Promise<TxId> {
    const tx = await this.chain.writer.stopAllFunding(input);
    // Cashed out — no balance to resume from, so drop any remembered pauses for this NFT. The positions
    // themselves persist via the share ledger, now reading `depleted` (the deposit is gone).
    this.forgetPausedForToken(input.tokenId.toString());
    return tx;
  }

  pausedLanes(): readonly OptionsPausedLane[] {
    return this.pausedLaneRegistry;
  }

  private findNftForVault(
    snapshot: OptionsUserOptionsSnapshot,
    vaultId: VaultId
  ): OptionsNft | undefined {
    const byLane = snapshot.nfts.find((entry) => entry.nft.lanes.some((lane) => lane.vaultId === vaultId));
    if (byLane !== undefined) {
      return byLane.nft;
    }
    const vault = snapshot.vaults.find((entry) => entry.vault.vaultId === vaultId);
    if (vault === undefined) {
      return undefined;
    }
    return snapshot.nfts.find((entry) => entry.nft.marketId === vault.vault.marketId)?.nft;
  }

  // Every on-chain lane as setLanes-ready entries, at its COMMITTED rate. Depleted lanes are included
  // (committedRate survives depletion) so a setLanes rebuild preserves them instead of deleting them —
  // setLanes is full-replacement, so a dropped lane is wiped. A dry depleted lane re-asserts with
  // maxEnd=now (re-depletes immediately, zero accrual, onFund credits so no stranding), staying visible
  // and re-fundable rather than vanishing when you pause/stream a sibling lane.
  private existingLaneWrites(nft: OptionsNft): LaneWriteInput[] {
    return nft.lanes
      .filter((lane) => lane.committedRate > 0n)
      .map((lane) => ({ vaultId: lane.vaultId, side: lane.side, rate: lane.committedRate }));
  }

  private rememberPaused(lane: OptionsPausedLane): void {
    const others = this.pausedLaneRegistry.filter(
      (entry) =>
        !(entry.tokenId === lane.tokenId && entry.vaultId === lane.vaultId && entry.side === lane.side)
    );
    this.setPausedRegistry([...others, lane]);
  }

  private forgetPaused(tokenId: string, vaultId: string, side?: OptionsVaultSide): void {
    const next = this.pausedLaneRegistry.filter(
      (entry) =>
        !(
          entry.tokenId === tokenId &&
          entry.vaultId === vaultId &&
          (side === undefined || entry.side === side)
        )
    );
    if (next.length !== this.pausedLaneRegistry.length) {
      this.setPausedRegistry(next);
    }
  }

  private forgetPausedForToken(tokenId: string): void {
    const next = this.pausedLaneRegistry.filter((entry) => entry.tokenId !== tokenId);
    if (next.length !== this.pausedLaneRegistry.length) {
      this.setPausedRegistry(next);
    }
  }

  private setPausedRegistry(lanes: OptionsPausedLane[]): void {
    this.pausedLaneRegistry = lanes;
    this.persistPausedLanes?.(this.pausedLaneRegistry);
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
        assembleBoard(state.revision, state.userSnapshot, this.projectPanel(state.userSnapshot))
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

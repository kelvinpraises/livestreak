// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import type { MarketId, TokenId, UserAddress, VaultId } from "../model/ids.js";
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
  AddFundsInput,
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
  /** Board-first lens: aim the runtime at one market and load the user's view of it. */
  configure: (input: { readonly marketId: MarketId }) => Promise<OptionsRuntimeState>;
  /** Inverse of configure: drop the lens and clear snapshots — the board reads empty again. */
  close: () => OptionsRuntimeState;
  activeMarketId: () => MarketId | undefined;
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
  /** Balance-first top-up: deposit into the NFT's shared budget, re-asserting its current lanes so a
   *  full-replacement setLanes never drops one. Works on a laneless mint (parks the deposit as budget). */
  addFunds: (input: AddFundsInput) => Promise<TxId>;
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
  // The token's full lane set from the runtime's OWN last setLanes write. setLanes is FULL-REPLACEMENT,
  // so `desired` must carry every lane the token still holds — rebuilding it from the polled snapshot
  // drops a sibling lane funded moments ago whose read hasn't landed yet (Solana read-after-write lag),
  // silently capping the NFT at one vault. This overlay is the authoritative lane set until a confirmed
  // read catches up (reconciled in refreshUser), so a second/third vault never wipes the first.
  // Session-only (a reload re-reads the chain); keyed by tokenId string.
  private readonly pendingLaneWrites = new Map<string, LaneWriteInput[]>();
  private readonly store: OptionsRuntimeStore;
  private readonly boardSubscriptions = createBoardSubscriptionRegistry();
  private readonly listeners = new Set<(state: OptionsRuntimeState) => void>();
  private readonly changeListeners = new Set<(state: OptionsRuntimeState) => void>();
  private readonly memoryWatchers = new Map<string, Set<(value: unknown) => void>>();
  private pollingTimer: ReturnType<typeof setInterval> | undefined;
  private activeMarket: MarketId | undefined;

  constructor(input: OptionsRuntimeInput) {
    this.config = validateOptionsRuntimeConfig(input.config);
    this.store = createOptionsRuntimeStore(this.config.runtimeId);
    this.chain = input.chain ?? createOptionsChain(input.chainConfig);
    this.autoAdvanceOverflow = input.chainConfig.autoAdvanceOverflow === true;
    this.lvstDecimals = lvstDecimalsForChain(input.chainConfig.walletInit.chain);
    this.pausedLaneRegistry = [...(input.pausedLanes?.initial ?? [])];
    this.persistPausedLanes = input.pausedLanes?.onChange;
  }

  async configure(input: { readonly marketId: MarketId }): Promise<OptionsRuntimeState> {
    this.activeMarket = input.marketId;
    if (this.config.user !== undefined) {
      return this.refreshUser(this.config.user, input.marketId);
    }
    return this.refreshMarket(input.marketId);
  }

  close(): OptionsRuntimeState {
    this.activeMarket = undefined;
    this.store.reset();
    return this.publish();
  }

  activeMarketId(): MarketId | undefined {
    return this.activeMarket;
  }

  readSnapshot(): OptionsRuntimeState {
    return this.store.readState();
  }

  readPanel(): OptionsPanel {
    return this.projectPanel(this.userSnapshotOrEmpty());
  }

  readBoard(): OptionsBoard {
    const state = this.store.readState();
    const snapshot = this.userSnapshotOrEmpty();
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
    const desired = this.currentLaneWrites(nft).filter((lane) => lane.vaultId !== input.vaultId);
    desired.push({ vaultId: input.vaultId, side: input.side, rate });

    const balance = nft.balance ?? 0n;
    const starterMinutes = input.starterMinutes ?? DEFAULT_STARTER_MINUTES;
    const addDeposit = balance > 0n ? 0n : rate * BigInt(Math.max(1, Math.round(starterMinutes * 60)));

    this.forgetPaused(nft.tokenId.toString(), input.vaultId);
    const tx = await this.chain.writer.setLanes({ tokenId: nft.tokenId, lanes: desired, addDeposit });
    this.recordLaneWrites(nft.tokenId, desired);
    return tx;
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

    const desired = this.currentLaneWrites(nft).filter(
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
      const tx = await this.chain.writer.setLanes({ tokenId: nft.tokenId, lanes: desired, addDeposit: 0n });
      this.recordLaneWrites(nft.tokenId, desired);
      return tx;
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
    const desired = this.currentLaneWrites(nft).filter((lane) => lane.vaultId !== input.vaultId);
    desired.push({ vaultId: input.vaultId, side: input.side, rate });
    const balance = nft.balance ?? 0n;
    const addDeposit = balance > 0n ? 0n : rate * BigInt(Math.max(1, Math.round(DEFAULT_STARTER_MINUTES * 60)));
    const tx = await this.chain.writer.setLanes({ tokenId: nft.tokenId, lanes: desired, addDeposit });
    this.recordLaneWrites(nft.tokenId, desired);
    this.forgetPaused(tokenId, input.vaultId, input.side);
    return tx;
  }

  async addFunds(input: AddFundsInput): Promise<TxId> {
    if (input.deposit <= 0n) {
      throw new LiveStreakConfigError({
        message: "addFunds deposit must be positive",
        metadata: { details: input.deposit.toString() }
      });
    }
    const snapshot = this.requireUserSnapshot();
    const entry = snapshot.nfts.find(
      (candidate) => candidate.nft.tokenId.toString() === input.tokenId.toString()
    );
    if (entry === undefined) {
      throw new LiveStreakConfigError({
        message: "No position NFT for this token — mint one first",
        metadata: { details: input.tokenId.toString() }
      });
    }
    // Re-assert the token's CURRENT full lane set (overlay-aware) with the deposit as add_deposit. setLanes
    // is full-replacement, so building this from a snapshot that lags a just-funded lane (Solana
    // read-after-write) would drop it — the overlay is what makes addFunds safe on every chain. A laneless
    // mint re-asserts [] and just parks the deposit as budget (the first-bet top-up).
    const desired = this.currentLaneWrites(entry.nft);
    const tx = await this.chain.writer.setLanes({
      tokenId: entry.nft.tokenId,
      lanes: desired,
      addDeposit: input.deposit
    });
    this.recordLaneWrites(entry.nft.tokenId, desired);
    return tx;
  }

  async sweepNft(input: StopAllFundingInput): Promise<TxId> {
    const tx = await this.chain.writer.stopAllFunding(input);
    // Cashed out — no balance to resume from, so drop any remembered pauses for this NFT. The positions
    // themselves persist via the share ledger, now reading `depleted` (the deposit is gone).
    this.forgetPausedForToken(input.tokenId.toString());
    this.recordLaneWrites(input.tokenId, []);
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

  // The token's current full lane set for a setLanes rebuild: the runtime's OWN last write when the
  // polled snapshot hasn't caught up to it yet (Solana read-after-write lag), else the on-chain lanes.
  // This is what stops a second/third vault fund from wiping the first via full-replacement setLanes.
  //
  // Lanes whose vault reached a TERMINAL state (resolved/disputed) are dropped from the rebuild: once
  // such a lane runs dry (maxEnd passes), MarketDriver.setLanes' run-dry revive routes it back through
  // Vault.onFund, whose `Status.Open` gate reverts the whole call — bricking every top-up AND new bet
  // on the NFT. Dropped, the driver diffs the lane as removed and settles it via Vault.onStop, which
  // has no Open gate and banks against resolvedAt. Depleted lanes on OPEN vaults still re-assert per
  // the existingLaneWrites note — this filter is terminal-vault-only.
  private currentLaneWrites(nft: OptionsNft): LaneWriteInput[] {
    const lanes =
      this.pendingLaneWrites.get(nft.tokenId.toString()) ?? this.existingLaneWrites(nft);
    const snapshot = this.store.readState().userSnapshot;
    if (snapshot === undefined) return lanes;
    const terminal = new Set(
      snapshot.vaults
        .filter((entry) => entry.vault.status === "resolved" || entry.vault.status === "disputed")
        .map((entry) => entry.vault.vaultId.toString())
    );
    if (terminal.size === 0) return lanes;
    return lanes.filter((lane) => !terminal.has(lane.vaultId.toString()));
  }

  private recordLaneWrites(tokenId: TokenId, lanes: readonly LaneWriteInput[]): void {
    this.pendingLaneWrites.set(tokenId.toString(), [...lanes]);
  }

  // Drop the optimistic overlay for a token once a confirmed read reflects the same lane set, handing the
  // source of truth back to the chain. Compared by (vaultId:side) keys — only which lanes exist matters,
  // not their rate/deposit. A token absent from this snapshot (another market) keeps its overlay.
  private reconcilePendingLanes(snapshot: OptionsUserOptionsSnapshot): void {
    if (this.pendingLaneWrites.size === 0) return;
    for (const [tokenId, pending] of this.pendingLaneWrites) {
      const entry = snapshot.nfts.find((e) => e.nft.tokenId.toString() === tokenId);
      if (entry === undefined) continue;
      const chainKeys = new Set(
        this.existingLaneWrites(entry.nft).map((lane) => `${lane.vaultId}:${lane.side}`)
      );
      const pendingKeys = pending.map((lane) => `${lane.vaultId}:${lane.side}`);
      if (chainKeys.size === pendingKeys.length && pendingKeys.every((key) => chainKeys.has(key))) {
        this.pendingLaneWrites.delete(tokenId);
      }
    }
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
      this.reconcilePendingLanes(snapshot);
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

  // Board-first: unconfigured (or closed) reads as an honest empty board, not an error.
  private userSnapshotOrEmpty(): OptionsUserOptionsSnapshot {
    const snapshot = this.store.readState().userSnapshot;
    if (snapshot !== undefined) {
      return snapshot;
    }
    if (this.config.user === undefined) {
      return this.requireUserSnapshot();
    }
    return {
      account: this.config.user,
      markets: [],
      vaults: [],
      nfts: [],
      lvstAccount: {
        account: this.config.user,
        balance: 0n,
        staked: 0n,
        pendingDividends: 0n
      },
      usdcBalance: 0n
    };
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

    if (state.userSnapshot !== undefined || this.config.user !== undefined) {
      const snapshot = this.userSnapshotOrEmpty();
      this.boardSubscriptions.notify(
        assembleBoard(state.revision, snapshot, this.projectPanel(snapshot))
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

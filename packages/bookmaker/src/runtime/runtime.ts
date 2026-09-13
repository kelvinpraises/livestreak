import { LiveStreakRuntimeError } from "@livestreak/core";

import { projectBookmakerPanel, type BookmakerPanelSnapshot } from "../bridge/panel/project.js";
import type { BookmakerPanelView } from "../model/watch-source.js";
import { createBookmakerChain, type BookmakerChain } from "../chains/index.js";
import { validateBookmakerChainConfig } from "../chains/config.js";
import type { BookmakerRuntimeConfig } from "./config.js";
import { createIdempotencyStore, type IdempotencyStore } from "./idempotency.js";
import { createVaultOnce, type CreateVaultOnceResult } from "./create-vault-once.js";
import { createSnapshotSubscriptionRegistry } from "./subscriptions.js";
import { createBookmakerRuntimeStore, type BookmakerRuntimeState, type BookmakerRuntimeStore } from "./store.js";
import type { CreateVaultIntent } from "../model/write-intent.js";
import { validateBookmakerRuntimeConfig } from "../runtime/validate.js";

// --- exports ---

export interface BookmakerRuntimeInput {
  readonly config: BookmakerRuntimeConfig;
  readonly chain?: BookmakerChain;
}

export interface BookmakerRuntime {
  readonly config: BookmakerRuntimeConfig;
  readonly chain: BookmakerChain;
  readonly idempotencyStore: IdempotencyStore;
  readonly readSnapshot: () => BookmakerRuntimeState;
  readonly readPanel: () => BookmakerPanelView;
  readonly publishSnapshot: (snapshot: BookmakerPanelSnapshot) => BookmakerRuntimeState;
  readonly subscribeSnapshots: (listener: (state: BookmakerRuntimeState) => void) => () => void;
  readonly set: (key: string, value: unknown) => BookmakerRuntimeState;
  readonly get: <T>(key: string) => T | undefined;
  readonly watchMemory: (key: string, listener: (value: unknown) => void) => () => void;
  readonly createVaultOnce: (
    intent: CreateVaultIntent,
    nowMs: number
  ) => Promise<CreateVaultOnceResult>;
}

export const createBookmakerRuntime = (input: BookmakerRuntimeInput): BookmakerRuntime =>
  new BookmakerRuntimeFacade(input);

class BookmakerRuntimeFacade implements BookmakerRuntime {
  readonly config: BookmakerRuntimeConfig;
  readonly chain: BookmakerChain;
  readonly idempotencyStore: IdempotencyStore;
  private readonly store: BookmakerRuntimeStore;
  private readonly subscriptions = createSnapshotSubscriptionRegistry();
  // Open per-runtime scratch space for bridge/edge callers — not vault idempotency state.
  private readonly memory = new Map<string, unknown>();
  private readonly memoryWatchers = new Map<string, Set<(value: unknown) => void>>();
  // Last published snapshot — lets incremental updates (recording a completed vault, surfacing a
  // failure) preserve prior panel state (watchSource, marketContext, pending intents) instead of clobbering it.
  private lastSnapshot: BookmakerPanelSnapshot;

  constructor(input: BookmakerRuntimeInput) {
    const validated = validateBookmakerRuntimeConfig(input.config);
    if (validated.ok === false) {
      throw new LiveStreakRuntimeError({
        message: validated.issues.join("; ")
      });
    }

    this.config = validated.value;
    this.store = createBookmakerRuntimeStore(this.config.runtimeId);
    this.idempotencyStore = createIdempotencyStore();
    this.chain =
      input.chain ??
      createBookmakerChain(
        validateBookmakerChainConfig({
          walletInit: this.config.walletInit,
          seed: this.config.seed,
          addresses: this.config.addresses,
          ...(this.config.readRpcUrl === undefined ? {} : { readRpcUrl: this.config.readRpcUrl })
        })
      );
    this.lastSnapshot = this.emptyPanelSnapshot();
  }

  readSnapshot(): BookmakerRuntimeState {
    return this.store.readState();
  }

  readPanel(): BookmakerPanelView {
    const state = this.store.readState();
    if (state.panel !== undefined) {
      return state.panel;
    }

    return projectBookmakerPanel(this.emptyPanelSnapshot());
  }

  publishSnapshot(snapshot: BookmakerPanelSnapshot): BookmakerRuntimeState {
    this.lastSnapshot = snapshot;
    const panel = projectBookmakerPanel(snapshot);
    const state = this.store.publish({
      panel,
      latestDetection: snapshot.latestDetection,
      currentDraft: snapshot.currentDraft,
      similarityResult: snapshot.similarityResult,
      lastDecision: snapshot.lastDecision,
      pendingWriteIntents: snapshot.pendingWriteIntents ?? [],
      completedVaultCreations: snapshot.completedVaultCreations ?? [],
      ...(snapshot.lastError === undefined ? {} : { lastError: snapshot.lastError }),
      updatedAtMs: snapshot.updatedAtMs ?? 0
    });

    this.subscriptions.notify(state);
    return state;
  }

  subscribeSnapshots(listener: (state: BookmakerRuntimeState) => void): () => void {
    return this.subscriptions.subscribe(listener);
  }

  set(key: string, value: unknown): BookmakerRuntimeState {
    this.memory.set(key, value);
    const watchers = this.memoryWatchers.get(key);
    if (watchers !== undefined) {
      for (const watcher of watchers) {
        watcher(value);
      }
    }

    return this.store.readState();
  }

  get<T>(key: string): T | undefined {
    return this.memory.get(key) as T | undefined;
  }

  watchMemory(key: string, listener: (value: unknown) => void): () => void {
    const watchers = this.memoryWatchers.get(key) ?? new Set();
    watchers.add(listener);
    this.memoryWatchers.set(key, watchers);

    return () => {
      watchers.delete(listener);
    };
  }

  async createVaultOnce(intent: CreateVaultIntent, nowMs: number): Promise<CreateVaultOnceResult> {
    try {
      const res = await createVaultOnce({
        store: this.idempotencyStore,
        chain: this.chain,
        intent,
        nowMs
      });
      // Record the completed creation into the panel so the console board confirms it. Previously the
      // vault landed on-chain but completedVaultCreations stayed empty and no snapshot was published, so
      // the console showed no success. Publishing here also notifies board subscribers (the console).
      const prev = this.lastSnapshot.completedVaultCreations ?? [];
      const already = prev.some((c) => c.result.vaultId === res.result.vaultId);
      this.publishSnapshot({
        ...this.lastSnapshot,
        completedVaultCreations: already ? prev : [...prev, { intent, result: res.result }],
        lastError: undefined,
        updatedAtMs: nowMs
      });
      return res;
    } catch (error) {
      // Surface the failure on the panel so the console shows why, instead of a silent no-op.
      this.publishSnapshot({
        ...this.lastSnapshot,
        lastError: error instanceof Error ? error.message : String(error),
        updatedAtMs: nowMs
      });
      throw error;
    }
  }

  private emptyPanelSnapshot(): BookmakerPanelSnapshot {
    return {
      runtimeId: this.config.runtimeId,
      marketContext: this.config.marketContext,
      watchSource: this.config.watchSource,
      pendingWriteIntents: [],
      completedVaultCreations: [],
      updatedAtMs: 0
    };
  }
}

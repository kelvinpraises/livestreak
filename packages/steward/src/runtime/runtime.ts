import { LiveStreakConfigError } from "@livestreak/core";

import { projectStewardPanel } from "../panel/project.js";
import type { StewardPanelView } from "../model/panel.js";
import type { StewardStateSnapshot } from "../panel/types.js";
import {
  validateStewardRuntimeConfig,
  type StewardRuntimeConfig,
  type StewardRuntimeInput
} from "./config.js";
import { refreshWatchedSubjects, toRuntimeLastError } from "./refresh.js";
import type { ContractFactSource, HostFactSource, ObserveFactSource } from "./sources.js";
import type { StewardActionPlanSink } from "./sink.js";
import { createStewardRuntimeStore, type StewardRuntimeStore } from "./store.js";

// --- exports ---

export interface StewardRuntime {
  readonly config: StewardRuntimeConfig;
  readSnapshot: () => StewardStateSnapshot;
  readPanel: () => StewardPanelView;
  refresh: () => Promise<StewardStateSnapshot>;
  subscribe: (listener: (snapshot: StewardStateSnapshot) => void) => () => void;
  startPolling: () => { readonly stop: () => void };
}

export const createStewardRuntime = (input: StewardRuntimeInput): StewardRuntime =>
  new StewardRuntimeFacade(input);

class StewardRuntimeFacade implements StewardRuntime {
  readonly config: StewardRuntimeConfig;
  private readonly store: StewardRuntimeStore;
  private readonly contractFactSource: ContractFactSource;
  private readonly hostFactSource: HostFactSource;
  private readonly observeFactSource: ObserveFactSource;
  private readonly actionPlanSink: StewardActionPlanSink;
  private readonly listeners = new Set<(snapshot: StewardStateSnapshot) => void>();
  private pollingTimer: ReturnType<typeof setInterval> | undefined;

  constructor(input: StewardRuntimeInput) {
    this.config = validateStewardRuntimeConfig(input.config);
    this.store = createStewardRuntimeStore(this.config.runtimeId);
    this.contractFactSource = input.contractFactSource;
    this.hostFactSource = input.hostFactSource;
    this.observeFactSource = input.observeFactSource;
    this.actionPlanSink = input.actionPlanSink;
  }

  readSnapshot(): StewardStateSnapshot {
    return this.store.readSnapshot();
  }

  readPanel(): StewardPanelView {
    return projectStewardPanel(this.store.readSnapshot());
  }

  async refresh(): Promise<StewardStateSnapshot> {
    try {
      const result = await refreshWatchedSubjects({
        watchedSubjects: this.config.watchedSubjects,
        ruleset: this.config.ruleset,
        decisionPolicy: this.config.decisionPolicy,
        actionContext: this.config.actionContext,
        sources: {
          contract: this.contractFactSource,
          host: this.hostFactSource,
          observe: this.observeFactSource
        }
      });

      if (result.pendingActionPlans.length > 0) {
        await this.actionPlanSink.submit(result.pendingActionPlans);
      }

      this.store.writeRefresh({
        watchedSubjects: this.config.watchedSubjects,
        latestFindings: result.latestFindings,
        latestDecisions: result.latestDecisions,
        pendingActionPlans: result.pendingActionPlans
      });
      this.store.setLastError(undefined);

      return this.publish();
    } catch (error) {
      this.fail(error);
    }
  }

  subscribe(listener: (snapshot: StewardStateSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  startPolling(): { readonly stop: () => void } {
    if (this.config.refreshIntervalMs === undefined) {
      throw new LiveStreakConfigError({
        message: "Steward runtime polling requires refreshIntervalMs in config",
        metadata: { details: this.config.runtimeId }
      });
    }

    if (this.pollingTimer !== undefined) {
      throw new LiveStreakConfigError({
        message: "Steward runtime polling is already active",
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

  private publish(): StewardStateSnapshot {
    const snapshot = this.store.readSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }

    return snapshot;
  }

  private fail(error: unknown): never {
    this.store.setLastError(toRuntimeLastError(error));
    this.publish();
    throw error;
  }
}

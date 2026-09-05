import { LiveStreakConfigError } from "@livestreak/core";

import { projectStewardPanel } from "../bridge/panel/project.js";
import type { StewardPanelView } from "../model/panel.js";
import type { StewardStateSnapshot } from "./store.js";
import type { StewardActionPlan } from "../model/action-plan.js";
import type { StewardDecisionAction } from "../model/decision.js";
import { planStewardActions } from "../workflow/action/plan.js";
import { isStewardDecisionAction } from "../validate/decision.js";
import {
  validateStewardRuntimeConfig,
  type StewardRuntimeConfig,
  type StewardRuntimeInput
} from "./config.js";
import { assembleBoard, type StewardBoard } from "./board.js";
import { refreshWatchedSubjects, toRuntimeLastError } from "./refresh.js";
import type {
  ContractFactSource,
  HostFactSource,
  MemoryFactSource,
  ObserveFactSource
} from "./sources.js";
import type { StewardActionPlanSink, StewardMemorySink } from "./sink.js";
import { createStewardRuntimeStore, type StewardRuntimeStore } from "./store.js";

// --- exports ---

export interface StewardRuntime {
  readonly config: StewardRuntimeConfig;
  readSnapshot: () => StewardStateSnapshot;
  readPanel: () => StewardPanelView;
  readBoard: () => StewardBoard;
  refresh: () => Promise<StewardStateSnapshot>;
  submitBridgeAction: (action: string, args: unknown) => Promise<StewardActionPlan>;
  subscribe: (listener: (snapshot: StewardStateSnapshot) => void) => () => void;
  subscribeBoard: (listener: (board: StewardBoard) => void) => () => void;
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
  private readonly memoryFactSource: MemoryFactSource;
  private readonly actionPlanSink: StewardActionPlanSink;
  private readonly memorySink: StewardMemorySink;
  private readonly listeners = new Set<(snapshot: StewardStateSnapshot) => void>();
  private readonly boardListeners = new Set<(board: StewardBoard) => void>();
  private pollingTimer: ReturnType<typeof setInterval> | undefined;

  constructor(input: StewardRuntimeInput) {
    this.config = validateStewardRuntimeConfig(input.config);
    this.store = createStewardRuntimeStore(this.config.runtimeId);
    this.contractFactSource = input.contractFactSource;
    this.hostFactSource = input.hostFactSource;
    this.observeFactSource = input.observeFactSource;
    this.memoryFactSource = input.memoryFactSource;
    this.actionPlanSink = input.actionPlanSink;
    this.memorySink = input.memorySink;
  }

  readSnapshot(): StewardStateSnapshot {
    const snapshot = this.store.readSnapshot();
    return {
      ...snapshot,
      watchedSubjects: [...this.config.watchedSubjects]
    };
  }

  readPanel(): StewardPanelView {
    return projectStewardPanel(this.store.readSnapshot());
  }

  readBoard(): StewardBoard {
    const snapshot = this.store.readSnapshot();
    return assembleBoard(snapshot.revision, projectStewardPanel(snapshot));
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
          observe: this.observeFactSource,
          memory: this.memoryFactSource
        }
      });

      for (const group of result.perSubject) {
        await this.memorySink.remember(group);
      }

      if (result.pendingActionPlans.length > 0) {
        await this.actionPlanSink.submit(result.pendingActionPlans);
      }

      this.store.writeRefresh({
        watchedSubjects: this.config.watchedSubjects,
        latestFindings: result.latestFindings,
        latestDecisions: result.latestDecisions,
        pendingActionPlans: result.pendingActionPlans
      });

      return this.publish();
    } catch (error) {
      this.fail(error);
    }
  }

  async submitBridgeAction(action: string, args: unknown): Promise<StewardActionPlan> {
    if (!isStewardDecisionAction(action)) {
      throw new LiveStreakConfigError({
        message: `Unknown steward bridge action: ${action}`,
        metadata: { details: action }
      });
    }

    const snapshot = this.readSnapshot();
    const bridgeArgs = readBridgeActionArgs(args);
    const subject = snapshot.watchedSubjects.find((entry) => entry.id === bridgeArgs.subjectId);

    if (subject === undefined) {
      throw new LiveStreakConfigError({
        message: "Steward bridge action requires a watched subjectId",
        metadata: { details: bridgeArgs.subjectId }
      });
    }

    const finding =
      snapshot.latestFindings.find(
        (entry) =>
          entry.subject.id === subject.id &&
          (bridgeArgs.findingId === undefined || entry.id === bridgeArgs.findingId)
      ) ??
      ({
        id: `bridge:${action}:${subject.id}`,
        kind: "manual_note" as const,
        subject,
        severity: "info" as const,
        message: bridgeArgs.reason ?? action
      } as const);

    const [plan] = planStewardActions(
      [
        {
          action,
          finding,
          reason: bridgeArgs.reason ?? `Bridge action ${action}`
        }
      ],
      this.config.actionContext
    );

    if (plan === undefined) {
      throw new LiveStreakConfigError({
        message: "Steward bridge action did not produce an action plan",
        metadata: { details: action }
      });
    }

    await this.actionPlanSink.submit([plan]);
    return plan;
  }

  subscribe(listener: (snapshot: StewardStateSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeBoard(listener: (board: StewardBoard) => void): () => void {
    this.boardListeners.add(listener);
    return () => {
      this.boardListeners.delete(listener);
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
    const board = assembleBoard(snapshot.revision, projectStewardPanel(snapshot));

    for (const listener of this.listeners) {
      listener(snapshot);
    }

    for (const listener of this.boardListeners) {
      listener(board);
    }

    return snapshot;
  }

  private fail(error: unknown): never {
    this.store.setLastError(toRuntimeLastError(error));
    this.publish();
    throw error;
  }
}

// --- helpers ---

const readBridgeActionArgs = (
  args: unknown
): { readonly subjectId: string; readonly reason?: string; readonly findingId?: string } => {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    throw new LiveStreakConfigError({
      message: "Steward bridge action args must be an object",
      metadata: { details: String(args) }
    });
  }

  const record = args as Record<string, unknown>;
  if (typeof record.subjectId !== "string" || record.subjectId.trim().length === 0) {
    throw new LiveStreakConfigError({
      message: "Steward bridge action args require subjectId",
      metadata: { details: String(record.subjectId) }
    });
  }

  return {
    subjectId: record.subjectId.trim(),
    ...(typeof record.reason === "string" ? { reason: record.reason } : {}),
    ...(typeof record.findingId === "string" ? { findingId: record.findingId } : {})
  };
};

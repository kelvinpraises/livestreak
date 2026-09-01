import type { LiveStreakError } from "@livestreak/core";
import type { Effect, Scope } from "effect";
import type { RegistryDescriptorBase, StageHealthSnapshotBase } from "#pipeline/shared.js";
import type { ControlCellDefinition, ControlSurface, DescribeControlContext } from "#run/control/bus/types.js";

export type {
  DescriptorValueSchema,
  RegistryCommandDescriptor,
  RegistryCommandScope,
  RegistryDescriptorKind,
  RegistryFlagDescriptor,
  StageHealth
} from "#pipeline/shared.js";

export type ProcessItemKind = "video" | "audio" | "metadata" | "marker";

export type ProcessBatchReason = "one" | "batch" | "window" | "sampled" | "eos-flush";

export interface ProcessInput<Payload = unknown> {
  readonly role: string;
  readonly kind: ProcessItemKind;
  readonly sequence: number;
  readonly epoch: number;
  readonly mediaTimeMs: number;
  readonly wallTimeMs: number;
  readonly payloadBytes: number;
  readonly payload: Payload;
}

export interface ProcessOutput<Payload = unknown> {
  readonly role: string;
  readonly kind: ProcessItemKind;
  readonly mediaTimeMs: number;
  readonly wallTimeMs?: number;
  readonly payloadBytes?: number;
  readonly payload: Payload;
}

export interface ProcessResult {
  readonly outputs: readonly ProcessOutput[];
}

export interface ProcessBatch {
  readonly inputs: readonly ProcessInput[];
  readonly reason: ProcessBatchReason;
}

export interface ProcessPackDescriptor extends RegistryDescriptorBase<"process"> {
  readonly assetProfile?: "none" | "optional" | "required";
}

export interface ProcessStageHealth extends StageHealthSnapshotBase<"process"> {
  readonly processedBatchCount: number;
  readonly outputCount: number;
  readonly processingLatencyMs?: number;
}

export interface ProcessAdapter {
  readonly descriptor: ProcessPackDescriptor;
  readonly process: (batch: ProcessBatch) => Effect.Effect<ProcessResult, LiveStreakError>;
  readonly health: Effect.Effect<ProcessStageHealth, LiveStreakError>;
  readonly control?: ControlSurface;
}

export interface ProcessPack<Config = unknown> {
  readonly descriptor: ProcessPackDescriptor;
  readonly validate: (config: Config) => Effect.Effect<Config, LiveStreakError>;
  readonly createAdapter: (config: Config) => Effect.Effect<ProcessAdapter, LiveStreakError, Scope.Scope>;
  readonly describeControl?: (
    config: Config,
    context: DescribeControlContext
  ) => Effect.Effect<ControlCellDefinition, LiveStreakError>;
}

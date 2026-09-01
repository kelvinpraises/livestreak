import type { LiveStreakError } from "@livestreak/core";
import type { OutputMode } from "@livestreak/schema";
import type { Effect, Scope } from "effect";
import type { PausePresentation } from "#pipeline/capture/index.js";
import type { TimelineMarker } from "#pipeline/timeline/index.js";
import type { RegistryDescriptorBase, StageHealthSnapshotBase } from "#pipeline/shared.js";
import type {
  ControlCellDefinition,
  ControlSurface,
  DescribeControlContext
} from "#run/control/bus/types.js";

export type {
  DescriptorValueSchema,
  RegistryCommandDescriptor,
  RegistryCommandScope,
  RegistryDescriptorKind,
  RegistryFlagDescriptor,
  StageHealth
} from "#pipeline/shared.js";

export interface SinkDriverDescriptor extends RegistryDescriptorBase<"publish"> {
  readonly mode: OutputMode;
  readonly requiresHost: boolean;
  readonly debugOnly: boolean;
}

export interface SinkStageHealth extends StageHealthSnapshotBase<"publish"> {
  readonly attachmentId?: string;
  readonly deliveredItems: number;
  readonly deliveryFps?: number;
}

export interface VideoSinkDeliveryItem<Payload = unknown> {
  readonly kind: "video";
  readonly sinkId: string;
  readonly trackId: string;
  readonly role: string;
  readonly sequence: number;
  readonly epoch: number;
  readonly mediaTimeMs: number;
  readonly wallTimeMs: number;
  readonly payloadBytes: number;
  readonly payload: Payload;
}

export interface MarkerSinkDeliveryItem {
  readonly kind: "marker";
  readonly sinkId: string;
  readonly trackId: string;
  readonly role: string;
  readonly sequence: number;
  readonly epoch: number;
  readonly mediaTimeMs?: number;
  readonly wallTimeMs: number;
  readonly marker: TimelineMarker;
}

export type SinkDeliveryItem<Payload = unknown> =
  | VideoSinkDeliveryItem<Payload>
  | MarkerSinkDeliveryItem;

export interface SinkFinalizeResult {
  readonly deliveredItems: number;
  readonly output?: {
    readonly kind: "file" | "memory" | "simulcast";
    readonly uri?: string;
  };
}

export interface SinkPausePresentation {
  readonly whilePaused: PausePresentation;
  readonly slateAssetId?: string;
}

export interface SinkPresentationControls {
  readonly pausePresentation: (
    presentation: SinkPausePresentation
  ) => Effect.Effect<void, LiveStreakError>;

  readonly resumePresentation: Effect.Effect<void, LiveStreakError>;
}

export interface SinkAttachment {
  readonly id: string;
  readonly deliver: (item: SinkDeliveryItem) => Effect.Effect<void, LiveStreakError>;
  readonly finalize: Effect.Effect<SinkFinalizeResult, LiveStreakError>;
  readonly health: Effect.Effect<SinkStageHealth, LiveStreakError>;
  readonly detach: Effect.Effect<void, LiveStreakError>;
  readonly control?: ControlSurface;
  readonly presentation?: SinkPresentationControls;
}

export interface SinkDriver<Config = unknown> {
  readonly descriptor: SinkDriverDescriptor;
  readonly mode: OutputMode;
  readonly validate: (config: Config) => Effect.Effect<Config, LiveStreakError>;
  readonly attach: (config: Config) => Effect.Effect<SinkAttachment, LiveStreakError, Scope.Scope>;
  readonly describeControl: (
    config: Config,
    context: DescribeControlContext
  ) => Effect.Effect<ControlCellDefinition, LiveStreakError>;
}

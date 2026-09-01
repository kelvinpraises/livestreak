import type { Effect, Scope, Stream } from "effect";
import type { LiveStreakError } from "@livestreak/core";
import type { TimePoint } from "@livestreak/schema";
import type { RegistryDescriptorBase, StageHealthSnapshotBase } from "#pipeline/shared.js";
import type { CaptureLivePauseState } from "./pause.js";
import type {
  ControlCellDefinition,
  ControlSurface,
  DescribeControlContext
} from "#run/control/bus/types.js";

export type { CaptureLivePauseState, CapturePausePresentation, PausePresentation } from "./pause.js";

export {
  assertPausePresentationValue,
  capturePausePresentationEqual,
  defaultCapturePausePresentation,
  isPausePresentation,
  pausePresentationValues
} from "./pause.js";

export type {
  DescriptorValueSchema,
  RegistryCommandDescriptor,
  RegistryCommandResultKind,
  RegistryCommandScope,
  RegistryDescriptorKind,
  RegistryFlagDescriptor,
  StageHealth
} from "#pipeline/shared.js";

export type CaptureSourceMode = "file" | "live";

export interface CaptureDriverDescriptor extends RegistryDescriptorBase<"capture"> {
  readonly sourceType: "file" | "browser" | "stream" | "synthetic";
  readonly sourceMode: CaptureSourceMode;
}

export interface CaptureLiveControls {
  readonly pause: () => Effect.Effect<CaptureLivePauseState, LiveStreakError>;

  readonly resume: () => Effect.Effect<CaptureLivePauseState, LiveStreakError>;

  readonly snapshot: Effect.Effect<CaptureLivePauseState, LiveStreakError>;
}

export interface CaptureStageHealth extends StageHealthSnapshotBase<"capture"> {
  readonly sourceId: string;
  readonly frameCount: number;
  readonly droppedFrames: number;
  readonly cadence?: RawFrameCadence;
}

export type RawFrameEncoding = "raw" | "jpeg" | "png" | "h264" | "h265" | "vp8" | "vp9" | "unknown";

export type RawFrameByteFormat =
  | "rgba"
  | "bgra"
  | "rgb"
  | "bgr"
  | "yuv420p"
  | "nv12"
  | "jpeg"
  | "png"
  | "h264-annexb"
  | "h264-avcc"
  | "unknown";

export interface RawFrameCadence {
  readonly mode: "capture" | "sample" | "replay" | "passthrough" | "synthetic";
  readonly expectedFps?: number;
  readonly observedFps?: number;
  readonly sequence: number;
  readonly droppedFrames: number;
}

export interface CaptureVideoPayload {
  readonly width: number;
  readonly height: number;
  readonly byteFormat: RawFrameByteFormat;
  readonly encoding: RawFrameEncoding;
  readonly expectedFps?: number;
  readonly data: Uint8Array;
}

export interface RawFrame {
  readonly id: string;
  readonly sourceId: string;
  readonly time: TimePoint;
  readonly cadence: RawFrameCadence;
  readonly payload: CaptureVideoPayload;
}

export interface FrameSource {
  readonly descriptor: CaptureDriverDescriptor;
  readonly frames: Stream.Stream<RawFrame, LiveStreakError>;
  readonly health: Effect.Effect<CaptureStageHealth, LiveStreakError>;
  readonly live?: CaptureLiveControls;
  readonly control?: ControlSurface;
}

export interface CaptureDriver<Config = unknown> {
  readonly descriptor: CaptureDriverDescriptor;
  readonly validate: (config: Config) => Effect.Effect<Config, LiveStreakError>;
  readonly create: (config: Config) => Effect.Effect<FrameSource, LiveStreakError, Scope.Scope>;
  readonly describeControl: (
    config: Config,
    context: DescribeControlContext
  ) => Effect.Effect<ControlCellDefinition, LiveStreakError>;
}

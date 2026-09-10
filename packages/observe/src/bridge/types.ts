import type { Effect } from "effect";
import type { LiveStreakError } from "@livestreak/core";
import type { ControlsView } from "#bridge/panel/types.js";
import type { ObserveRunResult } from "#run/kernel.js";
import type { Board } from "#run/control/board/index.js";
import type { ControlArtifact, ControlCallEnvelope, ControlCallResult } from "#run/control/bus/index.js";
import type { ArtifactSubscription, BoardSubscription } from "#run/control/bus/index.js";
import type { PackageRuntimeInit } from "@livestreak/schema";
import type { ObserveRuntime } from "#run/runtime.js";
import type { CapabilityGrant } from "#scope/scopes.js";

export const bridgeBoardReadScope = "bridge:board:read" as const;
export const bridgeControlsReadScope = "bridge:controls:read" as const;
export const bridgeArtifactReadScope = "bridge:artifact:read" as const;
export const bridgeBoardSubscribeScope = "bridge:board:subscribe" as const;
export const bridgeArtifactSubscribeScope = "bridge:artifact:subscribe" as const;
export const bridgeRunAwaitScope = "bridge:run:await" as const;

export interface BridgeCaller {
  readonly id: string;
  readonly label?: string;
  readonly trusted?: boolean;
  readonly grants?: readonly CapabilityGrant[];
}

export interface BridgeRunInput {
  readonly caller: BridgeCaller;
  readonly runId: string;
}

export interface BridgeCallInput {
  readonly caller: BridgeCaller;
  readonly envelope: ControlCallEnvelope;
}

export interface BridgeArtifactInput {
  readonly caller: BridgeCaller;
  readonly runId: string;
  readonly artifactId: unknown;
}

export interface BridgeSubscribeBoardInput {
  readonly caller: BridgeCaller;
  readonly runId: string;
  readonly listener: (board: Board) => void;
}

export interface BridgeSubscribeArtifactsInput {
  readonly caller: BridgeCaller;
  readonly runId: string;
  readonly listener: (artifact: ControlArtifact) => void;
}

export interface BridgeStopRunInput {
  readonly caller: BridgeCaller;
  readonly runId: string;
  readonly reason?: string;
  readonly timeoutMs?: number;
}

export interface CreateObserveBridgeInput {
  readonly runtime: ObserveRuntime;
  readonly sessionInit?: PackageRuntimeInit;
}

export interface ObserveBridge {
  readonly runtime: ObserveRuntime;

  readonly readBoard: (input: BridgeRunInput) => Effect.Effect<Board, LiveStreakError>;

  readonly readControls: (input: BridgeRunInput) => Effect.Effect<ControlsView, LiveStreakError>;

  readonly callFunction: (input: BridgeCallInput) => Effect.Effect<ControlCallResult, LiveStreakError>;

  readonly getArtifact: (input: BridgeArtifactInput) => Effect.Effect<ControlArtifact, LiveStreakError>;

  readonly subscribeBoard: (
    input: BridgeSubscribeBoardInput
  ) => Effect.Effect<BoardSubscription, LiveStreakError>;

  readonly subscribeArtifacts: (
    input: BridgeSubscribeArtifactsInput
  ) => Effect.Effect<ArtifactSubscription, LiveStreakError>;

  readonly awaitRun: (input: BridgeRunInput) => Effect.Effect<ObserveRunResult, LiveStreakError>;

  readonly stopRun: (input: BridgeStopRunInput) => Effect.Effect<ObserveRunResult, LiveStreakError>;
}

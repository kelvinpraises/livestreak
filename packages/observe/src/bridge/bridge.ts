import { Effect } from "effect";
import { LiveStreakConfigError, type LiveStreakError } from "@livestreak/core";
import { projectControlPanelControls } from "#bridge/panel/project.js";
import { systemRunStopScope } from "#run/control/index.js";
import { requireAnyScope, type CapabilityScope } from "#scope/scopes.js";
import type {
  BridgeCaller,
  BridgeCallInput,
  CreateObserveBridgeInput,
  ObserveBridge
} from "./types.js";
import {
  bridgeArtifactReadScope,
  bridgeArtifactSubscribeScope,
  bridgeBoardReadScope,
  bridgeBoardSubscribeScope,
  bridgeControlsReadScope,
  bridgeRunAwaitScope
} from "./types.js";

export type {
  BridgeArtifactInput,
  BridgeCallInput,
  BridgeCaller,
  BridgeRunInput,
  BridgeSubscribeArtifactsInput,
  BridgeSubscribeBoardInput,
  BridgeStopRunInput,
  CreateObserveBridgeInput,
  ObserveBridge
} from "./types.js";

export {
  bridgeArtifactReadScope,
  bridgeArtifactSubscribeScope,
  bridgeBoardReadScope,
  bridgeBoardSubscribeScope,
  bridgeControlsReadScope,
  bridgeRunAwaitScope
} from "./types.js";

export const evaluateBridgeAuthorization = (
  caller: BridgeCaller,
  requiredScope: string
): Effect.Effect<void, LiveStreakError> =>
  Effect.gen(function* () {
    yield* validateBridgeCaller(caller);
    yield* validateBridgeScope(requiredScope);

    if (caller.trusted === true) {
      return;
    }

    yield* requireAnyScope(caller.grants ?? [], requiredScope as CapabilityScope);
  });

export const createObserveBridge = (input: CreateObserveBridgeInput): ObserveBridge => {
  const { runtime } = input;

  return {
    runtime,

    readBoard: (bridgeInput) =>
      Effect.gen(function* () {
        yield* evaluateBridgeAuthorization(bridgeInput.caller, bridgeBoardReadScope);
        return yield* runtime.readBoard(bridgeInput.runId);
      }),

    readControls: (bridgeInput) =>
      Effect.gen(function* () {
        yield* evaluateBridgeAuthorization(bridgeInput.caller, bridgeControlsReadScope);
        const panel = yield* runtime.readPanel(bridgeInput.runId, { includeCatalog: true });
        return projectControlPanelControls(panel);
      }),

    callFunction: (bridgeInput) =>
      Effect.gen(function* () {
        yield* validateBridgeCallInput(bridgeInput);
        yield* evaluateBridgeAuthorization(bridgeInput.caller, bridgeInput.envelope.scope);
        return yield* runtime.callFunction(bridgeInput.envelope);
      }),

    getArtifact: (bridgeInput) =>
      Effect.gen(function* () {
        yield* evaluateBridgeAuthorization(bridgeInput.caller, bridgeArtifactReadScope);
        return yield* runtime.getArtifact(bridgeInput.runId, bridgeInput.artifactId);
      }),

    subscribeBoard: (bridgeInput) =>
      Effect.gen(function* () {
        yield* evaluateBridgeAuthorization(bridgeInput.caller, bridgeBoardSubscribeScope);
        return yield* runtime.subscribeBoard(bridgeInput.runId, bridgeInput.listener);
      }),

    subscribeArtifacts: (bridgeInput) =>
      Effect.gen(function* () {
        yield* evaluateBridgeAuthorization(bridgeInput.caller, bridgeArtifactSubscribeScope);
        return yield* runtime.subscribeArtifacts(bridgeInput.runId, bridgeInput.listener);
      }),

    awaitRun: (bridgeInput) =>
      Effect.gen(function* () {
        yield* evaluateBridgeAuthorization(bridgeInput.caller, bridgeRunAwaitScope);
        return yield* runtime.awaitRun(bridgeInput.runId);
      }),

    stopRun: (bridgeInput) =>
      Effect.gen(function* () {
        yield* validateBridgeCaller(bridgeInput.caller);
        yield* evaluateBridgeAuthorization(bridgeInput.caller, systemRunStopScope);
        return yield* runtime.stopRun(bridgeInput.runId, {
          ...(bridgeInput.reason === undefined ? {} : { reason: bridgeInput.reason }),
          ...(bridgeInput.timeoutMs === undefined ? {} : { timeoutMs: bridgeInput.timeoutMs })
        });
      })
  };
};

const validateBridgeCaller = (
  caller: BridgeCaller
): Effect.Effect<void, LiveStreakConfigError> => {
  if (caller.id.trim().length === 0) {
    return Effect.fail(
      new LiveStreakConfigError({
        message: "Bridge caller id is required"
      })
    );
  }

  return Effect.void;
};

const validateBridgeScope = (
  requiredScope: string
): Effect.Effect<void, LiveStreakConfigError> => {
  if (requiredScope.trim().length === 0) {
    return Effect.fail(
      new LiveStreakConfigError({
        message: "Bridge authorization scope is required"
      })
    );
  }

  return Effect.void;
};

const validateBridgeCallInput = (
  bridgeInput: BridgeCallInput
): Effect.Effect<void, LiveStreakConfigError> =>
  Effect.gen(function* () {
    yield* validateBridgeCaller(bridgeInput.caller);

    if (bridgeInput.envelope.scope.trim().length === 0) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "Control call envelope scope is required"
        })
      );
    }
  });

import { Effect } from "effect";
import { LiveStreakConfigError, type LiveStreakError } from "@livestreak/core";
import type { ControlCallEnvelope } from "#run/control/bus/index.js";
import type {
  ControlFunctionContext,
  ControlFunctionEntry,
  ControlSurface
} from "#run/control/bus/index.js";
import type { BoardPatch } from "#run/control/bus/index.js";
import type { BoardSectionPatch } from "#run/control/bus/index.js";
import {
  assertPausePresentationValue,
  capturePausePresentationEqual,
  type CapturePausePresentation,
  type PausePresentation
} from "#pipeline/capture/index.js";
import {
  projectWorkerControlView,
  type WorkerControlPause
} from "#run/control/board/index.js";

export const systemPausePauseScope = "system:pause:pause" as const;
export const systemPauseResumeScope = "system:pause:resume" as const;
export const systemPauseSetPresentationScope = "system:pause:setPresentation" as const;

export const createSystemPauseSurface = (): ControlSurface => ({
  cell: {
    id: "system:pause",
    cell: {
      label: "Pause",
      catalog: "system:pause",
       
      status: ["idle", null, Date.now()],
      functions: ["pause", "resume", "setPresentation"]
    }
  },
  functions: [
    pauseFunctionEntry(),
    resumeFunctionEntry(),
    setPresentationFunctionEntry()
  ]
});

const pauseFunctionEntry = (): ControlFunctionEntry => ({
  name: "pause",
  scope: systemPausePauseScope,
  call: (envelope, context) => pauseCall(envelope, context)
});

const resumeFunctionEntry = (): ControlFunctionEntry => ({
  name: "resume",
  scope: systemPauseResumeScope,
  call: (envelope, context) => resumeCall(envelope, context)
});

const setPresentationFunctionEntry = (): ControlFunctionEntry => ({
  name: "setPresentation",
  scope: systemPauseSetPresentationScope,
  call: (envelope, context) => setPresentationCall(envelope, context)
});

const pauseCall = (_envelope: ControlCallEnvelope, context: ControlFunctionContext) => {
  const settings = context.board.cells["system:pause"]?.settings ?? {};
  if (settings.requested === true) {
    return Effect.succeed({ boardPatch: {} });
  }

  return Effect.succeed({
    boardPatch: pauseRequestedPatch(true)
  });
};

const resumeCall = (_envelope: ControlCallEnvelope, context: ControlFunctionContext) => {
  const settings = context.board.cells["system:pause"]?.settings ?? {};
  if (settings.requested !== true) {
    return Effect.succeed({ boardPatch: {} });
  }

  return Effect.succeed({
    boardPatch: pauseRequestedPatch(false)
  });
};

const setPresentationCall = (
  envelope: ControlCallEnvelope,
  context: ControlFunctionContext
): Effect.Effect<{ readonly boardPatch: BoardPatch }, LiveStreakError> =>
  Effect.gen(function* () {
    const pauseSettings = context.board.cells["system:pause"]?.settings ?? {};
    if (pauseSettings.requested === true) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "system:pause:setPresentation cannot change presentation while pause is active"
        })
      );
    }

    const currentView = projectWorkerControlView(context.board);
    const patch = yield* decodePausePresentationPayload(envelope.payload);
    const merged = mergePausePresentation(currentView.pause, patch);
    yield* validateMergedPresentation(merged);

    if (
      capturePausePresentationEqual(currentBoardPresentation(currentView), merged) &&
      !boardHasStaleSlateAssetId(context.board, merged)
    ) {
      return { boardPatch: {} };
    }

    return {
      boardPatch: {
        cells: {
          "system:pause": {
            settings: presentationToSettingsSectionPatch(merged)
          }
        }
      }
    };
  });

const pauseRequestedPatch = (requested: boolean): BoardPatch => ({
  cells: {
    "system:pause": {
      settings: {
        set: { requested }
      }
    }
  }
});

const legacyPauseFields = ["mode", "fill", "markDiscontinuity"] as const;

const decodePausePresentationPayload = (
  payload: unknown
): Effect.Effect<
  Partial<CapturePausePresentation>,
  LiveStreakConfigError
> =>
  Effect.gen(function* () {
    if (payload === undefined) {
      return {};
    }

    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "system:pause:setPresentation payload must be an object"
        })
      );
    }

    const record = payload as Record<string, unknown>;

    for (const legacyField of legacyPauseFields) {
      if (record[legacyField] !== undefined) {
        return yield* Effect.fail(
          new LiveStreakConfigError({
            message: `system:pause:setPresentation ${legacyField} is no longer supported`
          })
        );
      }
    }

    let whilePaused: PausePresentation | undefined;
    let slateAssetId: string | undefined;

    if (record.whilePaused !== undefined) {
      whilePaused = yield* assertPausePresentationValue(
        record.whilePaused,
        "system:pause:setPresentation whilePaused"
      );
    }

    if (record.slateAssetId !== undefined) {
      if (typeof record.slateAssetId !== "string" || record.slateAssetId.trim().length === 0) {
        return yield* Effect.fail(
          new LiveStreakConfigError({
            message: "system:pause:setPresentation slateAssetId must be a non-empty string"
          })
        );
      }
      slateAssetId = record.slateAssetId.trim();
    }

    return {
      ...(whilePaused === undefined ? {} : { whilePaused }),
      ...(slateAssetId === undefined ? {} : { slateAssetId })
    };
  });

const validateMergedPresentation = (
  presentation: CapturePausePresentation
): Effect.Effect<CapturePausePresentation, LiveStreakConfigError> => {
  if (presentation.whilePaused === "slate" && presentation.slateAssetId === undefined) {
    return Effect.fail(
      new LiveStreakConfigError({
        message: 'system:pause:setPresentation requires slateAssetId when whilePaused is "slate"'
      })
    );
  }

  if (presentation.whilePaused !== "slate" && presentation.slateAssetId !== undefined) {
    return Effect.fail(
      new LiveStreakConfigError({
        message:
          'system:pause:setPresentation cannot set slateAssetId unless whilePaused is "slate"'
      })
    );
  }

  return Effect.succeed(presentation);
};

const mergePausePresentation = (
  current: WorkerControlPause,
  patch: Partial<CapturePausePresentation>
): CapturePausePresentation => ({
  whilePaused: patch.whilePaused ?? current.whilePaused,
  ...mergedSlateAssetId(current, patch)
});

const mergedSlateAssetId = (
  current: WorkerControlPause,
  patch: Partial<CapturePausePresentation>
): { readonly slateAssetId?: string } => {
  if (patch.slateAssetId !== undefined) {
    return { slateAssetId: patch.slateAssetId };
  }

  const whilePaused = patch.whilePaused ?? current.whilePaused;
  if (whilePaused !== "slate") {
    return {};
  }

  return current.slateAssetId === undefined ? {} : { slateAssetId: current.slateAssetId };
};

const currentBoardPresentation = (
  view: ReturnType<typeof projectWorkerControlView>
): CapturePausePresentation => ({
  whilePaused: view.pause.whilePaused,
  ...(view.pause.slateAssetId === undefined ? {} : { slateAssetId: view.pause.slateAssetId })
});

const presentationToSettingsSectionPatch = (
  presentation: CapturePausePresentation
): BoardSectionPatch => {
  const set: Record<string, unknown> = {
    whilePaused: presentation.whilePaused
  };

  if (presentation.whilePaused === "slate" && presentation.slateAssetId !== undefined) {
    set.slateAssetId = presentation.slateAssetId;
  }

  if (presentation.whilePaused !== "slate") {
    return {
      set,
      unset: ["slateAssetId"]
    };
  }

  return { set };
};

const boardHasStaleSlateAssetId = (
  board: ControlFunctionContext["board"],
  merged: CapturePausePresentation
): boolean => {
  if (merged.whilePaused === "slate") {
    return false;
  }

  const slateAssetId = board.cells["system:pause"]?.settings?.slateAssetId;
  return typeof slateAssetId === "string" && slateAssetId.length > 0;
};

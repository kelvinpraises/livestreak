import { Effect } from "effect";
import { LiveStreakConfigError } from "@livestreak/core";
import type { Board } from "#run/control/board/model.js";
import {
  assertPausePresentationValue,
  defaultCapturePausePresentation,
  type PausePresentation
} from "#pipeline/capture/index.js";
import { projectWorkerControlView } from "./worker-view.js";

export type { PausePresentation } from "#pipeline/capture/index.js";

export {
  assertPausePresentationValue,
  isPausePresentation,
  pausePresentationValues
} from "#pipeline/capture/index.js";

export const defaultControlPause = {
  requested: false,
  whilePaused: defaultCapturePausePresentation.whilePaused
} as const satisfies {
  readonly requested: boolean;
  readonly whilePaused: PausePresentation;
};

export const defaultControlPublish = {
  finalizeTimeoutMs: 3000
} as const;

export const defaultControlRun = {
  stopRequested: false
} as const;

const browserEncodingValues = ["jpeg", "png"] as const;

export const validateBoardSettings = (
  board: Board
): Effect.Effect<Board, LiveStreakConfigError> =>
  Effect.gen(function* () {
    const view = projectWorkerControlView(board);

    yield* validateSystemRunSettings(board);
    yield* validateSystemPauseSettings(board);
    yield* validateCaptureFileSettings(board);
    yield* validateCaptureBrowserSettings(board);
    yield* validateSinkCellSettings(board);

    if (view.sinks.length === 0) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "At least one sink policy is required"
        })
      );
    }

    for (const sink of view.sinks) {
      if (sink.subscribe.length === 0) {
        return yield* Effect.fail(
          new LiveStreakConfigError({
            message: `Sink ${sink.sinkId} must subscribe to at least one manifest track`
          })
        );
      }
    }

    return board;
  });

const validateSystemRunSettings = (board: Board): Effect.Effect<void, LiveStreakConfigError> =>
  Effect.gen(function* () {
    const settings = board.cells["system:run"]?.settings;
    if (settings === undefined) {
      return;
    }

    const runSettings = yield* assertPlainSettingsObject(settings, "system:run.settings");
    yield* assertOptionalBoolean(
      runSettings.stopRequested,
      "system:run.settings.stopRequested"
    );

    if (runSettings.stopReason !== undefined) {
      yield* assertNonEmptyTrimmedString(
        runSettings.stopReason,
        "system:run.settings.stopReason"
      );
    }
  });

const validateSystemPauseSettings = (board: Board): Effect.Effect<void, LiveStreakConfigError> =>
  Effect.gen(function* () {
    const settings = board.cells["system:pause"]?.settings;
    if (settings === undefined) {
      return;
    }

    const pauseSettings = yield* assertPlainSettingsObject(settings, "system:pause.settings");
    yield* assertOptionalBoolean(pauseSettings.requested, "system:pause.settings.requested");

    if (pauseSettings.whilePaused !== undefined) {
      yield* assertPausePresentationValue(
        pauseSettings.whilePaused,
        "system:pause.settings.whilePaused"
      );
    }

    yield* validateSlateAssetIdSettings(pauseSettings, "system:pause.settings");
    yield* rejectLegacyPauseFields(pauseSettings, "system:pause.settings");
  });

const validateCaptureFileSettings = (board: Board): Effect.Effect<void, LiveStreakConfigError> =>
  Effect.gen(function* () {
    const captureCell = board.cells["capture:file"];
    if (captureCell === undefined) {
      return;
    }

    const settings = captureCell.settings;
    if (settings === undefined) {
      return;
    }

    const fileSettings = yield* assertPlainSettingsObject(settings, "capture:file.settings");
    yield* assertOptionalString(fileSettings.path, "capture:file.settings.path");

    if (fileSettings.maxPumpMs !== undefined) {
      yield* assertMinimumNumber(
        fileSettings.maxPumpMs,
        "capture:file.settings.maxPumpMs",
        1
      );
    }
  });

const validateCaptureBrowserSettings = (board: Board): Effect.Effect<void, LiveStreakConfigError> =>
  Effect.gen(function* () {
    const captureCell = board.cells["capture:browser"];
    if (captureCell === undefined) {
      return;
    }

    const settings = captureCell.settings;
    if (settings === undefined) {
      return;
    }

    const browserSettings = yield* assertPlainSettingsObject(
      settings,
      "capture:browser.settings"
    );

    yield* assertOptionalString(browserSettings.url, "capture:browser.settings.url");

    if (browserSettings.captureFps !== undefined) {
      yield* assertPositiveNumber(
        browserSettings.captureFps,
        "capture:browser.settings.captureFps"
      );
    }

    if (browserSettings.maxFrames !== undefined) {
      yield* assertPositiveNumber(
        browserSettings.maxFrames,
        "capture:browser.settings.maxFrames"
      );
    }

    if (browserSettings.maxPumpMs !== undefined) {
      yield* assertMinimumNumber(
        browserSettings.maxPumpMs,
        "capture:browser.settings.maxPumpMs",
        1
      );
    }

    yield* assertOptionalBoolean(
      browserSettings.interactive,
      "capture:browser.settings.interactive"
    );
    yield* assertOptionalBoolean(browserSettings.debug, "capture:browser.settings.debug");

    if (
      browserSettings.encoding !== undefined &&
      (typeof browserSettings.encoding !== "string" ||
        !browserEncodingValues.includes(
          browserSettings.encoding as (typeof browserEncodingValues)[number]
        ))
    ) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "capture:browser.settings.encoding must be one of: jpeg, png"
        })
      );
    }

    yield* validateBrowserViewport(browserSettings.viewport);
    yield* validateBrowserCrop(browserSettings.crop);

    if (browserSettings.livePause !== undefined) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "capture:browser.settings.livePause is no longer supported"
        })
      );
    }
  });

const validateSinkCellSettings = (board: Board): Effect.Effect<void, LiveStreakConfigError> =>
  Effect.gen(function* () {
    for (const [cellId, cell] of Object.entries(board.cells)) {
      if (!cellId.startsWith("sink:")) {
        continue;
      }

      const settings = cell.settings;
      if (settings === undefined) {
        continue;
      }

      const fieldPath = `${cellId}.settings`;
      const sinkSettings = yield* assertPlainSettingsObject(settings, fieldPath);

      yield* assertOptionalString(sinkSettings.path, `${fieldPath}.path`);
      yield* assertOptionalBoolean(sinkSettings.required, `${fieldPath}.required`);
      yield* assertOptionalStringArray(sinkSettings.subscribe, `${fieldPath}.subscribe`);
    }
  });

const validateBrowserViewport = (
  viewport: unknown
): Effect.Effect<void, LiveStreakConfigError> =>
  Effect.gen(function* () {
    const viewportSettings = yield* assertPlainOptionalObject(
      viewport,
      "capture:browser.settings.viewport"
    );

    if (viewportSettings === undefined) {
      return;
    }

    if (viewportSettings.width !== undefined) {
      yield* assertPositiveNumber(
        viewportSettings.width,
        "capture:browser.settings.viewport.width"
      );
    }

    if (viewportSettings.height !== undefined) {
      yield* assertPositiveNumber(
        viewportSettings.height,
        "capture:browser.settings.viewport.height"
      );
    }
  });

const validateBrowserCrop = (crop: unknown): Effect.Effect<void, LiveStreakConfigError> =>
  Effect.gen(function* () {
    if (crop === undefined || crop === null) {
      return;
    }

    const cropSettings = yield* assertPlainSettingsObject(
      crop,
      "capture:browser.settings.crop"
    );

    yield* assertOptionalNumber(cropSettings.x, "capture:browser.settings.crop.x");
    yield* assertOptionalNumber(cropSettings.y, "capture:browser.settings.crop.y");

    if (cropSettings.width !== undefined) {
      yield* assertPositiveNumber(
        cropSettings.width,
        "capture:browser.settings.crop.width"
      );
    }

    if (cropSettings.height !== undefined) {
      yield* assertPositiveNumber(
        cropSettings.height,
        "capture:browser.settings.crop.height"
      );
    }
  });

const validateSlateAssetIdSettings = (
  settings: Readonly<Record<string, unknown>>,
  fieldPrefix: string
): Effect.Effect<void, LiveStreakConfigError> =>
  Effect.gen(function* () {
    const whilePaused = settings.whilePaused;
    const slateAssetId = settings.slateAssetId;
    const hasSlateAssetId = slateAssetId !== undefined;
    const whilePausedIsSlate = whilePaused === "slate";

    if (hasSlateAssetId) {
      yield* assertNonEmptyTrimmedString(slateAssetId, `${fieldPrefix}.slateAssetId`);

      if (whilePausedIsSlate === false) {
        return yield* Effect.fail(
          new LiveStreakConfigError({
            message: `${fieldPrefix}.whilePaused must be "slate" when slateAssetId is set`
          })
        );
      }
    }

    if (whilePausedIsSlate && hasSlateAssetId === false) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: `${fieldPrefix}.slateAssetId is required when whilePaused is "slate"`
        })
      );
    }
  });

const rejectLegacyPauseFields = (
  settings: Readonly<Record<string, unknown>>,
  fieldPrefix: string
): Effect.Effect<void, LiveStreakConfigError> => {
  for (const legacyField of ["mode", "fill", "markDiscontinuity"] as const) {
    if (settings[legacyField] !== undefined) {
      return Effect.fail(
        new LiveStreakConfigError({
          message: `${fieldPrefix}.${legacyField} is no longer supported`
        })
      );
    }
  }

  return Effect.void;
};

const assertPlainSettingsObject = (
  value: unknown,
  fieldPath: string
): Effect.Effect<Readonly<Record<string, unknown>>, LiveStreakConfigError> => {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return Effect.fail(
      new LiveStreakConfigError({
        message: `${fieldPath} must be a plain object`
      })
    );
  }

  return Effect.succeed(value as Readonly<Record<string, unknown>>);
};

const assertPlainOptionalObject = (
  value: unknown,
  fieldPath: string
): Effect.Effect<Readonly<Record<string, unknown>> | undefined, LiveStreakConfigError> => {
  if (value === undefined) {
    return Effect.succeed(void 0);
  }

  return assertPlainSettingsObject(value, fieldPath);
};

const assertOptionalString = (
  value: unknown,
  fieldPath: string
): Effect.Effect<void, LiveStreakConfigError> => {
  if (value === undefined) {
    return Effect.void;
  }

  if (typeof value !== "string") {
    return Effect.fail(
      new LiveStreakConfigError({
        message: `${fieldPath} must be a string`
      })
    );
  }

  return Effect.void;
};

const assertOptionalBoolean = (
  value: unknown,
  fieldPath: string
): Effect.Effect<void, LiveStreakConfigError> => {
  if (value === undefined) {
    return Effect.void;
  }

  if (typeof value !== "boolean") {
    return Effect.fail(
      new LiveStreakConfigError({
        message: `${fieldPath} must be a boolean`
      })
    );
  }

  return Effect.void;
};

const assertOptionalNumber = (
  value: unknown,
  fieldPath: string
): Effect.Effect<void, LiveStreakConfigError> => {
  if (value === undefined) {
    return Effect.void;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return Effect.fail(
      new LiveStreakConfigError({
        message: `${fieldPath} must be a finite number`
      })
    );
  }

  return Effect.void;
};

const assertPositiveNumber = (
  value: unknown,
  fieldPath: string
): Effect.Effect<void, LiveStreakConfigError> =>
  Effect.gen(function* () {
    yield* assertOptionalNumber(value, fieldPath);

    if (value !== undefined && (value as number) <= 0) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: `${fieldPath} must be greater than 0`
        })
      );
    }
  });

const assertMinimumNumber = (
  value: unknown,
  fieldPath: string,
  minimum: number
): Effect.Effect<void, LiveStreakConfigError> =>
  Effect.gen(function* () {
    yield* assertOptionalNumber(value, fieldPath);

    if (value !== undefined && (value as number) < minimum) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: `${fieldPath} must be at least ${minimum}`
        })
      );
    }
  });

const assertNonEmptyTrimmedString = (
  value: unknown,
  fieldPath: string
): Effect.Effect<void, LiveStreakConfigError> => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return Effect.fail(
      new LiveStreakConfigError({
        message: `${fieldPath} must be a non-empty string`
      })
    );
  }

  return Effect.void;
};

const assertOptionalStringArray = (
  value: unknown,
  fieldPath: string
): Effect.Effect<void, LiveStreakConfigError> => {
  if (value === undefined) {
    return Effect.void;
  }

  if (!Array.isArray(value)) {
    return Effect.fail(
      new LiveStreakConfigError({
        message: `${fieldPath} must be an array`
      })
    );
  }

  for (const entry of value) {
    if (typeof entry !== "string") {
      return Effect.fail(
        new LiveStreakConfigError({
          message: `${fieldPath} must be an array of strings`
        })
      );
    }
  }

  return Effect.void;
};

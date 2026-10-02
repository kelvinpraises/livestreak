import { Effect } from "effect";
import { pauseCellIdOf } from "./model.js";
import { LiveStreakConfigError } from "@livestreak/core";
import type { Board } from "#run/control/board/model.js";
import { runCellIdOf } from "#run/control/board/model.js";
import {
  assertPausePresentationValue,
  defaultCapturePausePresentation,
  type PausePresentation
} from "#pipeline/capture/index.js";
import { projectWorkerControlView } from "./worker-view.js";
import { observationCellId } from "#run/control/system/config.js";

export interface ObservationCompleteness {
  readonly capture: boolean;
  readonly publish: boolean;
  readonly market: boolean;
}

/**
 * Per-observation completeness for the SELECTED family only: a sibling's configured cells
 * or a global stage cell can never satisfy it. Partial writes stay valid — this reports
 * state, it does not gate (gates live in derivation/admission with operator-facing messages).
 */
export const observationCompleteness = (board: Board, obsId: string): ObservationCompleteness => {
  const capture = board.cells[observationCellId(obsId, "capture")];
  const publish = board.cells[observationCellId(obsId, "publish")];
  const marketId = board.cells[observationCellId(obsId, "market")]?.readonly?.marketId;
  return {
    capture: capture?.readonly?.configured === true,
    publish: publish?.readonly?.configured === true,
    market: typeof marketId === "string" && marketId.trim().length > 0
  };
};

export const isObservationConfigured = (board: Board, obsId: string): boolean => {
  const completeness = observationCompleteness(board, obsId);
  return completeness.capture && completeness.publish && completeness.market;
};

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

export interface ValidateBoardSettingsOptions {
  /**
   * Whether to enforce cross-cell COMPLETENESS (≥1 configured sink policy, each subscribing to a track).
   * That is a go-live prerequisite, not a per-field shape rule — it must only gate prepare/kernel, never
   * an intermediate configure write. On the remote console the operator mounts capture + sink cells with
   * `system:config configure`, then configures them one at a time; if this rule fired on every settings
   * write, configuring the capture cell before the sink cell would hard-fail with "At least one sink
   * policy is required" and trap the operator (no exposed ordering that satisfies it). So the live board
   * write path passes `false` (shape-only), and prepare (kernel) leaves it `true` (the default).
   */
  readonly requireComplete?: boolean;
  /**
   * Which observation completeness belongs to at prepare/start. Set: that family's own
   * policy must exist and subscribe (never a sibling's or a global cell). Absent: the
   * legacy global rule (≥1 stage policy). Completeness is per-family, never global.
   */
  readonly obsId?: string;
}

export const validateBoardSettings = (
  board: Board,
  options: ValidateBoardSettingsOptions = {}
): Effect.Effect<Board, LiveStreakConfigError> =>
  Effect.gen(function* () {
    const requireComplete = options.requireComplete ?? true;
    const view =
      options.obsId === undefined
        ? projectWorkerControlView(board)
        : projectWorkerControlView(board, options.obsId);

    yield* validateSystemRunSettings(board);
    yield* validateSystemPauseSettings(board);
    yield* validateCaptureFileSettings(board);
    yield* validateCaptureBrowserSettings(board);
    yield* validateSinkCellSettings(board);
    yield* validateFamilyCellSettings(board);

    if (!requireComplete) {
      return board;
    }

    if (board.cells["system:config"] !== undefined && Object.keys(board.cells).length === 1) {
      return board;
    }

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
    // Every family's run cell validates (a second family's invalid shape must not store),
    // not just the legacy-resolved one. Partial writes pass: only present fields are shaped.
    for (const cellId of runCellIds(board)) {
      yield* validateRunSettingsAt(board, cellId);
    }
  });

const runCellIds = (board: Board): string[] => {
  const ids = new Set<string>();
  const legacy = runCellIdOf(board);
  if (legacy !== undefined) {
    ids.add(legacy);
  }
  for (const id of Object.keys(board.cells)) {
    if (id.startsWith("obs:") && id.endsWith(":run")) {
      ids.add(id);
    }
  }
  return [...ids];
};

const validateRunSettingsAt = (board: Board, cellId: string): Effect.Effect<void, LiveStreakConfigError> =>
  Effect.gen(function* () {
    const settings = board.cells[cellId]?.settings;
    if (settings === undefined) {
      return;
    }

    const fieldPath = `${cellId}.settings`;
    const runSettings = yield* assertPlainSettingsObject(settings, fieldPath);
    yield* assertOptionalBoolean(runSettings.stopRequested, `${fieldPath}.stopRequested`);

    if (runSettings.stopReason !== undefined) {
      yield* assertNonEmptyTrimmedString(runSettings.stopReason, `${fieldPath}.stopReason`);
    }
  });

const validateSystemPauseSettings = (board: Board): Effect.Effect<void, LiveStreakConfigError> =>
  Effect.gen(function* () {
    for (const cellId of pauseCellIds(board)) {
      yield* validatePauseSettingsAt(board, cellId);
    }
  });

const pauseCellIds = (board: Board): string[] => {
  const ids = new Set<string>([pauseCellIdOf(board) ?? "system:pause"]);
  for (const id of Object.keys(board.cells)) {
    if (id.startsWith("obs:") && id.endsWith(":pause")) {
      ids.add(id);
    }
  }
  return [...ids];
};

const validatePauseSettingsAt = (board: Board, cellId: string): Effect.Effect<void, LiveStreakConfigError> =>
  Effect.gen(function* () {
    const settings = board.cells[cellId]?.settings;
    if (settings === undefined) {
      return;
    }

    const fieldPath = `${cellId}.settings`;
    const pauseSettings = yield* assertPlainSettingsObject(settings, fieldPath);
    yield* assertOptionalBoolean(pauseSettings.requested, `${fieldPath}.requested`);

    if (pauseSettings.whilePaused !== undefined) {
      yield* assertPausePresentationValue(pauseSettings.whilePaused, `${fieldPath}.whilePaused`);
    }

    yield* validateSlateAssetIdSettings(pauseSettings, fieldPath);
    yield* rejectLegacyPauseFields(pauseSettings, fieldPath);
  });

// Family shape validation: every observation's capture cell validates like its global
// counterpart (file shape by catalog; other catalogs keep the plain-object shape the
// configure decoders complete). Second-family garbage must not store.
const validateFamilyCellSettings = (board: Board): Effect.Effect<void, LiveStreakConfigError> =>
  Effect.gen(function* () {
    for (const [cellId, cell] of Object.entries(board.cells)) {
      const parts = cellId.split(":");
      if (parts[0] !== "obs" || parts.length !== 3 || parts[2] !== "capture") {
        continue;
      }
      const settings = cell.settings;
      if (settings === undefined) {
        continue;
      }
      const fieldPath = `${cellId}.settings`;
      yield* assertPlainSettingsObject(settings, fieldPath);
      if (cell.catalog === "capture:file" && typeof settings === "object" && settings !== null) {
        yield* assertOptionalString(
          (settings as Record<string, unknown>).path,
          `${fieldPath}.path`
        );
      }
    }
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
      if (!(cell.catalog ?? cellId).startsWith("sink:")) {
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

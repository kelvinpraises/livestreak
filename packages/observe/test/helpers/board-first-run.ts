import { Effect } from "effect";
import type { LiveStreakError } from "@livestreak/core";
import { buildControlCatalog } from "#run/control/index.js";
import { createControlBus } from "#run/control/bus/index.js";
import { createObserveControlSurfaces } from "#run/control/surfaces.js";
import {
  systemConfigConfigureScope,
  type SystemConfigConfigurePayload
} from "#run/control/system/config.js";
import {
  prepareObserveRun,
  startObserveRun,
  type ObserveRun,
  type ObserveRunKernelOptions,
  type ObserveRunResult
} from "#run/kernel.js";
import { makeObserveRun, type ObserveRunConfig } from "#run/run.js";

export type { SystemConfigConfigurePayload };

export const defaultFileExportConfigure = (
  overrides: Partial<SystemConfigConfigurePayload> = {}
): SystemConfigConfigurePayload => ({
  chain: "eip155:31337",
  capture: "file",
  process: null,
  publish: "file-export",
  ...overrides
});

export const defaultFileLocalConfigure = (
  overrides: Partial<SystemConfigConfigurePayload> = {}
): SystemConfigConfigurePayload => ({
  chain: "eip155:31337",
  capture: "file",
  process: null,
  publish: "local",
  ...overrides
});

/** Apply system:config.configure on a fresh T0 board before kernel prepare. */
export const configureObserveBoard = (
  run: ObserveRun,
  payload: SystemConfigConfigurePayload
): Effect.Effect<ObserveRun, LiveStreakError> =>
  Effect.gen(function* () {
    const bus = yield* createControlBus({
      runId: run.config.runId,
      board: run.board,
      catalog: buildControlCatalog(),
      surfaces: createObserveControlSurfaces()
    });

    yield* bus.callFunction({
      callId: `configure-${run.config.runId}`,
      runId: run.config.runId,
      scope: systemConfigConfigureScope,
      payload
    });

    return {
      ...run,
      board: yield* bus.readBoard()
    };
  });

/** Board-first prepare: configure pipeline cells, then mount drivers via prepareObserveRun. */
export const prepareObserveRunBoardFirst = (
  config: ObserveRunConfig,
  configure: SystemConfigConfigurePayload,
  options: ObserveRunKernelOptions = {}
): Effect.Effect<ObserveRun, LiveStreakError> =>
  Effect.gen(function* () {
    const run = yield* makeObserveRun(config);
    const configured = yield* configureObserveBoard(run, configure);
    return yield* prepareObserveRun(
      {
        ...configured,
        config,
        manifest: run.manifest,
        prepared: false
      },
      options
    );
  });

export const startObserveRunBoardFirst = (
  config: ObserveRunConfig,
  configure: SystemConfigConfigurePayload,
  options: ObserveRunKernelOptions = {}
): Effect.Effect<ObserveRunResult, LiveStreakError> =>
  Effect.gen(function* () {
    const prepared = yield* prepareObserveRunBoardFirst(config, configure, options);
    return yield* startObserveRun(prepared, options);
  });

import { Effect } from "effect";
import type { LiveStreakError } from "@livestreak/core";
import type { PackageRuntimeInit } from "@livestreak/schema";
import { buildControlCatalog } from "./control/index.js";
import { createControlBus } from "./control/bus/index.js";
import {
  createObserveControlSurfaces,
  type CreateObserveControlSurfacesInput
} from "./control/surfaces.js";
import {
  systemConfigConfigureScope,
  type SystemConfigConfigurePayload
} from "./control/system/config.js";
import {
  prepareObserveRun,
  startObserveRun,
  type ObserveRunKernelOptions,
  type ObserveRunResult
} from "./kernel.js";
import { makeObserveRun, type ObserveRun, type ObserveRunConfig } from "./run.js";

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

/** Mount a T0 control bus (system:config only) without kernel prepareRun. */
export const mountObserveT0Bus = (
  run: ObserveRun,
  input: CreateObserveControlSurfacesInput = {}
): Effect.Effect<ObserveRun, LiveStreakError> =>
  Effect.gen(function* () {
    const bus = yield* createControlBus({
      runId: run.config.runId,
      board: run.board,
      catalog: buildControlCatalog(),
      surfaces: createObserveControlSurfaces(input)
    });

    return {
      ...run,
      bus,
      board: yield* bus.readBoard()
    };
  });

/** Apply system:config.configure on a fresh T0 board before kernel prepare. */
export const configureObserveBoard = (
  run: ObserveRun,
  payload: SystemConfigConfigurePayload,
  input: CreateObserveControlSurfacesInput = {}
): Effect.Effect<ObserveRun, LiveStreakError> =>
  Effect.gen(function* () {
    const mounted = yield* mountObserveT0Bus(run, input);

    yield* mounted.bus!.callFunction({
      callId: `configure-${run.config.runId}`,
      runId: run.config.runId,
      scope: systemConfigConfigureScope,
      payload
    });

    return {
      ...mounted,
      board: yield* mounted.bus!.readBoard()
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
    const configured = yield* configureObserveBoard(run, configure, {
      sessionInit: options.sessionInit
    });
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

export type { CreateObserveControlSurfacesInput, PackageRuntimeInit };

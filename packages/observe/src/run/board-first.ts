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
  observationPublishKindPatch,
  readObservationIndex,
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

/** Headless board-first configure: observation birth (title + chain) plus the pipeline kinds
 *  the caller wants — kinds land on the family's cells, never in the configure call. */
export interface BoardFirstConfigure {
  readonly title: string;
  readonly chain: string;
  readonly capture: string;
  readonly publish: string;
}

export const defaultFileExportConfigure = (
  overrides: Partial<BoardFirstConfigure> = {}
): BoardFirstConfigure => ({
  title: "Observation",
  chain: "eip155:31337",
  capture: "file",
  publish: "file-export",
  ...overrides
});

export const defaultFileLiveConfigure = (
  overrides: Partial<BoardFirstConfigure> = {}
): BoardFirstConfigure => ({
  title: "Observation",
  chain: "eip155:31337",
  capture: "file",
  publish: "live",
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

    // The board owns the session cell (surfaces only provide functions), so session-level
    // truth lands as a mount patch: the chains this session can settle an observation on.
    // Today that is exactly the gateway wallet's chain; when per-observation wallets land,
    // this list grows and the console's chain select follows with no other change.
    const sessionChain = input.sessionInit?.chain;
    if (typeof sessionChain === "string" && sessionChain.length > 0) {
      yield* bus.applyBoardPatch({
        cells: { "system:config": { readonly: { set: { chains: [sessionChain] } } } }
      });
    }

    return {
      ...run,
      bus,
      board: yield* bus.readBoard()
    };
  });

/** Create the observation on a fresh T0 board before kernel prepare: configure saves
 *  title + chain and mounts the family; a non-default publish kind flips the family's
 *  publish cell in a follow-up patch (board = state, kinds live on cells). */
export const configureObserveBoard = (
  run: ObserveRun,
  payload: BoardFirstConfigure,
  input: CreateObserveControlSurfacesInput = {}
): Effect.Effect<ObserveRun, LiveStreakError> =>
  Effect.gen(function* () {
    const mounted = yield* mountObserveT0Bus(run, input);
    const before = readObservationIndex(yield* mounted.bus!.readBoard());

    yield* mounted.bus!.callFunction({
      callId: `configure-${run.config.runId}`,
      runId: run.config.runId,
      scope: systemConfigConfigureScope,
      payload: { title: payload.title, chain: payload.chain }
    });

    const after = readObservationIndex(yield* mounted.bus!.readBoard());
    const obsId = Object.keys(after).find((id) => before[id] === undefined);
    if (obsId !== undefined && payload.publish !== "live") {
      yield* mounted.bus!.applyBoardPatch(observationPublishKindPatch(obsId, payload.publish));
    }

    return {
      ...mounted,
      board: yield* mounted.bus!.readBoard()
    };
  });

/** Board-first prepare: configure pipeline cells, then mount drivers via prepareObserveRun. */
export const prepareObserveRunBoardFirst = (
  config: ObserveRunConfig,
  configure: BoardFirstConfigure,
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
  configure: BoardFirstConfigure,
  options: ObserveRunKernelOptions = {}
): Effect.Effect<ObserveRunResult, LiveStreakError> =>
  Effect.gen(function* () {
    const prepared = yield* prepareObserveRunBoardFirst(config, configure, options);
    return yield* startObserveRun(prepared, options);
  });

export type { CreateObserveControlSurfacesInput, PackageRuntimeInit };

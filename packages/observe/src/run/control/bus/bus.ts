import { Effect } from "effect";
import { LiveStreakConfigError, LiveStreakRuntimeError, type LiveStreakError } from "@livestreak/core";
import type { Board } from "#run/control/board/index.js";
import { boardSettingsChanged } from "#run/control/board/index.js";
import { validateBoardSettings } from "#run/control/board/index.js";
import { findCatalogFunctionByScope } from "#run/control/catalog.js";
import type { ControlCatalog } from "#run/control/catalog.js";
import { applyBoardPatch } from "#run/control/board/index.js";
import type { BoardPatch } from "#run/control/bus/types.js";
import type { ControlArtifact, ControlCallResult } from "#run/control/bus/calls.js";
import { createOpaqueArtifactId } from "./artifacts.js";
import { mergeBoardCellOnSurfaceMount } from "./mount.js";
import {
  buildSurfaceFunctionIndex,
  findSurfaceFunctionByScope,
  mountSurfaceRegistry
} from "./registry.js";
import {
  createArtifactSubscriptionRegistry,
  createBoardSubscriptionRegistry
} from "./subscriptions.js";
import type {
  ControlBus,
  ControlFunctionResult,
  ControlSurface,
  CreateControlBusInput
} from "./types.js";

export const createControlBus = (
  input: CreateControlBusInput
): Effect.Effect<ControlBus, LiveStreakConfigError> =>
  Effect.gen(function* () {
    const runId = input.runId;
    let surfaces: readonly ControlSurface[] = [];
    let functionIndex = yield* buildSurfaceFunctionIndex([]);
    let board = input.board;
    const catalog = input.catalog;
    const artifacts = new Map<string, ControlArtifact>();
    const boardSubscriptions = createBoardSubscriptionRegistry();
    const artifactSubscriptions = createArtifactSubscriptionRegistry();
    let wakeWorker = input.wakeWorker ?? (() => Effect.void);

    const initialSurfaces = input.surfaces ?? [];

    if (initialSurfaces.length > 0) {
      yield* buildSurfaceFunctionIndex(initialSurfaces);
    }

    for (const surface of initialSurfaces) {
      surfaces = yield* mountSurfaceRegistry(surfaces, surface);
      const mergeResult = mergeBoardCellOnSurfaceMount(board, surface.cell);
      board = mergeResult.board;
    }

    functionIndex = yield* buildSurfaceFunctionIndex(surfaces);

    const applyPatch = (
      patch: BoardPatch
    ): Effect.Effect<{ readonly board: Board; readonly changed: boolean }, LiveStreakError> =>
      Effect.gen(function* () {
        const result = yield* applyBoardPatch(board, patch);
        board = result.board;

        if (result.changed) {
          boardSubscriptions.notify(board);
          yield* wakeWorker();
        }

        return result;
      });

    const commitBoardInternal = (
      nextBoard: Board,
      validateSettings: boolean
    ): Effect.Effect<Board, LiveStreakConfigError> =>
      Effect.gen(function* () {
        const changed = nextBoard.revision > board.revision;
        if (!changed) {
          return board;
        }

        if (validateSettings && boardSettingsChanged(board, nextBoard)) {
          yield* validateBoardSettings(nextBoard);
        }

        board = nextBoard;

        boardSubscriptions.notify(board);
        yield* wakeWorker();

        return board;
      });

    const storeArtifact = (draft: NonNullable<ControlFunctionResult["artifact"]>): ControlArtifact => {
      const artifact: ControlArtifact = {
        id: createOpaqueArtifactId(),
        kind: draft.kind,
        ownerCell: draft.ownerCell,
        function: draft.function,
        createdAtMs: draft.createdAtMs,
        ...(draft.expiresAtMs === undefined ? {} : { expiresAtMs: draft.expiresAtMs }),
        payload: draft.payload
      };

      artifacts.set(artifact.id, artifact);
      artifactSubscriptions.notify(artifact);
      return artifact;
    };

    const bus: ControlBus = {
      readPanel: (options) =>
        Effect.succeed({
          board,
          ...(options?.includeCatalog === true ? { catalog } : {})
        }),

      readBoard: () => Effect.succeed(board),

      readCatalog: () => Effect.succeed(catalog),

      getArtifact: (id) => Effect.succeed(artifacts.get(id)),

      subscribeBoard: (listener) =>
        Effect.sync(() => boardSubscriptions.subscribe(listener)),

      subscribeArtifacts: (listener) =>
        Effect.sync(() => artifactSubscriptions.subscribe(listener)),

      mountSurface: (surface) =>
        Effect.gen(function* () {
          surfaces = yield* mountSurfaceRegistry(surfaces, surface);
          functionIndex = yield* buildSurfaceFunctionIndex(surfaces);

          const mergeResult = mergeBoardCellOnSurfaceMount(board, surface.cell);
          board = mergeResult.board;

          if (mergeResult.changed) {
            boardSubscriptions.notify(board);
          }
        }),

      applyBoardPatch: (patch) => applyPatch(patch),

      commitBoard: (nextBoard) => commitBoardInternal(nextBoard, true),

      registerWakeWorker: (wake) =>
        Effect.sync(() => {
          wakeWorker = wake;
        }),

      callFunction: (envelope) =>
        Effect.gen(function* () {
          if (envelope.runId !== runId) {
            return yield* Effect.fail(
              new LiveStreakConfigError({
                message: `Control call runId ${envelope.runId} does not match bus runId ${runId}`
              })
            );
          }

          const catalogFunction = findCatalogFunctionByScope(catalog, envelope.scope);
          if (catalogFunction === undefined) {
            return yield* Effect.fail(
              new LiveStreakConfigError({
                message: `Catalog does not advertise function scope ${envelope.scope}`
              })
            );
          }

          const match = yield* findSurfaceFunctionByScope(functionIndex, envelope.scope);
          const result = yield* match.entry.call(envelope, {
            boardRevision: board.revision,
            board
          });

          let artifact: ControlArtifact | undefined;
          let artifactId: string | undefined;

          if (result.artifact !== undefined) {
            artifact = storeArtifact(result.artifact);
            artifactId = artifact.id;
          }

          let changed = false;
          let boardPatch: BoardPatch | undefined;

          if (result.boardPatch !== undefined) {
            boardPatch = result.boardPatch;
            const patchResult = yield* applyPatch(result.boardPatch);
            changed = patchResult.changed;
          }

          return {
            callId: envelope.callId,
            runId,
            scope: envelope.scope,
            boardRevision: board.revision,
            changed,
            ...(artifactId === undefined ? {} : { artifactId }),
            ...(artifact === undefined ? {} : { artifact }),
            ...(boardPatch === undefined ? {} : { boardPatch })
          } satisfies ControlCallResult;
        })
    };

    return bus;
  });

export const assertCatalogFunctionAdvertised = (
  catalog: ControlCatalog,
  scope: string
): Effect.Effect<void, LiveStreakConfigError> =>
  findCatalogFunctionByScope(catalog, scope) === undefined
    ? Effect.fail(
        new LiveStreakConfigError({
          message: `Catalog does not advertise function scope ${scope}`
        })
      )
    : Effect.void;

export const failUnsupportedFunction = (scope: string): Effect.Effect<never, LiveStreakRuntimeError> =>
  Effect.fail(
    new LiveStreakRuntimeError({
      message: `Unsupported function scope: ${scope}`
    })
  );

export const stageCellSurface = (
  definition: import("./types.js").ControlCellDefinition
): ControlSurface => ({
  cell: definition,
  functions: []
});

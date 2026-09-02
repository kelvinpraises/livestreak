import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { buildControlCatalog, findCatalogFunctionByScope } from "#run/control/index.js";
import { createControlBus } from "#run/control/bus/index.js";
import {
  createInitialBoard,
  setBoardRunStatus,
  type BoardCellStatus
} from "#run/control/board/index.js";
import { applyWorkerSnapshotToBoard } from "#run/control/board/index.js";
import {
  createSystemPauseSurface,
  systemPauseSetPresentationScope
} from "#run/control/index.js";
import { createSystemRunSurface, systemRunStopScope } from "#run/control/index.js";
import {
  defaultControlPause,
  defaultControlRun,
  pausePresentationValues
} from "#run/control/board/index.js";
import { projectWorkerControlView } from "#run/control/board/index.js";
import { browserCaptureClearCropScope } from "#pipeline/capture/browser/control/controls.js";
import { browserCaptureInspectTargetsScope } from "#pipeline/capture/browser/control/preview.js";
import { createBrowserCaptureDriver } from "#pipeline/capture/browser/index.js";
import { makeFakeBrowserCaptureAdapter } from "#test/helpers/browser-adapter.js";
import { createBrowserBoardFixture } from "#test/helpers/board.js";

const testRunId = "run_bus";
const opaqueArtifactIdPattern = /^art_[0-9a-f-]{36}$/i;

const testBoard = createBrowserBoardFixture(testRunId, {
  url: "https://example.com",
  captureFps: 30,
  viewport: { width: 640, height: 480 },
  crop: { x: 0, y: 0, width: 640, height: 480 },
  encoding: "jpeg"
});

describe("control bus", () => {
  it("derives catalog from registry with capture:browser scopes", () => {
    const catalog = buildControlCatalog();
    const inspect = findCatalogFunctionByScope(catalog, browserCaptureInspectTargetsScope);

    expect(inspect?.scope).toBe("capture:browser:inspectTargets");
    expect(catalog.cells["capture:browser"]?.registryKind).toBe("capture");
    expect(catalog.cells["capture:browser"]?.registryId).toBe("browser");
  });

  it("exposes whilePaused enum in system:pause:setPresentation catalog input", () => {
    const catalog = buildControlCatalog();
    const setPresentation = findCatalogFunctionByScope(catalog, systemPauseSetPresentationScope);

    expect(setPresentation?.input?.type).toBe("object");
    const properties = setPresentation?.input?.properties ?? [];
    const whilePaused = properties.find((entry) => entry.name === "whilePaused");
    const mode = properties.find((entry) => entry.name === "mode");
    const fill = properties.find((entry) => entry.name === "fill");

    expect(whilePaused?.value.type).toBe("enum");
    expect(
      whilePaused?.value.type === "enum" ? whilePaused.value.values : []
    ).toEqual([...pausePresentationValues]);
    expect(mode).toBeUndefined();
    expect(fill).toBeUndefined();
  });

  it("does not advertise system:memory:setBudget in catalog", () => {
    const catalog = buildControlCatalog();
    expect(catalog.cells["system:memory"]?.functions.setBudget).toBeUndefined();
    expect(Object.keys(catalog.cells["system:memory"]?.functions ?? {})).toEqual([]);
  });

  it("system:tick catalog has no public functions", () => {
    const catalog = buildControlCatalog();
    expect(Object.keys(catalog.cells["system:tick"]?.functions ?? {})).toEqual([]);
  });

  it("fails cleanly for unknown function scope", async () => {
    const bus = await Effect.runPromise(
      createControlBus({
        runId: testRunId,
        board: testBoard,
        catalog: buildControlCatalog(),
        surfaces: [createSystemPauseSurface()]
      })
    );

    const exit = await Effect.runPromiseExit(
      bus.callFunction({
        callId: "call_missing",
        runId: "run_bus",
        scope: "capture:browser:missing"
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("Catalog does not advertise function scope");
    }
  });

  it("fails on duplicate live surface function scope at construction", async () => {
    const surface = createSystemPauseSurface();
    const exit = await Effect.runPromiseExit(
      createControlBus({
        runId: testRunId,
        board: testBoard,
        catalog: buildControlCatalog(),
        surfaces: [surface, surface]
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("Duplicate live surface function scope");
      expect(exit.cause.toString()).toContain("LiveStreakConfigError");
    }
  });

  it("replaces an existing surface when remounting the same cell id", async () => {
    const bus = await Effect.runPromise(
      createControlBus({
        runId: testRunId,
        board: testBoard,
        catalog: buildControlCatalog(),
        surfaces: [createSystemPauseSurface()]
      })
    );

    const exit = await Effect.runPromiseExit(bus.mountSurface(createSystemPauseSurface()));

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("fails when catalog advertises a scope but no live surface owns it", async () => {
    const bus = await Effect.runPromise(
      createControlBus({
        runId: testRunId,
        board: testBoard,
        catalog: buildControlCatalog(),
        surfaces: [createSystemPauseSurface()]
      })
    );

    const exit = await Effect.runPromiseExit(
      bus.callFunction({
        callId: "call_no_surface",
        runId: "run_bus",
        scope: browserCaptureInspectTargetsScope
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("No live surface advertises function scope");
    }
  });

  it("routes read-only preview through bus to browser surface without board revision change", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const adapter = makeFakeBrowserCaptureAdapter({
            frameBytes: new Uint8Array([255, 216, 255, 217]),
            targets: []
          });
          const driver = createBrowserCaptureDriver(adapter);
          const config = yield* driver.validate({
            url: "https://example.com/preview",
            captureFps: 30,
            viewport: { width: 640, height: 480 },
            maxFrames: 1
          });
          const source = yield* driver.create(config);
          if (source.control === undefined) {
            return yield* Effect.fail(new Error("expected browser control surface"));
          }

          const bus = yield* createControlBus({
            runId: testRunId,
            board: testBoard,
            catalog: buildControlCatalog(),
            surfaces: [source.control]
          });

          return yield* bus.callFunction({
            callId: "call_preview",
            runId: "run_bus",
            scope: browserCaptureInspectTargetsScope
          });
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.changed).toBe(false);
      expect(exit.value.boardRevision).toBe(1);
      expect(exit.value.artifact?.id).toMatch(opaqueArtifactIdPattern);
      expect(exit.value.artifact?.ownerCell).toBe("capture:browser");
    }
  });

  it("getArtifact returns a stored artifact by id", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const adapter = makeFakeBrowserCaptureAdapter({
            frameBytes: new Uint8Array([255, 216, 255, 217]),
            targets: []
          });
          const driver = createBrowserCaptureDriver(adapter);
          const config = yield* driver.validate({
            url: "https://example.com/preview",
            captureFps: 30,
            viewport: { width: 640, height: 480 },
            maxFrames: 1
          });
          const source = yield* driver.create(config);
          if (source.control === undefined) {
            return yield* Effect.fail(new Error("expected browser control surface"));
          }

          const bus = yield* createControlBus({
            runId: testRunId,
            board: testBoard,
            catalog: buildControlCatalog(),
            surfaces: [source.control]
          });

          const result = yield* bus.callFunction({
            callId: "call_preview",
            runId: "run_bus",
            scope: browserCaptureInspectTargetsScope
          });

          const artifactId = result.artifactId;
          if (artifactId === undefined) {
            return yield* Effect.fail(new Error("expected artifact id"));
          }

          const stored = yield* bus.getArtifact(artifactId);
          return { result, stored };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.stored).toEqual(exit.value.result.artifact);
    }
  });

  it("subscribeArtifacts fires when an artifact is stored", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const adapter = makeFakeBrowserCaptureAdapter({
            frameBytes: new Uint8Array([255, 216, 255, 217]),
            targets: []
          });
          const driver = createBrowserCaptureDriver(adapter);
          const config = yield* driver.validate({
            url: "https://example.com/preview",
            captureFps: 30,
            viewport: { width: 640, height: 480 },
            maxFrames: 1
          });
          const source = yield* driver.create(config);
          if (source.control === undefined) {
            return yield* Effect.fail(new Error("expected browser control surface"));
          }

          const bus = yield* createControlBus({
            runId: testRunId,
            board: testBoard,
            catalog: buildControlCatalog(),
            surfaces: [source.control]
          });

          const seen: string[] = [];
          const subscription = yield* bus.subscribeArtifacts((artifact) => {
            seen.push(artifact.id);
          });

          yield* bus.callFunction({
            callId: "call_preview",
            runId: "run_bus",
            scope: browserCaptureInspectTargetsScope
          });

          yield* subscription.unsubscribe();
          return seen;
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(1);
      expect(exit.value[0]).toMatch(opaqueArtifactIdPattern);
    }
  });

  it("applies mutating clearCrop patch and bumps revision", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const adapter = makeFakeBrowserCaptureAdapter({
            frameBytes: new Uint8Array([255, 216, 255, 217])
          });
          const driver = createBrowserCaptureDriver(adapter);
          const config = yield* driver.validate({
            url: "https://example.com/preview",
            captureFps: 30,
            viewport: { width: 640, height: 480 },
            maxFrames: 1
          });
          const source = yield* driver.create(config);
          if (source.control === undefined) {
            return yield* Effect.fail(new Error("expected browser control surface"));
          }

          const bus = yield* createControlBus({
            runId: testRunId,
            board: testBoard,
            catalog: buildControlCatalog(),
            surfaces: [source.control]
          });

          return yield* bus.callFunction({
            callId: "call_clear",
            runId: "run_bus",
            scope: browserCaptureClearCropScope
          });
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.changed).toBe(true);
      expect(exit.value.boardRevision).toBe(2);
    }
  });

  it("applies partial system:pause:setPresentation updates", async () => {
    const bus = await Effect.runPromise(
      createControlBus({
        runId: testRunId,
        board: testBoard,
        catalog: buildControlCatalog(),
        surfaces: [createSystemPauseSurface()]
      })
    );

    const result = await Effect.runPromise(
      bus.callFunction({
        callId: "call_set_presentation",
        runId: "run_bus",
        scope: systemPauseSetPresentationScope,
        payload: { whilePaused: "slate", slateAssetId: "asset1" }
      })
    );

    expect(result.changed).toBe(true);
    const board = await Effect.runPromise(bus.readBoard());
    expect(board.cells["system:pause"]?.settings).toMatchObject({
      requested: defaultControlPause.requested,
      whilePaused: "slate",
      slateAssetId: "asset1"
    });
  });

  it("rejects legacy system:pause:setPresentation mode field", async () => {
    const bus = await Effect.runPromise(
      createControlBus({
        runId: testRunId,
        board: testBoard,
        catalog: buildControlCatalog(),
        surfaces: [createSystemPauseSurface()]
      })
    );

    const exit = await Effect.runPromiseExit(
      bus.callFunction({
        callId: "call_bad_mode",
        runId: testRunId,
        scope: systemPauseSetPresentationScope,
        payload: { mode: "stop-source" }
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("system:pause:setPresentation mode is no longer supported");
    }
  });

  it("rejects invalid system:pause:setPresentation whilePaused", async () => {
    const bus = await Effect.runPromise(
      createControlBus({
        runId: testRunId,
        board: testBoard,
        catalog: buildControlCatalog(),
        surfaces: [createSystemPauseSurface()]
      })
    );

    const exit = await Effect.runPromiseExit(
      bus.callFunction({
        callId: "call_bad_while_paused",
        runId: testRunId,
        scope: systemPauseSetPresentationScope,
        payload: { whilePaused: "gap" }
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain(
        "system:pause:setPresentation whilePaused must be one of:"
      );
    }
  });

  it("system:pause:setPresentation structural no-op does not bump revision", async () => {
    const bus = await Effect.runPromise(
      createControlBus({
        runId: testRunId,
        board: testBoard,
        catalog: buildControlCatalog(),
        surfaces: [createSystemPauseSurface()]
      })
    );

    const result = await Effect.runPromise(
      bus.callFunction({
        callId: "call_set_presentation_noop",
        runId: "run_bus",
        scope: systemPauseSetPresentationScope,
        payload: {
          whilePaused: defaultControlPause.whilePaused
        }
      })
    );

    expect(result.changed).toBe(false);
    expect(result.boardRevision).toBe(1);
  });

  it("system:pause:setPresentation stores slateAssetId with slate whilePaused", async () => {
    const bus = await Effect.runPromise(
      createControlBus({
        runId: testRunId,
        board: testBoard,
        catalog: buildControlCatalog(),
        surfaces: [createSystemPauseSurface()]
      })
    );

    await Effect.runPromise(
      bus.callFunction({
        callId: "call_set_slate",
        runId: testRunId,
        scope: systemPauseSetPresentationScope,
        payload: { whilePaused: "slate", slateAssetId: "asset1" }
      })
    );

    const board = await Effect.runPromise(bus.readBoard());
    expect(board.cells["system:pause"]?.settings).toMatchObject({
      whilePaused: "slate",
      slateAssetId: "asset1"
    });
    expect(projectWorkerControlView(board).pause.slateAssetId).toBe("asset1");
  });

  it("system:pause:setPresentation removes stale slateAssetId when whilePaused changes to hold", async () => {
    const wakeCalls: string[] = [];
    const slateBoard = {
      ...testBoard,
      cells: {
        ...testBoard.cells,
        "system:pause": {
          ...testBoard.cells["system:pause"],
          settings: {
            ...testBoard.cells["system:pause"].settings,
            whilePaused: "slate",
            slateAssetId: "asset1"
          }
        }
      }
    };

    const bus = await Effect.runPromise(
      createControlBus({
        runId: testRunId,
        board: slateBoard,
        catalog: buildControlCatalog(),
        surfaces: [createSystemPauseSurface()],
        wakeWorker: () =>
          Effect.sync(() => {
            wakeCalls.push("wake");
          })
      })
    );

    const holdResult = await Effect.runPromise(
      bus.callFunction({
        callId: "call_set_hold",
        runId: testRunId,
        scope: systemPauseSetPresentationScope,
        payload: { whilePaused: "hold" }
      })
    );
    const holdBoard = await Effect.runPromise(bus.readBoard());

    expect(holdResult.changed).toBe(true);
    expect(holdResult.boardRevision).toBe(2);
    expect(holdBoard.cells["system:pause"]?.settings?.whilePaused).toBe("hold");
    expect(holdBoard.cells["system:pause"]?.settings?.slateAssetId).toBeUndefined();
    expect(projectWorkerControlView(holdBoard).pause.slateAssetId).toBeUndefined();
    expect(wakeCalls).toEqual(["wake"]);

    const repeatHold = await Effect.runPromise(
      bus.callFunction({
        callId: "call_repeat_hold",
        runId: testRunId,
        scope: systemPauseSetPresentationScope,
        payload: { whilePaused: "hold" }
      })
    );

    expect(repeatHold.changed).toBe(false);
    expect(repeatHold.boardRevision).toBe(2);
    expect(wakeCalls).toEqual(["wake"]);
  });

  it("system:pause:setPresentation cleans stale slateAssetId even when whilePaused is already hold", async () => {
    const staleBoard = {
      ...testBoard,
      cells: {
        ...testBoard.cells,
        "system:pause": {
          ...testBoard.cells["system:pause"],
          settings: {
            ...testBoard.cells["system:pause"].settings,
            whilePaused: "hold",
            slateAssetId: "asset1"
          }
        }
      }
    };

    const bus = await Effect.runPromise(
      createControlBus({
        runId: testRunId,
        board: staleBoard,
        catalog: buildControlCatalog(),
        surfaces: [createSystemPauseSurface()]
      })
    );

    const result = await Effect.runPromise(
      bus.callFunction({
        callId: "call_clean_stale_slate",
        runId: testRunId,
        scope: systemPauseSetPresentationScope,
        payload: { whilePaused: "hold" }
      })
    );
    const board = await Effect.runPromise(bus.readBoard());

    expect(result.changed).toBe(true);
    expect(board.cells["system:pause"]?.settings?.slateAssetId).toBeUndefined();
    expect(projectWorkerControlView(board).pause.slateAssetId).toBeUndefined();
  });

  it("rejects system:pause:setPresentation while pause is active", async () => {
    const pausedBoard = {
      ...testBoard,
      cells: {
        ...testBoard.cells,
        "system:pause": {
          ...testBoard.cells["system:pause"],
          settings: {
            ...testBoard.cells["system:pause"].settings,
            requested: true
          }
        }
      }
    };

    const bus = await Effect.runPromise(
      createControlBus({
        runId: testRunId,
        board: pausedBoard,
        catalog: buildControlCatalog(),
        surfaces: [createSystemPauseSurface()]
      })
    );

    const exit = await Effect.runPromiseExit(
      bus.callFunction({
        callId: "call_set_presentation_while_paused",
        runId: testRunId,
        scope: systemPauseSetPresentationScope,
        payload: { whilePaused: "slate", slateAssetId: "asset1" }
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain(
        "system:pause:setPresentation cannot change presentation while pause is active"
      );
    }
  });

  it("rejects system:pause:setPresentation slate without slateAssetId", async () => {
    const bus = await Effect.runPromise(
      createControlBus({
        runId: testRunId,
        board: testBoard,
        catalog: buildControlCatalog(),
        surfaces: [createSystemPauseSurface()]
      })
    );

    const exit = await Effect.runPromiseExit(
      bus.callFunction({
        callId: "call_slate_without_asset",
        runId: testRunId,
        scope: systemPauseSetPresentationScope,
        payload: { whilePaused: "slate" }
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain(
        'system:pause:setPresentation requires slateAssetId when whilePaused is "slate"'
      );
    }
  });

  it("rejects system:pause:setPresentation hold with slateAssetId", async () => {
    const bus = await Effect.runPromise(
      createControlBus({
        runId: testRunId,
        board: testBoard,
        catalog: buildControlCatalog(),
        surfaces: [createSystemPauseSurface()]
      })
    );

    const exit = await Effect.runPromiseExit(
      bus.callFunction({
        callId: "call_hold_with_slate_asset",
        runId: testRunId,
        scope: systemPauseSetPresentationScope,
        payload: { whilePaused: "hold", slateAssetId: "asset1" }
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain(
        'system:pause:setPresentation cannot set slateAssetId unless whilePaused is "slate"'
      );
    }
  });

  it("rejects system:pause:setPresentation slateAssetId when resolved presentation is hold", async () => {
    const bus = await Effect.runPromise(
      createControlBus({
        runId: testRunId,
        board: testBoard,
        catalog: buildControlCatalog(),
        surfaces: [createSystemPauseSurface()]
      })
    );

    const exit = await Effect.runPromiseExit(
      bus.callFunction({
        callId: "call_slate_asset_on_hold",
        runId: testRunId,
        scope: systemPauseSetPresentationScope,
        payload: { slateAssetId: "asset1" }
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain(
        'system:pause:setPresentation cannot set slateAssetId unless whilePaused is "slate"'
      );
    }
  });

  it("calls wakeWorker on board change but not for artifact-only or no-op patches", async () => {
    const wakeCalls: string[] = [];
    const wakeWorker = () =>
      Effect.sync(() => {
        wakeCalls.push("wake");
      });

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const adapter = makeFakeBrowserCaptureAdapter({
            frameBytes: new Uint8Array([255, 216, 255, 217]),
            targets: []
          });
          const driver = createBrowserCaptureDriver(adapter);
          const config = yield* driver.validate({
            url: "https://example.com/preview",
            captureFps: 30,
            viewport: { width: 640, height: 480 },
            maxFrames: 1
          });
          const source = yield* driver.create(config);
          if (source.control === undefined) {
            return yield* Effect.fail(new Error("expected browser control surface"));
          }

          const bus = yield* createControlBus({
            runId: testRunId,
            board: testBoard,
            catalog: buildControlCatalog(),
            surfaces: [source.control, createSystemPauseSurface()],
            wakeWorker
          });

          yield* bus.callFunction({
            callId: "call_preview",
            runId: "run_bus",
            scope: browserCaptureInspectTargetsScope
          });

          yield* bus.callFunction({
            callId: "call_set_presentation_noop",
            runId: "run_bus",
            scope: systemPauseSetPresentationScope,
            payload: {
              whilePaused: defaultControlPause.whilePaused
            }
          });

          yield* bus.callFunction({
            callId: "call_pause",
            runId: "run_bus",
            scope: "system:pause:pause"
          });

          return wakeCalls;
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual(["wake"]);
    }
  });

  it("ignores stale full-board commits so worker snapshots cannot erase newer bus patches", async () => {
    const bus = await Effect.runPromise(
      createControlBus({
        runId: testRunId,
        board: setBoardRunStatus(testBoard, "running", "worker is active", 100),
        catalog: buildControlCatalog(),
        surfaces: [createSystemRunSurface()]
      })
    );

    const staleBoard = await Effect.runPromise(bus.readBoard());

    await Effect.runPromise(
      bus.callFunction({
        callId: "call_stop_before_stale_commit",
        runId: testRunId,
        scope: systemRunStopScope,
        payload: { reason: "operator request" }
      })
    );
    const stoppedBoard = await Effect.runPromise(bus.readBoard());

    const staleWorkerCommit = applyWorkerSnapshotToBoard(staleBoard, {
      runId: testRunId,
      lifecycle: "running",
      controlRevision: staleBoard.revision,
      trackDepths: {},
      capture: {
        descriptorId: "browser",
        sourceType: "browser",
        exhausted: false,
        eosAppended: false,
        health: {
          stage: "capture",
          descriptorId: "browser",
          sourceId: "capture:browser",
          status: "running",
          updatedAtMs: 101,
          frameCount: 1,
          droppedFrames: 0
        }
      },
      sinks: {}
    });

    await Effect.runPromise(bus.commitBoard(staleWorkerCommit));
    const board = await Effect.runPromise(bus.readBoard());

    expect(board.revision).toBe(stoppedBoard.revision);
    expect(board.cells["system:run"]?.settings?.stopRequested).toBe(true);
    expect(board.cells["system:run"]?.settings?.stopReason).toBe("operator request");
    expect(board.cells["capture:browser"]?.readonly).toEqual(
      stoppedBoard.cells["capture:browser"]?.readonly
    );
  });

  it("notifies board subscribers on change", async () => {
    const bus = await Effect.runPromise(
      createControlBus({
        runId: testRunId,
        board: testBoard,
        catalog: buildControlCatalog(),
        surfaces: [createSystemPauseSurface()]
      })
    );

    const seen: number[] = [];
    const subscription = await Effect.runPromise(
      bus.subscribeBoard((board) => {
        seen.push(board.revision);
      })
    );

    await Effect.runPromise(
      bus.callFunction({
        callId: "call_pause",
        runId: "run_bus",
        scope: "system:pause:pause"
      })
    );

    await Effect.runPromise(subscription.unsubscribe());
    expect(seen).toContain(2);
  });

  it("rejects callFunction when envelope runId differs from bus runId", async () => {
    const bus = await Effect.runPromise(
      createControlBus({
        runId: testRunId,
        board: testBoard,
        catalog: buildControlCatalog(),
        surfaces: [createSystemPauseSurface()]
      })
    );

    const exit = await Effect.runPromiseExit(
      bus.callFunction({
        callId: "call_wrong_run",
        runId: "run_other",
        scope: "system:pause:pause"
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("LiveStreakConfigError");
      expect(exit.cause.toString()).toContain("does not match bus runId");
    }
  });

  it("returns the bus runId on successful calls", async () => {
    const bus = await Effect.runPromise(
      createControlBus({
        runId: testRunId,
        board: testBoard,
        catalog: buildControlCatalog(),
        surfaces: [createSystemPauseSurface()]
      })
    );

    const result = await Effect.runPromise(
      bus.callFunction({
        callId: "call_pause",
        runId: testRunId,
        scope: "system:pause:pause"
      })
    );

    expect(result.runId).toBe(testRunId);
  });

  it("keeps independent board revisions across buses bound to different runIds", async () => {
    const boardB = createBrowserBoardFixture("run_other");

    const busA = await Effect.runPromise(
      createControlBus({
        runId: testRunId,
        board: testBoard,
        catalog: buildControlCatalog(),
        surfaces: [createSystemPauseSurface()]
      })
    );
    const busB = await Effect.runPromise(
      createControlBus({
        runId: "run_other",
        board: boardB,
        catalog: buildControlCatalog(),
        surfaces: [createSystemPauseSurface()]
      })
    );

    await Effect.runPromise(
      busA.callFunction({
        callId: "call_pause_a",
        runId: testRunId,
        scope: "system:pause:pause"
      })
    );
    await Effect.runPromise(
      busB.callFunction({
        callId: "call_pause_b",
        runId: "run_other",
        scope: "system:pause:pause"
      })
    );

    const finalA = await Effect.runPromise(busA.readBoard());
    const finalB = await Effect.runPromise(busB.readBoard());
    expect(finalA.revision).toBe(2);
    expect(finalB.revision).toBe(2);
  });

  it("keeps independent artifact maps across buses", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const adapter = makeFakeBrowserCaptureAdapter({
            frameBytes: new Uint8Array([255, 216, 255, 217]),
            targets: []
          });
          const driver = createBrowserCaptureDriver(adapter);
          const config = yield* driver.validate({
            url: "https://example.com/preview",
            captureFps: 30,
            viewport: { width: 640, height: 480 },
            maxFrames: 1
          });
          const source = yield* driver.create(config);
          if (source.control === undefined) {
            return yield* Effect.fail(new Error("expected browser control surface"));
          }

          const boardB = createInitialBoard({
            runId: "run_artifacts_b"
          });

          const busA = yield* createControlBus({
            runId: testRunId,
            board: testBoard,
            catalog: buildControlCatalog(),
            surfaces: [source.control]
          });
          const busB = yield* createControlBus({
            runId: "run_artifacts_b",
            board: boardB,
            catalog: buildControlCatalog(),
            surfaces: [source.control]
          });

          const resultA = yield* busA.callFunction({
            callId: "call_preview_a",
            runId: testRunId,
            scope: browserCaptureInspectTargetsScope
          });

          const artifactId = resultA.artifactId;
          if (artifactId === undefined) {
            return yield* Effect.fail(new Error("expected artifact id"));
          }

          const fromA = yield* busA.getArtifact(artifactId);
          const fromB = yield* busB.getArtifact(artifactId);
          return { fromA, fromB };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.fromA).toBeDefined();
      expect(exit.value.fromB).toBeUndefined();
    }
  });

  it("assigns distinct UUID-backed artifact ids per stored artifact", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const adapter = makeFakeBrowserCaptureAdapter({
            frameBytes: new Uint8Array([255, 216, 255, 217]),
            targets: []
          });
          const driver = createBrowserCaptureDriver(adapter);
          const config = yield* driver.validate({
            url: "https://example.com/preview",
            captureFps: 30,
            viewport: { width: 640, height: 480 },
            maxFrames: 1
          });
          const source = yield* driver.create(config);
          if (source.control === undefined) {
            return yield* Effect.fail(new Error("expected browser control surface"));
          }

          const bus = yield* createControlBus({
            runId: testRunId,
            board: testBoard,
            catalog: buildControlCatalog(),
            surfaces: [source.control]
          });

          const first = yield* bus.callFunction({
            callId: "call_preview_a",
            runId: testRunId,
            scope: browserCaptureInspectTargetsScope
          });
          const second = yield* bus.callFunction({
            callId: "call_preview_b",
            runId: testRunId,
            scope: browserCaptureInspectTargetsScope
          });

          return { first, second };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const firstId = exit.value.first.artifact?.id;
      const secondId = exit.value.second.artifact?.id;
      expect(firstId).toMatch(opaqueArtifactIdPattern);
      expect(secondId).toMatch(opaqueArtifactIdPattern);
      expect(firstId).not.toBe(secondId);
    }
  });

  it("exposes system:run:stop with JSON schema input", () => {
    const catalog = buildControlCatalog();
    const stop = findCatalogFunctionByScope(catalog, systemRunStopScope);

    expect(stop?.input?.type).toBe("object");
    const reason = stop?.input?.properties?.find((entry) => entry.name === "reason");
    expect(reason?.value.type).toBe("string");
    expect(catalog.cells["system:run"]?.registryKind).toBe("system");
  });

  it("system:run:stop returns patch result and updates cells on first call", async () => {
    const wakeCalls: string[] = [];
    const baseRunCell = testBoard.cells["system:run"];
    const runningBoard = {
      ...testBoard,
      cells: {
        ...testBoard.cells,
        "system:run": {
          ...baseRunCell,
          status: ["running", baseRunCell.status[1], Date.now()] as BoardCellStatus,
          settings: { ...defaultControlRun }
        }
      }
    };
    const bus = await Effect.runPromise(
      createControlBus({
        runId: testRunId,
        board: runningBoard,
        catalog: buildControlCatalog(),
        surfaces: [createSystemRunSurface()],
        wakeWorker: () =>
          Effect.sync(() => {
            wakeCalls.push("wake");
          })
      })
    );

    const result = await Effect.runPromise(
      bus.callFunction({
        callId: "call_stop",
        runId: testRunId,
        scope: systemRunStopScope,
        payload: { reason: "operator request" }
      })
    );
    const board = await Effect.runPromise(bus.readBoard());

    expect(result.changed).toBe(true);
    expect(result.boardRevision).toBe(2);
    expect(board.cells["system:run"]?.settings?.stopRequested).toBe(true);
    expect(board.cells["system:run"]?.settings?.stopReason).toBe("operator request");
    expect(board.cells["system:run"]?.status[0]).toBe("running");
    expect(wakeCalls).toEqual(["wake"]);
  });

  it("system:run:stop repeat is a structural no-op", async () => {
    const wakeCalls: string[] = [];
    const baseRunCell = testBoard.cells["system:run"];
    const runningBoard = {
      ...testBoard,
      cells: {
        ...testBoard.cells,
        "system:run": {
          ...baseRunCell,
          status: ["running", baseRunCell.status[1], Date.now()] as BoardCellStatus,
          settings: { ...defaultControlRun }
        }
      }
    };
    const bus = await Effect.runPromise(
      createControlBus({
        runId: testRunId,
        board: runningBoard,
        catalog: buildControlCatalog(),
        surfaces: [createSystemRunSurface()],
        wakeWorker: () =>
          Effect.sync(() => {
            wakeCalls.push("wake");
          })
      })
    );

    await Effect.runPromise(
      bus.callFunction({
        callId: "call_stop_first",
        runId: testRunId,
        scope: systemRunStopScope
      })
    );

    const repeat = await Effect.runPromise(
      bus.callFunction({
        callId: "call_stop_repeat",
        runId: testRunId,
        scope: systemRunStopScope,
        payload: { reason: "ignored on repeat" }
      })
    );

    expect(repeat.changed).toBe(false);
    expect(repeat.boardRevision).toBe(2);
    expect(wakeCalls).toEqual(["wake"]);
  });

  it("rejects invalid system:run:stop payload types", async () => {
    const bus = await Effect.runPromise(
      createControlBus({
        runId: testRunId,
        board: testBoard,
        catalog: buildControlCatalog(),
        surfaces: [createSystemRunSurface()]
      })
    );

    const nonObjectExit = await Effect.runPromiseExit(
      bus.callFunction({
        callId: "call_stop_bad_payload",
        runId: testRunId,
        scope: systemRunStopScope,
        payload: "stop"
      })
    );
    expect(Exit.isFailure(nonObjectExit)).toBe(true);
    if (Exit.isFailure(nonObjectExit)) {
      expect(nonObjectExit.cause.toString()).toContain("system:run:stop payload must be an object");
    }

    const badReasonTypeExit = await Effect.runPromiseExit(
      bus.callFunction({
        callId: "call_stop_bad_reason",
        runId: testRunId,
        scope: systemRunStopScope,
        payload: { reason: 123 }
      })
    );
    expect(Exit.isFailure(badReasonTypeExit)).toBe(true);
    if (Exit.isFailure(badReasonTypeExit)) {
      expect(badReasonTypeExit.cause.toString()).toContain("system:run:stop reason must be a string");
    }

    const badReasonExit = await Effect.runPromiseExit(
      bus.callFunction({
        callId: "call_stop_empty_reason",
        runId: testRunId,
        scope: systemRunStopScope,
        payload: { reason: " ".repeat(3) }
      })
    );
    expect(Exit.isFailure(badReasonExit)).toBe(true);
    if (Exit.isFailure(badReasonExit)) {
      expect(badReasonExit.cause.toString()).toContain("system:run:stop reason must be a non-empty string");
    }
  });
});

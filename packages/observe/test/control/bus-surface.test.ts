import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { buildControlCatalog } from "#run/control/index.js";
import { createControlBus, stageCellSurface } from "#run/control/bus/index.js";
import { createInitialBoard } from "#run/control/board/index.js";
import { createSystemConfigSurface } from "#run/control/system/config.js";
import { createSystemPauseSurface } from "#run/control/index.js";
import { createSystemRunSurface } from "#run/control/index.js";
import { browserCaptureClearCropScope } from "#pipeline/capture/browser/control/controls.js";
import { browserCaptureInspectTargetsScope } from "#pipeline/capture/browser/control/preview.js";
import { createBrowserCaptureDriver } from "#pipeline/capture/browser/index.js";
import { makeFakeBrowserCaptureAdapter } from "#test/helpers/browser-adapter.js";
import { createBrowserBoardFixture } from "#test/helpers/board.js";
import { createFakeControlCaptureDriver } from "#test/helpers/fake-control-capture.js";
import { prepareObserveRun } from "#index.js";
import { makeObserveRunSync } from "#test/helpers/observe-run.js";
import { browserCaptureRunConfig } from "#test/helpers/run-config.js";
import { createBrowserRuntimeKernelOptions } from "#test/helpers/browser-runtime.js";
import type { ControlSurface } from "#run/control/bus/index.js";

describe("control bus surfaces", () => {
  it("mountSurface inserts a missing Board cell", async () => {
    const board = createInitialBoard({ runId: "run_mount_insert" });
    const driver = createFakeControlCaptureDriver();
    const cell = await Effect.runPromise(
      driver.describeControl({}, { runId: "run_mount_insert" })
    );

    const bus = await Effect.runPromise(
      createControlBus({
        runId: "run_mount_insert",
        board,
        catalog: buildControlCatalog(),
        surfaces: [createSystemPauseSurface()]
      })
    );

    expect(board.cells["capture:fake-control"]).toBeUndefined();

    await Effect.runPromise(bus.mountSurface(stageCellSurface(cell)));

    const mounted = await Effect.runPromise(bus.readBoard());
    expect(mounted.cells["capture:fake-control"]?.label).toBe("Fake Control Capture");
    expect(mounted.cells["capture:fake-control"]?.functions).toEqual(["ping"]);
  });

  it("remounting the same cell preserves settings, readonly, refs, and status", async () => {
    const board = createBrowserBoardFixture("run_mount_remount");
    const bus = await Effect.runPromise(
      createControlBus({
        runId: "run_mount_remount",
        board,
        catalog: buildControlCatalog(),
        surfaces: [createSystemPauseSurface()]
      })
    );

    const originalBoard = await Effect.runPromise(bus.readBoard());
    const original = originalBoard.cells["capture:browser"];
    const replacement = {
      id: "capture:browser" as const,
      cell: {
        ...original,
        label: "Browser Capture Remounted",
        settings: { url: "https://should-not-replace.example" },
        readonly: { sourceType: "browser", sourceMode: "live", replaced: true },
        status: ["failed", "broken", Date.now()] as const,
        functions: [...original.functions, "futureFn"]
      }
    };

    await Effect.runPromise(bus.mountSurface(stageCellSurface(replacement)));

    const remountedBoard = await Effect.runPromise(bus.readBoard());
    const remounted = remountedBoard.cells["capture:browser"];
    expect(remounted.label).toBe("Browser Capture Remounted");
    expect(remounted.settings).toEqual(original.settings);
    expect(remounted.readonly).toEqual(original.readonly);
    expect(remounted.status).toEqual(original.status);
    expect(remounted.functions).toEqual(replacement.cell.functions);
    expect(remountedBoard.revision).toBeGreaterThan(originalBoard.revision);
  });

  it("does not bump Board revision when remounting identical cell metadata", async () => {
    const board = createBrowserBoardFixture("run_mount_noop");
    const originalCell = board.cells["capture:browser"];
    const bus = await Effect.runPromise(
      createControlBus({
        runId: "run_mount_noop",
        board,
        catalog: buildControlCatalog(),
        surfaces: [createSystemPauseSurface()]
      })
    );

    const boardBeforeNoopRemount = await Effect.runPromise(bus.readBoard());
    const revisionBefore = boardBeforeNoopRemount.revision;
    let notifyCount = 0;
    await Effect.runPromise(
      bus.subscribeBoard(() => {
        notifyCount += 1;
      })
    );

    await Effect.runPromise(
      bus.mountSurface(
        stageCellSurface({
          id: "capture:browser",
          cell: {
            label: originalCell.label,
            catalog: originalCell.catalog,
            status: originalCell.status,
            functions: [...originalCell.functions]
          }
        })
      )
    );

    const after = await Effect.runPromise(bus.readBoard());
    expect(after.revision).toBe(revisionBefore);
    expect(notifyCount).toBe(0);
  });

  it("bumps Board revision and notifies subscribers when cell metadata changes", async () => {
    const board = createBrowserBoardFixture("run_mount_changed");
    const bus = await Effect.runPromise(
      createControlBus({
        runId: "run_mount_changed",
        board,
        catalog: buildControlCatalog(),
        surfaces: [createSystemPauseSurface()]
      })
    );

    const boardBeforeChangedRemount = await Effect.runPromise(bus.readBoard());
    const revisionBefore = boardBeforeChangedRemount.revision;
    const notifications: number[] = [];
    await Effect.runPromise(
      bus.subscribeBoard((nextBoard) => {
        notifications.push(nextBoard.revision);
      })
    );

    await Effect.runPromise(
      bus.mountSurface(
        stageCellSurface({
          id: "capture:browser",
          cell: {
            label: "Browser Capture Updated",
            catalog: "capture:browser",
            status: board.cells["capture:browser"].status,
            functions: [...board.cells["capture:browser"].functions, "futureFn"]
          }
        })
      )
    );

    const after = await Effect.runPromise(bus.readBoard());
    expect(after.revision).toBeGreaterThan(revisionBefore);
    expect(after.cells["capture:browser"]?.label).toBe("Browser Capture Updated");
    expect(notifications).toEqual([after.revision]);
  });

  it("replaces live handlers without Board revision churn on identical metadata", async () => {
    const board = createBrowserBoardFixture("run_handler_replace");
    const browserCell = board.cells["capture:browser"];
    const cellDefinition = {
      id: "capture:browser" as const,
      cell: {
        label: browserCell.label,
        catalog: browserCell.catalog,
        status: browserCell.status,
        functions: [...browserCell.functions]
      }
    };

    const handlerSurface = (handlerVersion: number): ControlSurface => ({
      cell: cellDefinition,
      functions: [
        {
          name: "clearCrop",
          scope: browserCaptureClearCropScope,
          call: () =>
            Effect.succeed({
              boardPatch: {
                cells: {
                  "capture:browser": {
                    settings: {
                      set: { handlerVersion }
                    }
                  }
                }
              }
            })
        }
      ]
    });

    const bus = await Effect.runPromise(
      createControlBus({
        runId: "run_handler_replace",
        board,
        catalog: buildControlCatalog(),
        surfaces: [handlerSurface(1)]
      })
    );

    const boardBeforeHandlerRemount = await Effect.runPromise(bus.readBoard());
    const revisionBeforeRemount = boardBeforeHandlerRemount.revision;

    await Effect.runPromise(bus.mountSurface(handlerSurface(2)));

    const boardAfterHandlerRemount = await Effect.runPromise(bus.readBoard());
    const revisionAfterRemount = boardAfterHandlerRemount.revision;
    expect(revisionAfterRemount).toBe(revisionBeforeRemount);

    const result = await Effect.runPromise(
      bus.callFunction({
        callId: "call_handler_replace",
        runId: "run_handler_replace",
        scope: browserCaptureClearCropScope
      })
    );

    expect(result.changed).toBe(true);
    const afterCall = await Effect.runPromise(bus.readBoard());
    expect(afterCall.cells["capture:browser"]?.settings?.handlerVersion).toBe(2);
  });

  it("createControlBus inserts missing cells from initial surfaces", async () => {
    const board = createInitialBoard({ runId: "run_initial_insert" });
    const driver = createFakeControlCaptureDriver();
    const cell = await Effect.runPromise(
      driver.describeControl({}, { runId: "run_initial_insert" })
    );

    const bus = await Effect.runPromise(
      createControlBus({
        runId: "run_initial_insert",
        board,
        catalog: buildControlCatalog(),
        surfaces: [createSystemPauseSurface(), createSystemRunSurface(), stageCellSurface(cell)]
      })
    );

    const mounted = await Effect.runPromise(bus.readBoard());
    expect(mounted.cells["capture:fake-control"]?.label).toBe("Fake Control Capture");
    expect(mounted.cells["capture:fake-control"]?.functions).toEqual(["ping"]);
    expect(mounted.revision).toBeGreaterThan(board.revision);
  });

  it("createControlBus does not churn revision when initial surface cells already match", async () => {
    const board = createInitialBoard({ runId: "run_initial_match" });

    const bus = await Effect.runPromise(
      createControlBus({
        runId: "run_initial_match",
        board,
        catalog: buildControlCatalog(),
        surfaces: [createSystemConfigSurface()]
      })
    );

    const mounted = await Effect.runPromise(bus.readBoard());
    expect(mounted.revision).toBe(board.revision);
  });

  it("rejects duplicate function scopes across different live surfaces", async () => {
    const exit = await Effect.runPromiseExit(
      createControlBus({
        runId: "run_duplicate_scope",
        board: createInitialBoard({ runId: "run_duplicate_scope" }),
        catalog: buildControlCatalog(),
        surfaces: [createSystemPauseSurface(), createSystemPauseSurface()]
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("Duplicate live surface function scope");
    }
  });

  it("fails cleanly when catalog advertises a scope without a live surface", async () => {
    const bus = await Effect.runPromise(
      createControlBus({
        runId: "run_missing_live_surface",
        board: createBrowserBoardFixture("run_missing_live_surface"),
        catalog: buildControlCatalog(),
        surfaces: [createSystemPauseSurface()]
      })
    );

    const exit = await Effect.runPromiseExit(
      bus.callFunction({
        callId: "call_preview_before_live",
        runId: "run_missing_live_surface",
        scope: browserCaptureInspectTargetsScope
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("No live surface advertises function scope");
    }
  });

  it("live surface calls can return artifacts through the bus", async () => {
    const adapter = makeFakeBrowserCaptureAdapter({
      frameBytes: new Uint8Array([255, 216, 255, 217]),
      targets: []
    });
    const driver = createBrowserCaptureDriver(adapter);
    const config = await Effect.runPromise(
      driver.validate({
        url: "https://example.com/live-surface",
        captureFps: 30,
        maxFrames: 1
      })
    );
    const source = await Effect.runPromise(Effect.scoped(driver.create(config)));
    if (source.control === undefined) {
      throw new Error("expected browser control surface");
    }

    const bus = await Effect.runPromise(
      createControlBus({
        runId: "run_live_artifact",
        board: createBrowserBoardFixture("run_live_artifact"),
        catalog: buildControlCatalog(),
        surfaces: [source.control]
      })
    );

    const result = await Effect.runPromise(
      bus.callFunction({
        callId: "call_live_preview",
        runId: "run_live_artifact",
        scope: browserCaptureInspectTargetsScope
      })
    );

    expect(result.artifactId).toBeDefined();
  });
});

describe("stage-owned board cells", () => {
  it("makeObserveRun creates only system:config at T0", () => {
    const run = makeObserveRunSync(
      browserCaptureRunConfig(
        "run_system_only",
        { url: "https://example.com", captureFps: 30 },
        { path: "/tmp/out.mp4" }
      )
    );

    expect(new Set(Object.keys(run.board.cells))).toEqual(new Set(["system:config"]));
    expect(run.board.cells["system:config"]?.readonly?.runId).toBe("run_system_only");
  });

  it("prepareObserveRun mounts capture and sink cells from describeControl", async () => {
    const { options } = createBrowserRuntimeKernelOptions(4);
    const run = makeObserveRunSync({
      runId: "run_prepare_mount",
      capture: {
        driverId: "browser",
        config: {
          url: "https://example.com",
          captureFps: 30,
          viewport: { width: 640, height: 480 },
          maxFrames: 4
        }
      },
      sink: {
        driverId: "memory",
        instanceId: "memory-sink",
        config: { path: "/tmp/out-prepare.mp4" }
      },
       
      process: null
    });

    const prepared = await Effect.runPromise(prepareObserveRun(run, options));
    const board = prepared.board;

    expect(board.cells["capture:browser"]).toBeDefined();
    expect(board.cells["sink:memory-sink"]).toBeDefined();
    expect(board.cells["capture:browser"]?.functions.length).toBeGreaterThan(0);
  });
});

describe("generic runtime control surfaces", () => {
  it("prepareObserveRun mounts fake capture cell without kernel knowing driver id", async () => {
    const driver = createFakeControlCaptureDriver();
    const run = makeObserveRunSync({
      runId: "run_fake_control",
      capture: { driverId: "fake-control", config: {} },
      sink: {
        driverId: "memory",
        config: { path: "/tmp/out-fake.mp4" }
      },
       
      process: null
    });

    const prepared = await Effect.runPromise(
      prepareObserveRun(run, {
        captureDriver: driver,
        sinkDriver: createBrowserRuntimeKernelOptions(1).options.sinkDriver
      })
    );

    expect(prepared.board.cells["capture:fake-control"]).toBeDefined();
    expect(prepared.board.cells["capture:fake-control"]?.functions).toEqual(["ping"]);
  });
});

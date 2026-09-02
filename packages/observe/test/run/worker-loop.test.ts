 
import { Effect, Exit, Fiber, Stream } from "effect";
import { describe, expect, it } from "vitest";
import {
  createSyntheticCaptureDriver,
  defaultSyntheticCaptureConfig
} from "#pipeline/capture/synthetic/driver.js";
import type { CaptureDriver } from "#pipeline/capture/index.js";
import type { SinkAttachment, SinkFinalizeResult, SinkStageHealth } from "#pipeline/publish/index.js";
import { buildControlCatalog } from "#run/control/index.js";
import type { ControlBus } from "#run/control/bus/index.js";
import { createControlBus } from "#run/control/bus/index.js";
import type { Board } from "#run/control/board/index.js";
import { createSystemRunSurface, systemRunStopScope } from "#run/control/index.js";
import {
  defaultControlPause,
  defaultControlRun,
  validateBoardSettings
} from "#run/control/board/index.js";
import { projectWorkerControlView } from "#run/control/board/index.js";
import { validateWorkerPrepare } from "#run/worker/prepare.js";
import { systemMemoryBoardCell, systemTickBoardCell } from "#test/helpers/board.js";
import {
  createEmptyWorkerState,
  createPassthroughVideoManifest,
  type SinkStageState
} from "#run/worker/state.js";
import { runScopedWorkerUntilStoppedWithBoard } from "#run/worker/worker.js";
import { createWorkerBoardWake } from "#run/worker/wake.js";

describe("worker loop", () => {
  it("runs synthetic capture through passthrough manifest into an in-memory sink", async () => {
    const frameCount = 4;
    const driver = createSyntheticCaptureDriver();
    const captureConfig = {
      ...defaultSyntheticCaptureConfig,
      frameCount
    };

    const validatedConfig = await Effect.runPromise(driver.validate(captureConfig));
    const delivered: number[] = [];
    const sinkId = "memory-test";
    const runId = "run_test_4a";
    const manifest = createPassthroughVideoManifest();
    const board = createRunningBoard(runId, sinkId);
    const bus = await Effect.runPromise(createControlBus({ runId, board, catalog: buildControlCatalog() }));

    await Effect.runPromise(validateBoardSettings(board));

    const result = await Effect.runPromise(
      runWorkerInCaptureScope(driver, validatedConfig, {
        runId,
        manifest,
        sinks: createMemorySinkRecord(sinkId, delivered),
        bus
      })
    );

    const finalBoard = await Effect.runPromise(bus.readBoard());

    expect(result.outcome).toBe("stopped");
    expect(result.snapshot.lifecycle).toBe("stopped");
    expect(finalBoard.cells["system:run"]?.status[0]).toBe("stopped");
    expect(finalBoard.revision).toBeGreaterThan(board.revision);
    expect(result.snapshot.capture?.eosAppended).toBe(true);
    expect(result.snapshot.capture?.exhausted).toBe(true);
    expect(result.snapshot.capture?.descriptorId).toBe("synthetic");
    expect(result.snapshot.capture?.sourceType).toBe("synthetic");
    expect(result.snapshot.capture?.health).toMatchObject({
      stage: "capture",
      descriptorId: "synthetic",
      sourceId: "capture:synthetic",
      frameCount: frameCount
    });
    expect(result.snapshot.trackDepths["capture.video.raw"]).toBe(frameCount + 1);
    expect(delivered).toHaveLength(frameCount);
    expect(result.snapshot.sinks[sinkId]?.deliveredItems).toBe(frameCount);
    expect(result.snapshot.sinks[sinkId]?.finalized).toBe(true);
    expect(result.snapshot.sinks[sinkId]?.finalizeResult?.output?.kind).toBe("memory");
  });

  it("releases capture resources when the scoped worker run exits", async () => {
    const releaseEvents: string[] = [];
    const driver = createScopeTrackingCaptureDriver(releaseEvents);
    const captureConfig = {
      ...defaultSyntheticCaptureConfig,
      frameCount: 2
    };
    const validatedConfig = await Effect.runPromise(driver.validate(captureConfig));
    const delivered: number[] = [];
    const sinkId = "memory-test";
    const runId = "run_test_capture_scope";
    const bus = await Effect.runPromise(
      createControlBus({
        runId,
        board: createRunningBoard(runId, sinkId),
        catalog: buildControlCatalog()
      })
    );

    await Effect.runPromise(
      runWorkerInCaptureScope(driver, validatedConfig, {
        runId,
        manifest: createPassthroughVideoManifest(),
        sinks: createMemorySinkRecord(sinkId, delivered),
        bus
      })
    );

    expect(releaseEvents).toEqual(["capture-released"]);
  });

  it("fails prepare when a sink subscribes to an unknown manifest track", async () => {
    const runId = "run_test_invalid_manifest";
    const manifest = createPassthroughVideoManifest();
    const sinks = createMemorySinkRecord("memory-test", []);
    const board = createRunningBoard(runId, "memory-test", ["publish.video.unknown"]);
    const workerState = createEmptyWorkerState({
      runId,
      manifest,
      sinks
    });

    await expect(
      Effect.runPromise(validateWorkerPrepare(workerState, projectWorkerControlView(board)))
    ).rejects.toMatchObject({
      message: expect.stringContaining("unknown manifest track publish.video.unknown")
    });
  });

  it("returns max-turns-exceeded when the loop cannot finish in time", async () => {
    const frameCount = 8;
    const driver = createSyntheticCaptureDriver();
    const captureConfig = {
      ...defaultSyntheticCaptureConfig,
      frameCount
    };

    const validatedConfig = await Effect.runPromise(driver.validate(captureConfig));
    const delivered: number[] = [];
    const sinkId = "memory-test";
    const runId = "run_test_max_turns";
    const bus = await Effect.runPromise(
      createControlBus({
        runId,
        board: createRunningBoard(runId, sinkId),
        catalog: buildControlCatalog()
      })
    );

    const result = await Effect.runPromise(
      runWorkerInCaptureScope(driver, validatedConfig, {
        runId,
        manifest: createPassthroughVideoManifest(),
        sinks: createMemorySinkRecord(sinkId, delivered),
        bus,
        maxTurns: 2
      })
    );

    expect(result.outcome).toBe("max-turns-exceeded");
    expect(result.snapshot.lifecycle).toBe("failed");
    expect(result.snapshot.error).toContain("maxTurns");
  });

  it("stops from Board stop request before natural eos", async () => {
    const frameCount = 128;
    const driver = createYieldingSyntheticCaptureDriver();
    const captureConfig = {
      ...defaultSyntheticCaptureConfig,
      frameCount
    };

    const validatedConfig = await Effect.runPromise(driver.validate(captureConfig));
    const delivered: number[] = [];
    const sinkId = "memory-test";
    const runId = "run_test_stop_request";

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const bus = yield* createControlBus({
            runId,
            board: createRunningBoard(runId, sinkId),
            catalog: buildControlCatalog(),
            surfaces: [createSystemRunSurface()]
          });
          const boardWake = yield* createWorkerBoardWake();
          yield* bus.registerWakeWorker(() => boardWake.notify());

          const fiber = yield* Effect.fork(
            runScopedWorkerUntilStoppedWithBoard({
              runId,
              manifest: createPassthroughVideoManifest(),
              sinks: createMemorySinkRecord(sinkId, delivered),
              bus,
              boardWake,
              maxTurns: frameCount * 64,
              prepareCapture: driver.create(validatedConfig)
            })
          );

          yield* Effect.yieldNow();

          yield* bus.callFunction({
            callId: "call_stop_worker",
            runId,
            scope: systemRunStopScope,
            payload: { reason: "worker loop test" }
          });

          const result = yield* Fiber.join(fiber);
          const finalBoard = yield* bus.readBoard();

          return { result, finalBoard, deliveredCount: delivered.length };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.result.outcome).toBe("stopped");
      expect(exit.value.result.snapshot.lifecycle).toBe("stopped");
      expect(exit.value.finalBoard.cells["system:run"]?.settings?.stopRequested).toBe(true);
      expect(exit.value.finalBoard.cells["system:run"]?.status[0]).toBe("stopped");
      expect(exit.value.deliveredCount).toBeGreaterThan(0);
      expect(exit.value.deliveredCount).toBeLessThan(frameCount);
      expect(exit.value.result.snapshot.sinks[sinkId]?.finalized).toBe(true);
    }
  });
});

// --- helpers ---

interface RunWorkerInCaptureScopeInput {
  readonly runId: string;
  readonly manifest: ReturnType<typeof createPassthroughVideoManifest>;
  readonly sinks: Record<string, SinkStageState>;
  readonly bus: ControlBus;
  readonly maxTurns?: number;
}

const runWorkerInCaptureScope = <Config>(
  driver: CaptureDriver<Config>,
  config: Config,
  input: RunWorkerInCaptureScopeInput
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const boardWake = yield* createWorkerBoardWake();
      yield* input.bus.registerWakeWorker(() => boardWake.notify());

      return yield* runScopedWorkerUntilStoppedWithBoard({
        runId: input.runId,
        manifest: input.manifest,
        sinks: input.sinks,
        bus: input.bus,
        boardWake,
        maxTurns: input.maxTurns,
        prepareCapture: driver.create(config)
      });
    })
  );

const createRunningBoard = (
  runId: string,
  sinkId: string,
  subscribe: readonly string[] = ["publish.video.rendered"]
): Board => {
  const nowMs = Date.now();

  return {
    revision: 1,
    catalogVersion: "0.1.0",
    cells: {
      "system:run": {
        label: "Run",
        catalog: "system:run",
        status: ["running", null, nowMs],
        settings: { ...defaultControlRun },
        readonly: { runId, prepared: true },
        functions: ["stop"]
      },
      "system:pause": {
        label: "Pause",
        catalog: "system:pause",
        status: ["idle", null, nowMs],
        settings: { ...defaultControlPause },
        functions: ["pause", "resume", "setPresentation"]
      },
      "system:memory": systemMemoryBoardCell(),
      "system:tick": systemTickBoardCell(),
      [`sink:${sinkId}`]: {
        label: "Test Sink",
        catalog: "sink:memory",
        status: ["idle", null, nowMs],
        settings: {
          path: "/tmp/out",
          subscribe,
          required: true
        },
        readonly: {},
        functions: []
      }
    }
  };
};

const createYieldingSyntheticCaptureDriver = (): CaptureDriver<
  typeof defaultSyntheticCaptureConfig
> => {
  const base = createSyntheticCaptureDriver();

  return {
    ...base,
    create: (config) =>
      Effect.gen(function* () {
        const source = yield* base.create(config);
        return {
          ...source,
          frames: source.frames.pipe(
            Stream.mapEffect((frame) =>
              Effect.gen(function* () {
                yield* Effect.yieldNow();
                return frame;
              })
            )
          )
        };
      })
  };
};

const createScopeTrackingCaptureDriver = (
  releaseEvents: string[]
): CaptureDriver<typeof defaultSyntheticCaptureConfig> => {
  const base = createSyntheticCaptureDriver();

  return {
    ...base,
    create: (config) =>
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            releaseEvents.push("capture-released");
          })
        );
        return yield* base.create(config);
      })
  };
};

const createMemorySinkRecord = (
  sinkId: string,
  delivered: number[]
): Record<string, SinkStageState> => ({
  [sinkId]: {
    attachment: createMemorySinkAttachment(delivered),
    finalized: false,
    deliveredItems: 0,
    drainedTracks: {}
  }
});

const createMemorySinkAttachment = (delivered: number[]): SinkAttachment => {
  const attachmentId = "memory-sink";

  return {
    id: attachmentId,
    deliver: (item) =>
      Effect.sync(() => {
        if (item.kind === "video") {
          delivered.push(item.sequence);
        }
      }),
    finalize: Effect.succeed({
      deliveredItems: delivered.length,
      output: {
        kind: "memory"
      }
    } satisfies SinkFinalizeResult),
    health: Effect.succeed({
      stage: "publish",
      descriptorId: "memory",
      status: "running",
      updatedAtMs: Date.now(),
      deliveredItems: delivered.length
    } satisfies SinkStageHealth),
    detach: Effect.void
  };
};

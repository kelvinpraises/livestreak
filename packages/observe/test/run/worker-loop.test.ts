 
import { Deferred, Effect, Exit, Fiber, Stream } from "effect";
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

// Deadline poll for actual sink delivery (see runtime.test.ts): prompt control response
// means stop-after-yield can land before the first pull completes.
// Bounded-both-sides poll: waits until some but not all frames delivered (mid-flow).
const waitForDeliveredRange = (
  count: () => number,
  low: number,
  high: number,
  timeoutMs = 10000
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const current = count();
      if (current >= low && current < high) return;
      if (Date.now() >= deadline) {
        return yield* Effect.fail(
          new Error(`timed out waiting for delivered count in [${low}, ${high}), got ${current}`)
        );
      }
      yield* Effect.yieldNow();
    }
  });

const waitForDeliveredCount = (
  count: () => number,
  timeoutMs = 10000
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (count() > 0) return;
      if (Date.now() >= deadline) {
        return yield* Effect.fail(new Error("timed out waiting for delivered frames"));
      }
      yield* Effect.yieldNow();
    }
  });
import {
  createSystemPauseSurface,
  createSystemRunSurface,
  systemPausePauseScope,
  systemPauseResumeScope,
  systemRunStopScope
} from "#run/control/index.js";
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
    // Consumed video payloads are pruned (bounded memory); the retained depth is markers only (EOS).
    expect(result.snapshot.trackDepths["capture.video.raw"]).toBe(1);
    expect(delivered).toHaveLength(frameCount);
    // Lockstep pumping never triggers the latest-frame-wins bound — recording sinks stay lossless.
    expect(result.state.tracks["capture.video.raw"]?.droppedVideoItems).toBe(0);
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

  // O1: the budget counts CONSECUTIVE no-progress (idle) turns, not raw frame
  // turns — so a long run is never killed by content length. A large synthetic
  // run (well beyond the old ~2048-frame/68s ceiling) completes even with a tiny
  // idle budget, because every producing turn resets the idle counter.
  it("completes a long run without hitting the turn budget (length-independent)", async () => {
    const frameCount = 5000;
    const driver = createSyntheticCaptureDriver();
    const captureConfig = {
      ...defaultSyntheticCaptureConfig,
      frameCount
    };

    const validatedConfig = await Effect.runPromise(driver.validate(captureConfig));
    const delivered: number[] = [];
    const sinkId = "memory-test";
    const runId = "run_test_long_run";
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
        // Tiny idle budget: would have killed even an 8-frame run under the old
        // raw-turn cap, yet a 5000-frame run still reaches `stopped`.
        maxTurns: 4
      })
    );

    expect(result.outcome).toBe("stopped");
    expect(result.snapshot.lifecycle).toBe("stopped");
    expect(delivered).toHaveLength(frameCount);
  });

  it("stops from Board stop request before natural eos", async () => {
    // Large stream: stopping at first delivery provably cuts the run short.
    const frameCount = 2048;
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

          // Wait for actual delivery before stopping: prompt control response means a bare
          // yield no longer guarantees frames slipped through first.
          yield* waitForDeliveredCount(() => delivered.length);

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

  // G19: pause and stop with queued backlog present. Frames flow, pause freezes delivery
  // mid-stream (no loss, no duplication while parked), resume drains everything in order,
  // stop lands cleanly.
  it("pause freezes backlog delivery; resume drains all in order", async () => {
    const frameCount = 2048;
    const driver = createYieldingSyntheticCaptureDriver();
    const validatedConfig = await Effect.runPromise(
      driver.validate({ ...defaultSyntheticCaptureConfig, frameCount })
    );
    const delivered: number[] = [];
    const sinkId = "memory-test";
    const runId = "run_test_pause_backlog";
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const bus = yield* createControlBus({
            runId,
            board: createRunningBoard(runId, sinkId),
            catalog: buildControlCatalog(),
            surfaces: [createSystemRunSurface(), createSystemPauseSurface()]
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
          // Catch the run mid-flow: some frames delivered, most still ahead.
          yield* waitForDeliveredRange(() => delivered.length, 1, frameCount);
          yield* bus.callFunction({
            callId: "call_pause_backlog",
            runId,
            scope: systemPausePauseScope,
            payload: { }
          });
          const frozenAt = delivered.length;
          expect(frozenAt).toBeGreaterThan(0);
          expect(frozenAt).toBeLessThan(frameCount);
          // Parked: no further delivery across a quiet window.
          yield* Effect.sleep(300);
          expect(delivered.length).toBe(frozenAt);
          yield* bus.callFunction({
            callId: "call_resume_backlog",
            runId,
            scope: systemPauseResumeScope,
            payload: { }
          });
          const result = yield* Fiber.join(fiber);
          const finalBoard = yield* bus.readBoard();
          return { result, finalBoard, delivered: [...delivered] };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.result.outcome).toBe("stopped");
      // Full count, strictly ordered, once-only (timeline markers consume track sequence
      // slots, so video sequences have gaps but never repeat or reorder).
      expect(exit.value.delivered).toHaveLength(frameCount);
      expect(new Set(exit.value.delivered).size).toBe(frameCount);
      expect([...exit.value.delivered].sort((a, z) => a - z)).toEqual(exit.value.delivered);
    }
  });

  // G19/G20: genuinely lagging subscriptions via a gate-blocked sink. The fast sink takes the
  // first frame while slow is parked at cursor 0 (distinct positions — sink deliveries are
  // awaited serially, so fast does NOT finish everything first); opening the gate lets slow
  // drain in order with matching finalized counts. A mere per-delivery delay does NOT prove
  // cursor independence — both cursors would advance together.
  it("lagging subscriptions hold distinct cursors through EOS", async () => {
    const frameCount = 8;
    const driver = createSyntheticCaptureDriver();
    const validatedConfig = await Effect.runPromise(
      driver.validate({ ...defaultSyntheticCaptureConfig, frameCount })
    );
    const fast: number[] = [];
    const slow: number[] = [];
    const runId = "run_test_lagging_sinks";
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const bus = yield* createControlBus({
            runId,
            board: createRunningBoard(runId, "sink-fast"),
            catalog: buildControlCatalog()
          });
          yield* bus.applyBoardPatch({
            cells: {
              [`sink:sink-slow`]: {
                create: {
                  label: "Slow Sink",
                  catalog: "sink:memory",
                  status: ["idle", null, Date.now()],
                  settings: { subscribe: ["publish.video.rendered"], required: true },
                  readonly: {},
                  functions: []
                }
              }
            }
          });
          const slowRecord = createMemorySinkRecord("sink-slow", slow);
          const slowAttachment = slowRecord["sink-slow"]!.attachment;
          const gateOpen = yield* Deferred.make<void>();
          const laggingAttachment = {
            ...slowAttachment,
            deliver: (item: Parameters<typeof slowAttachment.deliver>[0]) =>
              Effect.zipRight(
                Deferred.await(gateOpen),
                slowAttachment.deliver(item)
              )
          };
          const worker = yield* Effect.fork(
            runWorkerInCaptureScope(driver, validatedConfig, {
              runId,
              manifest: createPassthroughVideoManifest(),
              sinks: {
                ...createMemorySinkRecord("sink-fast", fast),
                ["sink-slow"]: { ...slowRecord["sink-slow"]!, attachment: laggingAttachment }
              },
              bus
            })
          );
          // The turn blocks in the gated sink after fast takes frame 0: genuinely distinct
          // cursor positions (fast 1, slow 0) — not a mere per-delivery delay.
          yield* waitForDeliveredCount(() => fast.length);
          expect(slow).toHaveLength(0);
          // Open the gate: slow drains the retained backlog in order, then EOS finalizes both.
          yield* Deferred.succeed(gateOpen, void 0);
          const result = yield* Fiber.join(worker);
          return { result, fast: [...fast], slow: [...slow] };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.result.outcome).toBe("stopped");
      expect(exit.value.fast).toHaveLength(frameCount);
      expect(exit.value.slow).toHaveLength(frameCount);
      expect(exit.value.slow).toEqual(exit.value.fast);
      expect(exit.value.result.snapshot.sinks["sink-fast"]?.deliveredItems).toBe(frameCount);
      expect(exit.value.result.snapshot.sinks["sink-slow"]?.deliveredItems).toBe(frameCount);
      expect(exit.value.result.snapshot.sinks["sink-slow"]?.finalized).toBe(true);
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

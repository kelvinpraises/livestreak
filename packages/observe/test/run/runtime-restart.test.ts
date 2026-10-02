import { describe, expect, it } from "vitest";
import { Deferred, Effect, Exit } from "effect";
import { createObserveRuntime } from "#index.js";
import { prepareObserveRun, startObserveRun, startObserveRunAsync } from "#run/kernel.js";
import { makeObserveRunSync } from "#test/helpers/observe-run.js";
import {
  createSyntheticCaptureDriver,
  defaultSyntheticCaptureConfig
} from "#pipeline/capture/synthetic/driver.js";
import {
  createBlockedCaptureKernelOptions,
  makeBlockedObserveRun
} from "#test/helpers/blocked-capture.js";
import { waitForBoard } from "#test/helpers/presentation-runtime.js";
import { createSyntheticKernelOptions } from "#test/helpers/runtime.js";
import { syntheticCaptureRunConfig } from "#test/helpers/run-config.js";
import { systemConfigCloseScope } from "#run/control/system/config.js";

// Regression: Stop → Start (and EOS → Start) must restart the run with a fresh worker. Previously the
// terminal handle lingered in the store (blocking the second start) and the first cycle's stopRequested
// survived on the board (insta-draining any restarted worker).
describe("ObserveRuntime restart", () => {
  it("restarts a stopped run: second start runs a fresh worker that delivers frames", async () => {
    const runId = "run_restart_after_stop";
    const { options, delivered } = createSyntheticKernelOptions(8);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(syntheticCaptureRunConfig(runId, `/tmp/${runId}.mp4`));
          yield* runtime.startRun(runId);
          const first = yield* runtime.stopRun(runId, { reason: "operator stop" });
          const deliveredAfterFirst = delivered.length;

          yield* runtime.startRun(runId);
          const second = yield* runtime.awaitRun(runId);
          const board = yield* runtime.readBoard(runId);

          return {
            first,
            second,
            deliveredAfterFirst,
            deliveredAfterSecond: delivered.length,
            board
          };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.first.outcome).toBe("stopped");
      expect(exit.value.second.outcome).toBe("stopped");
      // The restarted worker produced NEW frames — it did not inherit the first cycle's stop request.
      expect(exit.value.deliveredAfterSecond).toBeGreaterThan(exit.value.deliveredAfterFirst);
      // Start consumed the stale stop command; the second run ended by EOS, not by the old stop.
      expect(exit.value.board.cells["system:run"]?.settings?.stopRequested).toBe(false);
      expect(exit.value.board.cells["system:run"]?.settings?.stopReason).toBeUndefined();
      expect(exit.value.board.cells["system:run"]?.status[0]).toBe("stopped");
    }
  });

  it("restarts a naturally-completed run (clip EOS) without a runtime rebuild", async () => {
    const runId = "run_restart_after_eos";
    const { options, delivered } = createSyntheticKernelOptions(8);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(syntheticCaptureRunConfig(runId, `/tmp/${runId}.mp4`));

          yield* runtime.startRun(runId);
          const first = yield* runtime.awaitRun(runId);
          const deliveredAfterFirst = delivered.length;

          yield* runtime.startRun(runId);
          const second = yield* runtime.awaitRun(runId);

          return {
            first,
            second,
            deliveredAfterFirst,
            deliveredAfterSecond: delivered.length
          };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.first.outcome).toBe("stopped");
      expect(exit.value.second.outcome).toBe("stopped");
      expect(exit.value.deliveredAfterFirst).toBe(8);
      expect(exit.value.deliveredAfterSecond).toBe(16);
    }
  });

  it("still refuses a second start while the run is genuinely active", async () => {
    const runId = "run_restart_active_guard";
    const { options, counters } = createBlockedCaptureKernelOptions();

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(makeBlockedObserveRun(runId, `/tmp/${runId}.mp4`));
          yield* runtime.startRun(runId);

          yield* waitForBoard(
            () => runtime.readBoard(runId),
            () => counters.pullStarted > 0
          );

          const denied = yield* Effect.exit(runtime.startRun(runId));

          yield* runtime.stopRun(runId, { timeoutMs: 200, reason: "cleanup" });

          return { denied };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(Exit.isFailure(exit.value.denied)).toBe(true);
      if (Exit.isFailure(exit.value.denied)) {
        expect(exit.value.denied.cause.toString()).toContain(
          `Active handle for run ${runId} already exists`
        );
      }
    }
  });
});

describe("ObserveRuntime execution ownership across restart", () => {
  it("holds the lease while running, retires it on stop, and rejects stale-generation writes", async () => {
    const runId = "run_restart_lease";
    const { options } = createSyntheticKernelOptions(8);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(syntheticCaptureRunConfig(runId, `/tmp/${runId}.mp4`));
          yield* runtime.startRun(runId);
          const bus = (yield* runtime.store.requireHandle(runId)).bus;

          // Ownership is held through the run: a second reserve on the key fails.
          const held = yield* Effect.exit(bus.execution.reserve(runId));
          expect(Exit.isFailure(held)).toBe(true);

          yield* runtime.stopRun(runId, { reason: "operator stop" });

          // Cleanup retired the lease: reserving now succeeds with a fresh generation.
          const retired = yield* bus.execution.reserve(runId);
          const freshWrite = yield* Effect.exit(
            bus.commitGuardedUpdate(
              { kind: "owner", lease: { obsKey: runId, token: retired } },
              { kind: "lifecycle" },
              (current) => Effect.succeed({ ...current })
            )
          );
          expect(Exit.isSuccess(freshWrite)).toBe(true);
          yield* bus.execution.release(runId, retired);

          // Restart mints a new generation; the retired token's late write is rejected.
          yield* runtime.startRun(runId);
          const staleWrite = yield* Effect.exit(
            bus.commitGuardedUpdate(
              { kind: "owner", lease: { obsKey: runId, token: retired } },
              { kind: "lifecycle" },
              (current) => Effect.succeed({ ...current })
            )
          );
          expect(Exit.isFailure(staleWrite)).toBe(true);
          if (Exit.isFailure(staleWrite)) {
            expect(staleWrite.cause.toString()).toContain("Stale owner write");
          }
          const second = yield* runtime.awaitRun(runId);
          return { second };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.second.outcome).toBe("stopped");
    }
  });

  it("refuses a concurrent kernel start while the first execution owns the run", async () => {
    const runId = "run_restart_kernel_race";
    const { options } = createBlockedCaptureKernelOptions();

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(makeBlockedObserveRun(runId, `/tmp/${runId}.mp4`));
          const run = yield* runtime.store.require(runId);
          yield* runtime.startRun(runId);

          // Same run, still owned: a direct kernel start fails BEFORE forking a worker —
          // the kernel reserve serializes starters independently of the store reclaim guard.
          const denied = yield* Effect.exit(startObserveRunAsync({ run, options }));
          expect(Exit.isFailure(denied)).toBe(true);
          if (Exit.isFailure(denied)) {
            expect(denied.cause.toString()).toContain("already has an active execution");
          }

          const stopped = yield* runtime.stopRun(runId, { timeoutMs: 200, reason: "cleanup" });
          expect(stopped.outcome).toBe("stopped");

          // Retired: a fresh kernel start succeeds and stops cleanly.
          const second = yield* startObserveRunAsync({ run, options });
          yield* second.interrupt;
          yield* Effect.exit(second.awaitResult());
          for (let i = 0; i < 200 && !(yield* second.isDone); i += 1) {
            yield* Effect.yieldNow();
          }
          expect(yield* second.isDone).toBe(true);
          return true;
        })
      )
    );

    if (Exit.isFailure(exit)) {
      console.log("CAUSE:", String(exit.cause).slice(0, 900));
    }
    expect(Exit.isSuccess(exit)).toBe(true);
  });
});

describe("ObserveRuntime held cleanup and stale handles", () => {
  it("blocks mutation/restart/close until awaited cleanup finishes, then retires", async () => {
    const runId = "run_restart_held_cleanup";
    const base = createSyntheticKernelOptions(4);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const gate = yield* Deferred.make<void>();
          // Sink double with a gated finalize: the worker completes its frames but the
          // resource completion stays pending, visibly holding the outer lifecycle open.
          const sinkDriver = {
            ...base.options.sinkDriver!,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double wraps heterogeneous sink configs
            attach: (config: any) =>
              Effect.map(base.options.sinkDriver!.attach(config), (attachment) => ({
                ...attachment,
                finalize: Effect.zipRight(Deferred.await(gate), attachment.finalize)
              }))
          };
          const runtime = yield* createObserveRuntime({
            defaultKernelOptions: { ...base.options, sinkDriver }
          });
          yield* runtime.prepareRun(syntheticCaptureRunConfig(runId, `/tmp/${runId}.mp4`));
          yield* runtime.startRun(runId);
          const bus = (yield* runtime.store.requireHandle(runId)).bus;

          // Frames flush in milliseconds; finalize stays gated: the await must NOT resolve.
          const raced = yield* Effect.race(
            runtime
              .awaitRun(runId)
              .pipe(Effect.map(() => "completed" as const)),
            Effect.sleep("300 millis").pipe(Effect.map(() => "held" as const))
          );
          expect(raced).toBe("held");

          // Held cleanup still owns the key: reserve, close refuse.
          expect(Exit.isFailure(yield* Effect.exit(bus.execution.reserve(runId)))).toBe(true);
          const closeRefused = yield* Effect.exit(
            bus.callFunction({ callId: "close-held", runId, scope: systemConfigCloseScope })
          );
          expect(Exit.isFailure(closeRefused)).toBe(true);

          yield* Deferred.succeed(gate, void 0);
          const result = yield* runtime.awaitRun(runId);
          expect(result.outcome).toBe("stopped");
          expect(yield* bus.execution.isActive(runId)).toBe(false);

          // Retired: restart runs a fresh worker to completion.
          yield* runtime.startRun(runId);
          const second = yield* runtime.awaitRun(runId);
          expect(second.outcome).toBe("stopped");
          return true;
        })
      )
    );

    if (Exit.isFailure(exit)) {
      console.log("HELD-CAUSE:", String(exit.cause).slice(0, 900));
    }
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("a stale old handle cannot stop or write the successor generation", async () => {
    const runId = "run_restart_stale_handle";
    const { options } = createSyntheticKernelOptions(4);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(syntheticCaptureRunConfig(runId, `/tmp/${runId}.mp4`));
          const first = yield* runtime.startRun(runId);
          expect(first.execution).not.toBe(undefined);
          yield* runtime.stopRun(runId, { reason: "first stop" });

          yield* runtime.startRun(runId);
          const bus = (yield* runtime.store.requireHandle(runId)).bus;

          // Late interrupt on the retired handle is harmless.
          yield* first.interrupt;
          // A board write with the old handle's identity is rejected, not applied.
          const staleWrite = yield* Effect.exit(
            bus.commitGuardedUpdate(
              { kind: "owner", lease: first.execution! },
              { kind: "lifecycle" },
              (current) => Effect.succeed({ ...current })
            )
          );
          expect(Exit.isFailure(staleWrite)).toBe(true);

          const second = yield* runtime.awaitRun(runId);
          expect(second.outcome).toBe("stopped");
          expect(
            (yield* runtime.readBoard(runId)).cells["system:run"]?.status[0]
          ).toBe("stopped");
          return true;
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });
});

describe("ObserveRuntime terminal publication under cleanup stress", () => {
  it("worker stopped then resource cleanup failure publishes failed with the actual error", async () => {
    const runId = "run_cleanup_failure";
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const base = createSyntheticKernelOptions(4);
          const synthetic = createSyntheticCaptureDriver();
          const failingDriver = {
            ...synthetic,
            validate: () =>
              synthetic.validate({
                ...defaultSyntheticCaptureConfig,
                frameCount: 4
              }),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double wraps heterogeneous capture configs
            create: (config: any) =>
              Effect.gen(function* () {
                yield* Effect.acquireRelease(Effect.void, () =>
                  Effect.die(new Error("cleanup boom"))
                );
                return yield* synthetic.create(config);
              })
          };
          const run = makeObserveRunSync(syntheticCaptureRunConfig(runId, `/tmp/${runId}.mp4`));
          const prepared = yield* prepareObserveRun(run, {
            captureDriver: failingDriver,
            sinkDriver: base.options.sinkDriver
          });
          const result = yield* Effect.exit(
            startObserveRun(prepared, {
              captureDriver: failingDriver,
              sinkDriver: base.options.sinkDriver
            })
          );
          // The worker flushed its frames (stopped outcome), then the owned resource
          // finalizer failed: the terminal commit corrects provisional stopped to failed.
          expect(Exit.isFailure(result)).toBe(true);
          if (Exit.isFailure(result)) {
            expect(String(result.cause)).toContain("cleanup boom");
          }
          const board = yield* prepared.bus!.readBoard();
          expect(board.cells["system:run"]?.status[0]).toBe("failed");
          expect(board.cells["system:run"]?.status[1]).toContain("cleanup boom");
          return true;
        })
      )
    );
    if (Exit.isFailure(exit)) {
      console.log("CLEANUP-CAUSE:", String(exit.cause).slice(0, 900));
    }
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("forced held-startup stop publishes failed/interrupted without waiting for attach", async () => {
    const runId = "run_forced_startup";
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const base = createSyntheticKernelOptions(4);
          const gate = yield* Deferred.make<void>();
          let attachCalls = 0;
          const sinkDriver = {
            ...base.options.sinkDriver!,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double wraps heterogeneous sink configs
            attach: (config: any) =>
              Effect.gen(function* () {
                attachCalls += 1;
                yield* Deferred.await(gate);
                return yield* base.options.sinkDriver!.attach(config);
              })
          };
          const runtime = yield* createObserveRuntime({
            defaultKernelOptions: { ...base.options, sinkDriver }
          });
          yield* runtime.prepareRun(syntheticCaptureRunConfig(runId, `/tmp/${runId}.mp4`));
          yield* runtime.startRun(runId);
          // Worker stuck inside attach: forced stop publishes terminal promptly.
          const stopped = yield* runtime.stopRun(runId, { timeoutMs: 200, reason: "forced" });
          expect(stopped.outcome).toBe("interrupted");
          expect(attachCalls).toBe(1);
          const board = yield* runtime.readBoard(runId);
          expect(board.cells["system:run"]?.status[0]).toBe("failed");
          expect(yield* runtime.store
            .requireHandle(runId)
            .pipe(Effect.flatMap((handle) => handle.bus.execution.isActive(runId)))
          ).toBe(false);
          // Releasing the gate lets nothing stale through: a fresh start runs cleanly.
          yield* Deferred.succeed(gate, void 0);
          yield* runtime.startRun(runId);
          const second = yield* runtime.awaitRun(runId);
          expect(second.outcome).toBe("stopped");
          return true;
        })
      )
    );
    if (Exit.isFailure(exit)) {
      console.log("FORCED-CAUSE:", String(exit.cause).slice(0, 900));
    }
    expect(Exit.isSuccess(exit)).toBe(true);
  });
});

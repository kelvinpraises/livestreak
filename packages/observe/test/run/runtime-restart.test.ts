import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { createObserveRuntime } from "#index.js";
import {
  createBlockedCaptureKernelOptions,
  makeBlockedObserveRun
} from "#test/helpers/blocked-capture.js";
import { waitForBoard } from "#test/helpers/presentation-runtime.js";
import { createSyntheticKernelOptions } from "#test/helpers/runtime.js";
import { syntheticCaptureRunConfig } from "#test/helpers/run-config.js";

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

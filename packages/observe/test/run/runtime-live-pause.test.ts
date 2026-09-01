import { describe, expect, it } from "vitest";
import { Effect, Exit, Either } from "effect";
import {
  systemPausePauseScope,
  systemPauseResumeScope,
  systemPauseSetPresentationScope
} from "#run/control/index.js";
import { systemRunStopScope } from "#run/control/index.js";
import { createObserveRuntime } from "#run/runtime.js";
import {
  createFakeLiveRuntimeKernelOptions,
  makeFakeLiveObserveRun,
  runStatusIs,
  waitForBoard
} from "#test/helpers/fake-live-runtime.js";

describe("ObserveRuntime fake live pause", () => {
  it("runtime pause calls live source pause through the public path", async () => {
    const runId = "run_live_pause";
    const { options, getCounters } = createFakeLiveRuntimeKernelOptions(512);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(makeFakeLiveObserveRun(runId, `/tmp/${runId}.mp4`));
          yield* runtime.startRun(runId);

          yield* runtime.callFunction({
            callId: "call_live_pause",
            runId,
            scope: systemPausePauseScope
          });

          const board = yield* waitForBoard(
            () => runtime.readBoard(runId),
            (current) =>
              current.cells["system:pause"]?.settings?.requested === true &&
              runStatusIs(current, ["paused"])
          );

          return { board, counters: getCounters() };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.counters?.pauseCalls).toBe(1);
      expect(exit.value.counters?.resumeCalls).toBe(0);
      expect(exit.value.board.cells["system:pause"]?.settings?.requested).toBe(true);
      expect(exit.value.board.cells["system:run"]?.status[0]).toBe("paused");
    }
  });

  it("runtime resume calls live source resume and delivers pause-end", async () => {
    const runId = "run_live_resume";
    const { options, getCounters, recording } = createFakeLiveRuntimeKernelOptions(512);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(makeFakeLiveObserveRun(runId, `/tmp/${runId}.mp4`));
          yield* runtime.startRun(runId);

          yield* runtime.callFunction({
            callId: "call_live_pause",
            runId,
            scope: systemPausePauseScope
          });

          yield* waitForBoard(
            () => runtime.readBoard(runId),
            (current) => runStatusIs(current, ["paused"])
          );

          yield* runtime.callFunction({
            callId: "call_live_resume",
            runId,
            scope: systemPauseResumeScope
          });

          const board = yield* waitForBoard(
            () => runtime.readBoard(runId),
            (current) =>
              current.cells["system:pause"]?.settings?.requested === false &&
              runStatusIs(current, ["running", "resuming"])
          );

          yield* waitForMarkerDelivery(
            () => Effect.succeed(recording),
            (current) => current.deliveries.includes("marker:pause-end")
          );

          return { board, counters: getCounters(), recording };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.counters?.resumeCalls).toBe(1);
      expect(exit.value.recording.deliveries).toContain("marker:pause-end");
      expect(exit.value.board.cells["system:pause"]?.settings?.requested).toBe(false);
    }
  });

  it("runtime stop while paused does not call live resume", async () => {
    const runId = "run_live_stop_while_paused";
    const { options, getCounters } = createFakeLiveRuntimeKernelOptions(512);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(makeFakeLiveObserveRun(runId, `/tmp/${runId}.mp4`));
          yield* runtime.startRun(runId);

          yield* runtime.callFunction({
            callId: "call_live_pause",
            runId,
            scope: systemPausePauseScope
          });

          yield* waitForBoard(
            () => runtime.readBoard(runId),
            (current) => runStatusIs(current, ["paused"])
          );

          const resumeCallsBeforeStop = getCounters()?.resumeCalls ?? 0;

          yield* runtime.callFunction({
            callId: "call_live_stop",
            runId,
            scope: systemRunStopScope,
            payload: { reason: "stop while paused" }
          });

          const result = yield* runtime.awaitRun(runId);
          const board = yield* runtime.readBoard(runId);

          return {
            result,
            board,
            resumeCallsBeforeStop,
            resumeCallsAfterStop: getCounters()?.resumeCalls ?? 0
          };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.result.outcome).toBe("stopped");
      expect(exit.value.board.cells["system:run"]?.status[0]).toBe("stopped");
      expect(exit.value.resumeCallsAfterStop).toBe(exit.value.resumeCallsBeforeStop);
    }
  });

  it("runtime setPresentation while paused is rejected", async () => {
    const runId = "run_live_presentation_rejected";
    const { options, getCounters } = createFakeLiveRuntimeKernelOptions(512);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(makeFakeLiveObserveRun(runId, `/tmp/${runId}.mp4`));
          yield* runtime.startRun(runId);

          yield* runtime.callFunction({
            callId: "call_live_pause",
            runId,
            scope: systemPausePauseScope
          });

          yield* waitForBoard(
            () => runtime.readBoard(runId),
            (current) => runStatusIs(current, ["paused"])
          );

          expect(getCounters()?.pauseCalls).toBe(1);

          return yield* runtime.callFunction({
            callId: "call_live_set_presentation_slate",
            runId,
            scope: systemPauseSetPresentationScope,
            payload: { whilePaused: "slate", slateAssetId: "asset1" }
          }).pipe(Effect.either);
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(Either.isLeft(exit.value)).toBe(true);
      if (Either.isLeft(exit.value)) {
        expect(String(exit.value.left)).toContain(
          "system:pause:setPresentation cannot change presentation while pause is active"
        );
      }
    }
    expect(getCounters()?.pauseCalls).toBe(1);
  });
});

// --- helpers ---

const waitForMarkerDelivery = <T>(
  readRecording: () => Effect.Effect<T, unknown>,
  predicate: (recording: T) => boolean,
  attempts = 200
): Effect.Effect<T, Error> =>
  Effect.gen(function* () {
    for (let index = 0; index < attempts; index += 1) {
      const recording = yield* readRecording().pipe(Effect.mapError(toError));
      if (predicate(recording)) {
        return recording;
      }

      yield* Effect.yieldNow();
    }

    return yield* Effect.fail(new Error("Timed out waiting for marker delivery"));
  });

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

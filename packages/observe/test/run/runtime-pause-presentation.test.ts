import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { LiveStreakRuntimeError } from "@livestreak/core";
import {
  createObserveRuntime,
  projectControlPanelControls,
  systemPausePauseScope,
  systemPauseResumeScope,
  systemPauseSetPresentationScope,
  systemRunStopScope
} from "#index.js";
import {
  createPresentationRuntimeKernelOptions,
  makeFakeLiveObserveRun,
  runStatusIs,
  waitForBoard,
  waitForRecording,
  yieldWhilePaused
} from "#test/helpers/presentation-runtime.js";

describe("ObserveRuntime pause presentation", () => {
  it("reaches sink presentation hook through runtime.callFunction pause", async () => {
    const runId = "run_runtime_presentation_pause";
    const { options, recording } = createPresentationRuntimeKernelOptions({ frameCount: 512 });

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(makeFakeLiveObserveRun(runId, `/tmp/${runId}.mp4`));
          yield* runtime.startRun(runId);

          yield* waitForRecording(() => recording, (current) => current.videos.length > 0);
          const videosBeforePause = recording.videos.length;

          yield* runtime.callFunction({
            callId: "call_runtime_presentation_pause",
            runId,
            scope: systemPausePauseScope
          });

          yield* waitForBoard(
            () => runtime.readBoard(runId),
            (board) => runStatusIs(board, ["paused"])
          );

          yield* yieldWhilePaused();

          return { videosBeforePause, board: yield* runtime.readBoard(runId) };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(recording.presentationCalls).toEqual(["pause:hold"]);
      expect(recording.videos.length).toBe(exit.value.videosBeforePause);
      expect(exit.value.board.cells["system:run"]?.status[0]).toBe("paused");
    }
  });

  it("passes slate presentation through runtime pause without embedding payloads in read models", async () => {
    const runId = "run_runtime_presentation_slate";
    const { options, recording } = createPresentationRuntimeKernelOptions({ frameCount: 512 });

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(makeFakeLiveObserveRun(runId, `/tmp/${runId}.mp4`));
          yield* runtime.startRun(runId);

          yield* runtime.callFunction({
            callId: "call_runtime_set_presentation",
            runId,
            scope: systemPauseSetPresentationScope,
            payload: { whilePaused: "slate", slateAssetId: "asset1" }
          });

          yield* runtime.callFunction({
            callId: "call_runtime_slate_pause",
            runId,
            scope: systemPausePauseScope
          });

          yield* waitForBoard(
            () => runtime.readBoard(runId),
            (board) => runStatusIs(board, ["paused"])
          );

          const board = yield* runtime.readBoard(runId);
          const panel = yield* runtime.readPanel(runId, { includeCatalog: true });
          const controls = projectControlPanelControls(panel);
          const readModels = JSON.stringify({ board, panel, controls });

          yield* runtime.callFunction({
            callId: "call_runtime_slate_resume",
            runId,
            scope: systemPauseResumeScope
          });

          yield* waitForBoard(
            () => runtime.readBoard(runId),
            (board) => runStatusIs(board, ["running", "resuming"])
          );

          yield* waitForRecording(() => recording, (current) =>
            current.deliveries.includes("marker:presentation-slate")
          );

          return { readModels };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(recording.presentationCalls).toEqual(["pause:slate:asset1", "resume"]);
      expect(exit.value.readModels).not.toContain("data:image");
      expect(recording.deliveries).toContain("marker:presentation-slate");
    }
  });

  it("reaches sink resume hook once through runtime resume and ignores repeated resume", async () => {
    const runId = "run_runtime_presentation_resume";
    const { options, recording } = createPresentationRuntimeKernelOptions({ frameCount: 512 });

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(makeFakeLiveObserveRun(runId, `/tmp/${runId}.mp4`));
          yield* runtime.startRun(runId);

          yield* runtime.callFunction({
            callId: "call_runtime_resume_pause",
            runId,
            scope: systemPausePauseScope
          });

          yield* waitForBoard(
            () => runtime.readBoard(runId),
            (board) => runStatusIs(board, ["paused"])
          );

          yield* runtime.callFunction({
            callId: "call_runtime_resume",
            runId,
            scope: systemPauseResumeScope
          });

          yield* waitForBoard(
            () => runtime.readBoard(runId),
            (board) => runStatusIs(board, ["running", "resuming"])
          );

          const callsAfterResume = [...recording.presentationCalls];

          yield* runtime.callFunction({
            callId: "call_runtime_resume_noop",
            runId,
            scope: systemPauseResumeScope
          });

          yield* yieldWhilePaused();

          return { callsAfterResume };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.callsAfterResume).toEqual(["pause:hold", "resume"]);
      expect(recording.presentationCalls).toEqual(["pause:hold", "resume"]);
    }
  });

  it("does not call sink resume hook when runtime stop is requested while paused", async () => {
    const runId = "run_runtime_presentation_stop";
    const { options, recording } = createPresentationRuntimeKernelOptions({ frameCount: 512 });

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(makeFakeLiveObserveRun(runId, `/tmp/${runId}.mp4`));
          yield* runtime.startRun(runId);

          yield* runtime.callFunction({
            callId: "call_runtime_stop_pause",
            runId,
            scope: systemPausePauseScope
          });

          yield* waitForBoard(
            () => runtime.readBoard(runId),
            (board) => runStatusIs(board, ["paused"])
          );

          yield* runtime.callFunction({
            callId: "call_runtime_stop",
            runId,
            scope: systemRunStopScope,
            payload: { reason: "stop while paused" }
          });

          const result = yield* runtime.awaitRun(runId);
          const board = yield* runtime.readBoard(runId);

          return { result, board };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(recording.presentationCalls).toEqual(["pause:hold"]);
      expect(recording.presentationCalls).not.toContain("resume");
      expect(exit.value.result.outcome).toBe("stopped");
      expect(exit.value.board.cells["system:run"]?.status[0]).toBe("stopped");
    }
  });

  it("fails the run cleanly when sink presentation hook fails during runtime pause", async () => {
    const runId = "run_runtime_presentation_failure";
    const { options, recording } = createPresentationRuntimeKernelOptions({
      frameCount: 512,
      sink: {
        pausePresentation: () =>
          Effect.fail(
            new LiveStreakRuntimeError({
              message: "presentation hook failed"
            })
          )
      }
    });

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(makeFakeLiveObserveRun(runId, `/tmp/${runId}.mp4`));
          yield* runtime.startRun(runId);

          yield* runtime.callFunction({
            callId: "call_runtime_presentation_failure_pause",
            runId,
            scope: systemPausePauseScope
          });

          const result = yield* runtime.awaitRun(runId);
          const board = yield* runtime.readBoard(runId);

          return { result, board };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.result.outcome).toBe("failed");
      expect(exit.value.board.cells["system:run"]?.status[0]).toBe("failed");
      expect(exit.value.board.cells["system:run"]?.status[1]).toContain(
        "Sink presentation pause failed: presentation hook failed"
      );
      expect(exit.value.result.snapshot).toBeDefined();
      expect(exit.value.result.snapshot!.error).toContain(
        "Sink presentation pause failed: presentation hook failed"
      );
      expect(recording.presentationCalls).toEqual([]);
    }
  });
});

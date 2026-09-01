import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import {
  createCapabilityGrant,
  createObserveBridge,
  createObserveRuntime,
  systemPausePauseScope,
  systemRunStopScope,
  type BridgeCaller,
  type CapabilityScope
} from "#index.js";
import {
  createBlockedCaptureKernelOptions,
  makeBlockedObserveRun
} from "#test/helpers/blocked-capture.js";
import {
  createPresentationRuntimeKernelOptions,
  makeFakeLiveObserveRun,
  runStatusIs,
  waitForBoard
} from "#test/helpers/presentation-runtime.js";
import { createSyntheticKernelOptions } from "#test/helpers/runtime.js";
import { syntheticCaptureRunConfig } from "#test/helpers/run-config.js";

const trustedCaller: BridgeCaller = { id: "trusted-runtime-stop", trusted: true };

const callerWithScopes = (
  id: string,
  scopes: readonly CapabilityScope[]
): BridgeCaller => ({
  id,
  grants: [
    createCapabilityGrant({
      id: `${id}-grant`,
      holder: id,
      scopes
    })
  ]
});

describe("ObserveRuntime stopRun", () => {
  it("sets Board stop settings and returns a stopped result", async () => {
    const runId = "run_stop_graceful";
    const { options } = createSyntheticKernelOptions(8);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(syntheticCaptureRunConfig(runId, `/tmp/${runId}.mp4`));
          yield* runtime.startRun(runId);

          const result = yield* runtime.stopRun(runId, { reason: "operator stop" });
          const board = yield* runtime.readBoard(runId);

          return { result, board };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.result.outcome).toBe("stopped");
      expect(exit.value.result.snapshot).toBeDefined();
      expect(exit.value.board.cells["system:run"]?.status[0]).toBe("stopped");
      expect(exit.value.board.cells["system:run"]?.settings?.stopRequested).toBe(true);
      expect(exit.value.board.cells["system:run"]?.settings?.stopReason).toBe("operator stop");
    }
  });

  it("stops while paused without calling sink resume presentation", async () => {
    const runId = "run_stop_while_paused";
    const { options, recording } = createPresentationRuntimeKernelOptions({ frameCount: 512 });

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(makeFakeLiveObserveRun(runId, `/tmp/${runId}.mp4`));
          yield* runtime.startRun(runId);

          yield* runtime.callFunction({
            callId: "call_stop_while_paused_pause",
            runId,
            scope: systemPausePauseScope
          });

          yield* waitForBoard(
            () => runtime.readBoard(runId),
            (board) => runStatusIs(board, ["paused"])
          );

          const result = yield* runtime.stopRun(runId, { reason: "stop while paused" });

          return { result };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.result.outcome).toBe("stopped");
      expect(recording.presentationCalls).toEqual(["pause:hold"]);
      expect(recording.presentationCalls).not.toContain("resume");
    }
  });

  it("interrupts blocked capture after timeout and returns interrupted result", async () => {
    const runId = "run_stop_blocked";
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

          const result = yield* runtime.stopRun(runId, {
            timeoutMs: 200,
            reason: "blocked stop"
          });

          return { result, counters: { ...counters } };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.result.outcome).toBe("interrupted");
      expect(exit.value.result.snapshot).toBeUndefined();
      expect(exit.value.result.board.cells["system:run"]?.status[0]).toBe("failed");
      expect(String(exit.value.result.board.cells["system:run"]?.status[1])).toContain(
        "interrupted"
      );
      expect(exit.value.result.board.cells["system:run"]?.settings?.stopRequested).toBe(true);
      expect(exit.value.counters.pullStarted).toBeGreaterThan(0);
      expect(exit.value.counters.finalizerCalls).toBe(1);
      expect(exit.value.counters.finalized).toBe(true);
    }
  });

  it("fails when stopping a run without an active handle", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime();
          return yield* runtime.stopRun("run_missing_handle");
        })
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("LiveStreakConfigError");
      expect(exit.cause.toString()).toContain("Active handle for run run_missing_handle not found");
    }
  });

  it("rejects invalid timeout values before interrupt scheduling", async () => {
    const runId = "run_stop_bad_timeout";
    const { options } = createSyntheticKernelOptions(8);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(syntheticCaptureRunConfig(runId, `/tmp/${runId}.mp4`));
          yield* runtime.startRun(runId);

          return yield* runtime.stopRun(runId, { timeoutMs: Number.NaN });
        })
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("LiveStreakConfigError");
      expect(exit.cause.toString()).toContain("stopRun timeoutMs must be a finite number");
    }
  });

  it("is idempotent when stop is requested twice", async () => {
    const runId = "run_stop_idempotent";
    const { options } = createSyntheticKernelOptions(8);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(syntheticCaptureRunConfig(runId, `/tmp/${runId}.mp4`));
          yield* runtime.startRun(runId);

          yield* runtime.callFunction({
            callId: "call_stop_idempotent_first",
            runId,
            scope: systemRunStopScope,
            payload: { reason: "operator stop" }
          });

          const first = yield* runtime.stopRun(runId);
          const second = yield* runtime.stopRun(runId);
          const board = yield* runtime.readBoard(runId);

          return { first, second, board };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.first.outcome).toBe("stopped");
      expect(exit.value.second.outcome).toBe("stopped");
      expect(exit.value.board.cells["system:run"]?.settings?.stopReason).toBe("operator stop");
    }
  });

  it("isolates stop to one run in a multi-run store", async () => {
    const { options } = createSyntheticKernelOptions(8);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });

          yield* runtime.prepareRun(
            syntheticCaptureRunConfig("run_stop_iso_a", "/tmp/run_stop_iso_a.mp4", { frameCount: 64 })
          );
          yield* runtime.prepareRun(
            syntheticCaptureRunConfig("run_stop_iso_b", "/tmp/run_stop_iso_b.mp4", { frameCount: 64 })
          );
          yield* runtime.startRun("run_stop_iso_a");
          yield* runtime.startRun("run_stop_iso_b");

          yield* runtime.stopRun("run_stop_iso_a", { reason: "stop a only" });

          const boardB = yield* runtime.readBoard("run_stop_iso_b");

          yield* runtime.stopRun("run_stop_iso_b");

          return { boardB };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.boardB.cells["system:run"]?.settings?.stopRequested).not.toBe(true);
    }
  });

  it("interrupt is idempotent on the active handle", async () => {
    const runId = "run_stop_interrupt_idempotent";
    const { options, counters } = createBlockedCaptureKernelOptions();

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(makeBlockedObserveRun(runId, `/tmp/${runId}.mp4`));
          const handle = yield* runtime.startRun(runId);

          yield* waitForBoard(
            () => runtime.readBoard(runId),
            () => counters.pullStarted > 0
          );

          yield* handle.interrupt;
          yield* handle.interrupt;

          return counters.finalizerCalls;
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toBe(1);
    }
  });
});

describe("ObserveBridge stopRun", () => {
  it("allows trusted caller to stop through runtime.stopRun", async () => {
    const runId = "run_bridge_stop";
    const { options } = createSyntheticKernelOptions(8);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          const bridge = createObserveBridge({ runtime });
          yield* runtime.prepareRun(syntheticCaptureRunConfig(runId, `/tmp/${runId}.mp4`));
          yield* runtime.startRun(runId);

          return yield* bridge.stopRun({
            caller: trustedCaller,
            runId,
            reason: "bridge stop"
          });
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.outcome).toBe("stopped");
    }
  });

  it("allows caller with system:run:stop grant to stop", async () => {
    const runId = "run_bridge_stop_grant";
    const { options } = createSyntheticKernelOptions(8);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          const bridge = createObserveBridge({ runtime });
          yield* runtime.prepareRun(syntheticCaptureRunConfig(runId, `/tmp/${runId}.mp4`));
          yield* runtime.startRun(runId);

          return yield* bridge.stopRun({
            caller: callerWithScopes("stopper", [systemRunStopScope]),
            runId
          });
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.outcome).toBe("stopped");
    }
  });

  it("denies stop without system:run:stop before reaching runtime", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime();
          let stopCalled = false;
          const wrappedRuntime = {
            ...runtime,
            stopRun: (runId: string) => {
              stopCalled = true;
              return runtime.stopRun(runId);
            }
          };
          const bridge = createObserveBridge({ runtime: wrappedRuntime });
          const runId = "run_bridge_stop_denied";

          const denied = yield* Effect.exit(
            bridge.stopRun({
              caller: callerWithScopes("reader", ["bridge:board:read"]),
              runId
            })
          );

          return { denied, stopCalled };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(Exit.isFailure(exit.value.denied)).toBe(true);
      if (Exit.isFailure(exit.value.denied)) {
        expect(exit.value.denied.cause.toString()).toContain("LiveStreakCapabilityError");
        expect(exit.value.denied.cause.toString()).toContain(systemRunStopScope);
      }
      expect(exit.value.stopCalled).toBe(false);
    }
  });

  it("fails typed config when stopping a missing active handle", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime();
          const bridge = createObserveBridge({ runtime });

          return yield* bridge.stopRun({
            caller: trustedCaller,
            runId: "run_bridge_missing_handle"
          });
        })
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("LiveStreakConfigError");
    }
  });

  it("propagates interrupted result for blocked capture stop", async () => {
    const runId = "run_bridge_stop_interrupted";
    const { options, counters } = createBlockedCaptureKernelOptions();

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          const bridge = createObserveBridge({ runtime });
          yield* runtime.prepareRun(makeBlockedObserveRun(runId, `/tmp/${runId}.mp4`));
          yield* runtime.startRun(runId);

          yield* waitForBoard(
            () => runtime.readBoard(runId),
            () => counters.pullStarted > 0
          );

          return yield* bridge.stopRun({
            caller: callerWithScopes("stopper-interrupted", [systemRunStopScope]),
            runId,
            timeoutMs: 200,
            reason: "bridge blocked stop"
          });
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.outcome).toBe("interrupted");
      expect(exit.value.snapshot).toBeUndefined();
    }
  });

  it("rejects invalid bridge stop timeout after authorization", async () => {
    const runId = "run_bridge_stop_bad_timeout";
    const { options } = createSyntheticKernelOptions(8);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          const bridge = createObserveBridge({ runtime });
          yield* runtime.prepareRun(syntheticCaptureRunConfig(runId, `/tmp/${runId}.mp4`));
          yield* runtime.startRun(runId);

          return yield* bridge.stopRun({
            caller: callerWithScopes("stopper-timeout", [systemRunStopScope]),
            runId,
            timeoutMs: -1
          });
        })
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("LiveStreakConfigError");
      expect(exit.cause.toString()).toContain(
        "stopRun timeoutMs must be greater than or equal to 0"
      );
    }
  });
});

import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { systemRunStopScope } from "#run/control/index.js";
import { createObserveRuntime } from "#run/runtime.js";
import { createRunStore } from "#run/store.js";
import {
  createCountedSyntheticKernelOptions,
  createSyntheticKernelOptions,
  createYieldingSyntheticKernelOptions,
  makeSyntheticObserveRun
} from "#test/helpers/runtime.js";

describe("ObserveRuntime", () => {
  it("prepareRun stores and returns a prepared run", async () => {
    const { options } = createSyntheticKernelOptions(4);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          const prepared = yield* runtime.prepareRun(
            makeSyntheticObserveRun("run_prepare", "/tmp/run_prepare.mp4").config
          );
          const listed = yield* runtime.listRuns();
          return { prepared, listed };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.prepared.prepared).toBe(true);
      expect(exit.value.prepared.bus).toBeDefined();
      expect(exit.value.listed).toHaveLength(1);
      expect(exit.value.listed[0]?.config.runId).toBe("run_prepare");
    }
  });

  it("duplicate prepareRun with same runId fails cleanly as LiveStreakConfigError", async () => {
    const { options } = createSyntheticKernelOptions(4);
    const config = makeSyntheticObserveRun("run_dup_prepare", "/tmp/run_dup_prepare.mp4").config;

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(config);
          return yield* runtime.prepareRun(config);
        })
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("LiveStreakConfigError");
      expect(exit.cause.toString()).toContain("already exists in store");
    }
  });

  it("startRun returns an active handle and stores it", async () => {
    const { options } = createSyntheticKernelOptions(4);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(
            makeSyntheticObserveRun("run_start", "/tmp/run_start.mp4").config
          );
          const handle = yield* runtime.startRun("run_start");
          const handles = yield* runtime.listHandles();
          return { handle, handles };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.handle.runId).toBe("run_start");
      expect(exit.value.handles).toHaveLength(1);
      expect(exit.value.handles[0]?.runId).toBe("run_start");
    }
  });

  it("awaitRun returns stopped result for finite synthetic run", async () => {
    const { options } = createSyntheticKernelOptions(4);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(
            makeSyntheticObserveRun("run_await", "/tmp/run_await.mp4").config
          );
          yield* runtime.startRun("run_await");
          return yield* runtime.awaitRun("run_await");
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.outcome).toBe("stopped");
      expect(exit.value.board.cells["system:run"]?.status[0]).toBe("stopped");
    }
  });

  it("readBoard works for prepared run", async () => {
    const { options } = createSyntheticKernelOptions(4);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(
            makeSyntheticObserveRun("run_board_prepared", "/tmp/run_board_prepared.mp4").config
          );
          return yield* runtime.readBoard("run_board_prepared");
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.cells["system:run"]?.status[0]).toBe("prepared");
    }
  });

  it("readBoard works for active run", async () => {
    const { options } = createSyntheticKernelOptions(32);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(
            makeSyntheticObserveRun("run_board_active", "/tmp/run_board_active.mp4").config
          );
          yield* runtime.startRun("run_board_active");
          const during = yield* runtime.readBoard("run_board_active");
          yield* runtime.awaitRun("run_board_active");
          const after = yield* runtime.readBoard("run_board_active");
          return { during, after };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(["prepared", "starting", "running", "draining", "stopped"]).toContain(
        exit.value.during.cells["system:run"]?.status[0]
      );
      expect(exit.value.after.cells["system:run"]?.status[0]).toBe("stopped");
    }
  });

  it("callFunction can pause one run", async () => {
    const { options } = createSyntheticKernelOptions(64);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(
            makeSyntheticObserveRun("run_pause", "/tmp/run_pause.mp4").config
          );
          yield* runtime.startRun("run_pause");

          yield* runtime.callFunction({
            callId: "call_pause",
            runId: "run_pause",
            scope: "system:pause:pause"
          });

          const board = yield* runtime.readBoard("run_pause");
          yield* runtime.callFunction({
            callId: "call_stop_paused",
            runId: "run_pause",
            scope: systemRunStopScope
          });
          yield* runtime.awaitRun("run_pause");
          return board;
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.cells["system:pause"]?.settings?.requested).toBe(true);
    }
  });

  it("two runtime runs stay isolated: pausing run A does not change run B", async () => {
    const { options } = createSyntheticKernelOptions(64);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(
            makeSyntheticObserveRun("run_iso_a", "/tmp/run_iso_a.mp4").config
          );
          yield* runtime.prepareRun(
            makeSyntheticObserveRun("run_iso_b", "/tmp/run_iso_b.mp4").config
          );
          yield* runtime.startRun("run_iso_a");
          yield* runtime.startRun("run_iso_b");

          yield* runtime.callFunction({
            callId: "call_pause_a",
            runId: "run_iso_a",
            scope: "system:pause:pause"
          });

          const boardA = yield* runtime.readBoard("run_iso_a");
          const boardB = yield* runtime.readBoard("run_iso_b");

          yield* runtime.callFunction({
            callId: "call_stop_iso_a",
            runId: "run_iso_a",
            scope: systemRunStopScope
          });
          yield* runtime.callFunction({
            callId: "call_stop_iso_b",
            runId: "run_iso_b",
            scope: systemRunStopScope
          });

          yield* runtime.awaitRun("run_iso_a");
          yield* runtime.awaitRun("run_iso_b");

          return { boardA, boardB };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.boardA.cells["system:pause"]?.settings?.requested).toBe(true);
      expect(exit.value.boardB.cells["system:pause"]?.settings?.requested).not.toBe(true);
    }
  });

  it("startRun duplicate active handle fails cleanly", async () => {
    const { options } = createSyntheticKernelOptions(4);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(
            makeSyntheticObserveRun("run_dup_start", "/tmp/run_dup_start.mp4").config
          );
          yield* runtime.startRun("run_dup_start");
          return yield* runtime.startRun("run_dup_start");
        })
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("Active handle for run run_dup_start already exists");
    }
  });

  it("startRun duplicate active handle does not fork a second worker", async () => {
    const { options, attachCount, createCount } = createCountedSyntheticKernelOptions(64);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(
            makeSyntheticObserveRun("run_dup_fork", "/tmp/run_dup_fork.mp4").config
          );

          const handle = yield* runtime.startRun("run_dup_fork");

          const duplicateExit = yield* Effect.exit(runtime.startRun("run_dup_fork"));
          expect(Exit.isFailure(duplicateExit)).toBe(true);
          if (Exit.isFailure(duplicateExit)) {
            expect(duplicateExit.cause.toString()).toContain(
              "Active handle for run run_dup_fork already exists"
            );
          }

          yield* handle.awaitResult();

          return { attachCount: attachCount(), createCount: createCount() };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.attachCount).toBe(1);
      expect(exit.value.createCount).toBe(1);
    }
  });

  it("removeRun does not remove active handle", async () => {
    const { options } = createSyntheticKernelOptions(4);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(
            makeSyntheticObserveRun("run_remove_prepared", "/tmp/run_remove_prepared.mp4").config
          );
          yield* runtime.startRun("run_remove_prepared");
          yield* runtime.removeRun("run_remove_prepared");

          const storedRun = yield* runtime.store.get("run_remove_prepared");
          const storedHandle = yield* runtime.store.getHandle("run_remove_prepared");
          const result = yield* runtime.awaitRun("run_remove_prepared");

          return { storedRun, storedHandle, result };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.storedRun).toBeUndefined();
      expect(exit.value.storedHandle).toBeDefined();
      expect(exit.value.result.outcome).toBe("stopped");
    }
  });

  it("removeHandle does not remove prepared run", async () => {
    const { options } = createSyntheticKernelOptions(4);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(
            makeSyntheticObserveRun("run_remove_handle", "/tmp/run_remove_handle.mp4").config
          );
          const handle = yield* runtime.startRun("run_remove_handle");
          yield* runtime.removeHandle("run_remove_handle");

          const storedRun = yield* runtime.store.get("run_remove_handle");
          const storedHandle = yield* runtime.store.getHandle("run_remove_handle");
          const result = yield* handle.awaitResult();

          return { storedRun, storedHandle, result };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.storedRun?.config.runId).toBe("run_remove_handle");
      expect(exit.value.storedHandle).toBeUndefined();
      expect(exit.value.result.outcome).toBe("stopped");
    }
  });

  it("injected store is used", async () => {
    const store = createRunStore();
    const { options } = createSyntheticKernelOptions(4);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ store, defaultKernelOptions: options });
          expect(runtime.store).toBe(store);
          yield* runtime.prepareRun(
            makeSyntheticObserveRun("run_injected_store", "/tmp/run_injected_store.mp4").config
          );
          return yield* store.get("run_injected_store");
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value?.config.runId).toBe("run_injected_store");
    }
  });

  it("default kernel options are used", async () => {
    const { options: defaultOptions, delivered } = createSyntheticKernelOptions(6);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: defaultOptions });
          yield* runtime.prepareRun(
            makeSyntheticObserveRun("run_defaults", "/tmp/run_defaults.mp4").config
          );
          yield* runtime.startRun("run_defaults");
          return yield* runtime.awaitRun("run_defaults");
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(delivered.length).toBe(6);
    }
  });

  it("per-call options override defaults", async () => {
    const { options: defaultOptions, delivered: defaultDelivered } =
      createSyntheticKernelOptions(64);
    const { options: overrideOptions, delivered: overrideDelivered } =
      createSyntheticKernelOptions(4);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: defaultOptions });
          yield* runtime.prepareRun(
            makeSyntheticObserveRun("run_override", "/tmp/run_override.mp4").config
          );
          yield* runtime.startRun("run_override", overrideOptions);
          return yield* runtime.awaitRun("run_override");
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(defaultDelivered.length).toBe(0);
      expect(overrideDelivered.length).toBe(4);
    }
  });

  it("callFunction system:run:stop ends a live run cleanly", async () => {
    const frameCount = 512;
    const { options, delivered } = createYieldingSyntheticKernelOptions(frameCount);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(
            makeSyntheticObserveRun("run_stop_live", "/tmp/run_stop_live.mp4").config
          );
          yield* runtime.startRun("run_stop_live");
          yield* Effect.yieldNow();
          yield* runtime.callFunction({
            callId: "call_stop_live",
            runId: "run_stop_live",
            scope: systemRunStopScope,
            payload: { reason: "runtime test stop" }
          });

          const result = yield* runtime.awaitRun("run_stop_live");
          const board = yield* runtime.readBoard("run_stop_live");

          return { result, board, deliveredCount: delivered.length };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.result.outcome).toBe("stopped");
      expect(exit.value.board.cells["system:run"]?.status[0]).toBe("stopped");
      expect(exit.value.board.cells["system:run"]?.settings?.stopRequested).toBe(true);
      expect(exit.value.deliveredCount).toBeGreaterThan(0);
      expect(exit.value.deliveredCount).toBeLessThan(frameCount);
    }
  });

  it("system:run:stop isolates runs", async () => {
    const { options: optionsA, delivered: deliveredA } = createYieldingSyntheticKernelOptions(512);
    const { options: optionsB, delivered: deliveredB } = createYieldingSyntheticKernelOptions(512);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({
            defaultKernelOptions: {
              ...optionsA,
              captureDriver: optionsA.captureDriver,
              sinkDriver: optionsA.sinkDriver
            }
          });

          yield* runtime.prepareRun(
            makeSyntheticObserveRun("run_stop_a", "/tmp/run_stop_a.mp4").config
          );
          yield* runtime.prepareRun(
            makeSyntheticObserveRun("run_stop_b", "/tmp/run_stop_b.mp4").config
          );

          yield* runtime.startRun("run_stop_a", optionsA);
          yield* runtime.startRun("run_stop_b", optionsB);
          yield* Effect.yieldNow();

          yield* runtime.callFunction({
            callId: "call_stop_a",
            runId: "run_stop_a",
            scope: systemRunStopScope
          });

          const resultA = yield* runtime.awaitRun("run_stop_a");
          const boardBDuring = yield* runtime.readBoard("run_stop_b");

          yield* runtime.callFunction({
            callId: "call_stop_b",
            runId: "run_stop_b",
            scope: systemRunStopScope
          });
          const resultB = yield* runtime.awaitRun("run_stop_b");

          return { resultA, resultB, boardBDuring, deliveredA: deliveredA.length, deliveredB: deliveredB.length };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.resultA.outcome).toBe("stopped");
      expect(exit.value.resultB.outcome).toBe("stopped");
      expect(exit.value.boardBDuring.cells["system:run"]?.settings?.stopRequested).not.toBe(true);
      expect(exit.value.deliveredA).toBeGreaterThan(0);
      expect(exit.value.deliveredA).toBeLessThan(512);
      expect(exit.value.deliveredB).toBeGreaterThan(0);
      expect(exit.value.deliveredB).toBeLessThan(512);
    }
  });
});

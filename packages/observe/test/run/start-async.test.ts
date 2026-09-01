import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { prepareObserveRun, startObserveRun, startObserveRunAsync } from "#run/kernel.js";
import { systemRunStopScope } from "#run/control/index.js";
import {
  callStoredRunFunction,
  createRunStore,
  readStoredRunBoard
} from "#run/store.js";
import {
  createSyntheticKernelOptions,
  makeSyntheticObserveRun
} from "#test/helpers/runtime.js";

describe("startObserveRunAsync", () => {
  it("returns a handle and awaitResult matches blocking startObserveRun", async () => {
    const { options } = createSyntheticKernelOptions(4);
    const blockingRun = makeSyntheticObserveRun("run_async_blocking", "/tmp/run_async_blocking.mp4");
    const asyncRun = makeSyntheticObserveRun("run_async_handle", "/tmp/run_async_handle.mp4");

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const preparedBlocking = yield* prepareObserveRun(blockingRun, options);
          const preparedAsync = yield* prepareObserveRun(asyncRun, options);

          const blockingResult = yield* startObserveRun(preparedBlocking, options);
          const handle = yield* startObserveRunAsync({ run: preparedAsync, options });
          const asyncResult = yield* handle.awaitResult();

          return { blockingResult, handle, asyncResult };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (!Exit.isSuccess(exit)) {
      return;
    }

    expect(exit.value.handle.runId).toBe("run_async_handle");
    expect(exit.value.handle.bus).toBe(exit.value.handle.run.bus);
    expect(exit.value.handle.startedAtMs).toBeLessThanOrEqual(Date.now());
    expect(exit.value.asyncResult.outcome).toBe("stopped");
    expect(exit.value.asyncResult.outcome).toBe(exit.value.blockingResult.outcome);
    expect(exit.value.asyncResult.board.cells["system:run"]?.status[0]).toBe("stopped");
  });

  it("exposes the bus for board reads during an async run", async () => {
    const { options } = createSyntheticKernelOptions(32);
    const run = makeSyntheticObserveRun("run_async_board", "/tmp/run_async_board.mp4");

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const prepared = yield* prepareObserveRun(run, options);
          const handle = yield* startObserveRunAsync({ run: prepared, options });
          const during = yield* handle.bus.readBoard();
          const result = yield* handle.awaitResult();
          const after = yield* handle.bus.readBoard();
          return { during, after, result };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(["prepared", "starting", "running", "draining", "stopped"]).toContain(
        exit.value.during.cells["system:run"]?.status[0]
      );
      expect(exit.value.after.cells["system:run"]?.status[0]).toBe("stopped");
      expect(exit.value.result.outcome).toBe("stopped");
    }
  });
});

describe("RunStore active handles", () => {
  it("rejects duplicate active handles for the same runId", async () => {
    const store = createRunStore();
    const { options } = createSyntheticKernelOptions(4);
    const run = makeSyntheticObserveRun("run_dup_handle", "/tmp/run_dup_handle.mp4");

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const prepared = yield* prepareObserveRun(run, options);
          const handle = yield* startObserveRunAsync({ run: prepared, options });
          yield* store.putHandle(handle);
          return yield* store.putHandle(handle);
        })
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("Active handle for run run_dup_handle already exists");
    }
  });

  it("holds two active handles with different runIds", async () => {
    const store = createRunStore();
    const { options } = createSyntheticKernelOptions(4);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const preparedA = yield* prepareObserveRun(
            makeSyntheticObserveRun("run_handle_a", "/tmp/run_handle_a.mp4"),
            options
          );
          const preparedB = yield* prepareObserveRun(
            makeSyntheticObserveRun("run_handle_b", "/tmp/run_handle_b.mp4"),
            options
          );

          const handleA = yield* startObserveRunAsync({ run: preparedA, options });
          const handleB = yield* startObserveRunAsync({ run: preparedB, options });
          yield* store.putHandle(handleA);
          yield* store.putHandle(handleB);

          const listed = yield* store.listHandles();
          yield* handleA.awaitResult();
          yield* handleB.awaitResult();
          return listed.map((handle) => handle.runId);
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual(["run_handle_a", "run_handle_b"]);
    }
  });

  it("callStoredRunFunction pauses one run without changing another", async () => {
    const store = createRunStore();
    const { options } = createSyntheticKernelOptions(64);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const preparedA = yield* prepareObserveRun(
            makeSyntheticObserveRun("run_call_a", "/tmp/run_call_a.mp4"),
            options
          );
          const preparedB = yield* prepareObserveRun(
            makeSyntheticObserveRun("run_call_b", "/tmp/run_call_b.mp4"),
            options
          );

          const handleA = yield* startObserveRunAsync({ run: preparedA, options });
          const handleB = yield* startObserveRunAsync({ run: preparedB, options });
          yield* store.putHandle(handleA);
          yield* store.putHandle(handleB);

          yield* callStoredRunFunction(store, {
            callId: "call_pause_a",
            runId: "run_call_a",
            scope: "system:pause:pause"
          });

          const boardA = yield* readStoredRunBoard(store, "run_call_a");
          const boardB = yield* readStoredRunBoard(store, "run_call_b");

          yield* callStoredRunFunction(store, {
            callId: "call_stop_a",
            runId: "run_call_a",
            scope: systemRunStopScope
          });
          yield* callStoredRunFunction(store, {
            callId: "call_stop_b",
            runId: "run_call_b",
            scope: systemRunStopScope
          });

          yield* handleA.awaitResult();
          yield* handleB.awaitResult();

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

  it("still rejects mismatched envelope runId at the bus", async () => {
    const store = createRunStore();
    const { options } = createSyntheticKernelOptions(4);
    const run = makeSyntheticObserveRun("run_mismatch", "/tmp/run_mismatch.mp4");

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const prepared = yield* prepareObserveRun(run, options);
          const handle = yield* startObserveRunAsync({ run: prepared, options });
          yield* store.putHandle(handle);

          return yield* handle.bus.callFunction({
            callId: "call_wrong",
            runId: "run_other",
            scope: "system:pause:pause"
          });
        })
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("does not match bus runId");
    }
  });

  it("removeHandle drops the handle reference but keeps the prepared run", async () => {
    const store = createRunStore();
    const { options } = createSyntheticKernelOptions(4);
    const run = makeSyntheticObserveRun("run_remove_handle", "/tmp/run_remove_handle.mp4");

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const prepared = yield* prepareObserveRun(run, options);
          yield* store.put(prepared);

          const handle = yield* startObserveRunAsync({ run: prepared, options });
          yield* store.putHandle(handle);
          yield* store.removeHandle("run_remove_handle");

          const storedRun = yield* store.get("run_remove_handle");
          const storedHandle = yield* store.getHandle("run_remove_handle");
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

  it("remove prepared run does not stop an active handle", async () => {
    const store = createRunStore();
    const { options } = createSyntheticKernelOptions(4);
    const run = makeSyntheticObserveRun("run_remove_prepared", "/tmp/run_remove_prepared.mp4");

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const prepared = yield* prepareObserveRun(run, options);
          yield* store.put(prepared);

          const handle = yield* startObserveRunAsync({ run: prepared, options });
          yield* store.putHandle(handle);
          yield* store.remove("run_remove_prepared");

          const storedRun = yield* store.get("run_remove_prepared");
          const result = yield* handle.awaitResult();

          return { storedRun, result };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.storedRun).toBeUndefined();
      expect(exit.value.result.outcome).toBe("stopped");
    }
  });
});

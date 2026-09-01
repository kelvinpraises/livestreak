import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { buildControlCatalog } from "#run/control/index.js";
import { createControlBus } from "#run/control/bus/index.js";
import { createBrowserBoardFixture } from "#test/helpers/board.js";
import { createSystemPauseSurface } from "#run/control/index.js";
import { makeObserveRunSync } from "#test/helpers/observe-run.js";
import { createRunStore } from "#run/store.js";
import { browserCaptureRunConfig } from "#test/helpers/run-config.js";

const sampleRunConfig = (runId: string) =>
  browserCaptureRunConfig(
    runId,
    { url: "https://example.com", captureFps: 30, encoding: "jpeg" },
    { path: "/tmp/out.mp4" }
  );

describe("RunStore", () => {
  it("stores and retrieves a run", async () => {
    const store = createRunStore();
    const run = makeObserveRunSync(sampleRunConfig("run_store_a"));

    await Effect.runPromise(store.put(run));
    const retrieved = await Effect.runPromise(store.get("run_store_a"));

    expect(retrieved).toEqual(run);
  });

  it("fails put on duplicate runId", async () => {
    const store = createRunStore();
    const run = makeObserveRunSync(sampleRunConfig("run_store_dup"));

    await Effect.runPromise(store.put(run));
    const exit = await Effect.runPromiseExit(store.put(run));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("LiveStreakConfigError");
      expect(exit.cause.toString()).toContain("already exists in store");
    }
  });

  it("require fails for missing runId", async () => {
    const store = createRunStore();
    const exit = await Effect.runPromiseExit(store.require("run_missing"));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("LiveStreakConfigError");
      expect(exit.cause.toString()).toContain("not found in store");
    }
  });

  it("remove deletes a stored run", async () => {
    const store = createRunStore();
    const run = makeObserveRunSync(sampleRunConfig("run_store_remove"));

    await Effect.runPromise(store.put(run));
    await Effect.runPromise(store.remove("run_store_remove"));

    expect(await Effect.runPromise(store.get("run_store_remove"))).toBeUndefined();
  });

  it("list returns runs in insertion order", async () => {
    const store = createRunStore();
    const runA = makeObserveRunSync(sampleRunConfig("run_store_list_a"));
    const runB = makeObserveRunSync(sampleRunConfig("run_store_list_b"));

    await Effect.runPromise(store.put(runA));
    await Effect.runPromise(store.put(runB));

    const listed = await Effect.runPromise(store.list());
    expect(listed.map((run) => run.config.runId)).toEqual(["run_store_list_a", "run_store_list_b"]);
  });

  it("retrieves a prepared run and calls through its bus", async () => {
    const store = createRunStore();
    const runId = "run_store_prepared";
    const board = createBrowserBoardFixture(runId);
    const bus = await Effect.runPromise(
      createControlBus({
        runId,
        board,
        catalog: buildControlCatalog(),
        surfaces: [createSystemPauseSurface()]
      })
    );
    const preparedRun = {
      ...makeObserveRunSync(sampleRunConfig(runId)),
      board: await Effect.runPromise(bus.readBoard()),
      bus,
      prepared: true as const
    };

    await Effect.runPromise(store.put(preparedRun));
    const retrieved = await Effect.runPromise(store.require(runId));

    const result = await Effect.runPromise(
      retrieved.bus!.callFunction({
        callId: "call_pause",
        runId,
        scope: "system:pause:pause"
      })
    );

    expect(result.runId).toBe(runId);
    expect(result.changed).toBe(true);
  });
});

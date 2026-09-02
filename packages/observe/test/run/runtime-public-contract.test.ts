import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import {
  browserCaptureInspectTargetsScope,
  createObserveRuntime,
  createRunStore,
  systemPauseSetPresentationScope,
  systemRunStopScope,
  type ObserveRunConfig
} from "#index.js";
import {
  createBrowserPreviewHandleBus,
  createBrowserRuntimeKernelOptions,
  waitForBrowserPreviewCall
} from "#test/helpers/browser-runtime.js";
import {
  syntheticCaptureRunConfig
} from "#test/helpers/run-config.js";
import { createSyntheticKernelOptions } from "#test/helpers/runtime.js";

const opaqueArtifactIdPattern = /^art_[0-9a-f-]{36}$/i;

const makeBrowserObserveRunConfig = (runId: string, outputPath: string): ObserveRunConfig => ({
  runId,
  capture: {
    driverId: "browser",
    config: {
      url: "https://example.com/live",
      captureFps: 30,
      viewport: { width: 640, height: 480 },
      encoding: "jpeg",
      maxFrames: 64
    }
  },
  sink: {
    driverId: "memory",
    config: { path: outputPath }
  },
   
  process: null
});

describe("ObserveRuntime public contract", () => {
  it("runs the full public workflow with artifact retrieval", async () => {
    const { options } = createBrowserRuntimeKernelOptions(64);
    const runId = "run_public_full";
    const config = makeBrowserObserveRunConfig(runId, "/tmp/run_public_full.mp4");

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(config);
          yield* runtime.startRun(runId);

          const preview = yield* waitForBrowserPreviewCall(() =>
            runtime.callFunction({
              callId: "call_public_preview",
              runId,
              scope: browserCaptureInspectTargetsScope
            })
          );

          expect(preview.artifactId).toMatch(opaqueArtifactIdPattern);
          expect(preview.artifact?.ownerCell).toBe("capture:browser");

          const stored = yield* runtime.getArtifact(runId, preview.artifactId!);
          expect(stored).toEqual(preview.artifact);

          const boardDuring = yield* runtime.readBoard(runId);

          yield* runtime.callFunction({
            callId: "call_public_stop",
            runId,
            scope: systemRunStopScope
          });

          const result = yield* runtime.awaitRun(runId);
          const boardAfter = yield* runtime.readBoard(runId);

          return { preview, stored, result, boardDuring, boardAfter };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.result.outcome).toBe("stopped");
      expect(exit.value.boardAfter.cells["system:run"]?.status[0]).toBe("stopped");
      expect(exit.value.boardDuring.revision).toBeGreaterThanOrEqual(1);
    }
  });

  it("browser preview artifacts require active worker surface (not on prepared-only bus)", async () => {
    const { options } = createBrowserRuntimeKernelOptions(64);
    const runId = "run_public_prepared_only";
    const config = makeBrowserObserveRunConfig(runId, "/tmp/run_public_prepared_only.mp4");

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(config);

          return yield* runtime.callFunction({
            callId: "call_prepared_preview",
            runId,
            scope: browserCaptureInspectTargetsScope
          });
        })
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("No live surface advertises function scope");
    }
  });

  it("getArtifact resolves from prepared run bus after active handle is removed", async () => {
    const { options } = createBrowserRuntimeKernelOptions(64);
    const runId = "run_public_prepared_fallback";
    const config = makeBrowserObserveRunConfig(runId, "/tmp/run_public_prepared_fallback.mp4");

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(config);
          yield* runtime.startRun(runId);

          const preview = yield* waitForBrowserPreviewCall(() =>
            runtime.callFunction({
              callId: "call_prepared_fallback_preview",
              runId,
              scope: browserCaptureInspectTargetsScope
            })
          );

          const artifactId = preview.artifactId;
          if (artifactId === undefined) {
            return yield* Effect.fail(new Error("expected artifact id"));
          }

          yield* runtime.removeHandle(runId);

          const stored = yield* runtime.getArtifact(runId, artifactId);
          return { preview, stored };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.stored).toEqual(exit.value.preview.artifact);
    }
  });

  it("prefers active handle bus over prepared run bus when they differ", async () => {
    const runId = "run_public_handle_preferred";
    const config = makeBrowserObserveRunConfig(runId, "/tmp/run_public_handle_preferred.mp4");
    const store = createRunStore();

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ store });
          const prepared = yield* runtime.prepareRun(config, createBrowserRuntimeKernelOptions(1).options);

          const { artifactId, handleBus, preview } = yield* createBrowserPreviewHandleBus({
            runId,
            board: prepared.board,
            url: (config.capture.config as { readonly url: string }).url
          });

          yield* store.putHandle({
            runId,
            run: prepared,
            bus: handleBus,
            startedAtMs: Date.now(),
            awaitResult: () => Effect.die("awaitResult not used in handle-bus preference test"),
            interrupt: Effect.void
          });

          const missingOnPreparedBus = yield* prepared.bus!.getArtifact(artifactId);
          expect(missingOnPreparedBus).toBeUndefined();

          const stored = yield* runtime.getArtifact(runId, artifactId);
          return { preview, stored };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.stored).toEqual(exit.value.preview.artifact);
    }
  });

  it("getArtifact fails cleanly for unknown artifact id", async () => {
    const { options } = createBrowserRuntimeKernelOptions(4);
    const runId = "run_public_missing_artifact";
    const config = makeBrowserObserveRunConfig(runId, "/tmp/run_public_missing_artifact.mp4");

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(config);
          return yield* runtime.getArtifact(runId, "art_missing");
        })
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("LiveStreakConfigError");
      expect(exit.cause.toString()).toContain("Artifact art_missing not found for run run_public_missing_artifact");
    }
  });

  it("getArtifact, subscribeBoard, and subscribeArtifacts fail cleanly for unknown run id", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime();
          const getExit = yield* Effect.exit(runtime.getArtifact("run_missing", "art_missing"));
          const boardExit = yield* Effect.exit(
            runtime.subscribeBoard("run_missing", () => {})
          );
          const artifactExit = yield* Effect.exit(
            runtime.subscribeArtifacts("run_missing", () => {})
          );
          return { getExit, boardExit, artifactExit };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(Exit.isFailure(exit.value.getExit)).toBe(true);
      expect(Exit.isFailure(exit.value.boardExit)).toBe(true);
      expect(Exit.isFailure(exit.value.artifactExit)).toBe(true);

      if (Exit.isFailure(exit.value.getExit)) {
        expect(exit.value.getExit.cause.toString()).toContain("LiveStreakConfigError");
        expect(exit.value.getExit.cause.toString()).toContain("Run run_missing not found in store");
      }

      if (Exit.isFailure(exit.value.boardExit)) {
        expect(exit.value.boardExit.cause.toString()).toContain("LiveStreakConfigError");
        expect(exit.value.boardExit.cause.toString()).toContain("Run run_missing not found in store");
      }

      if (Exit.isFailure(exit.value.artifactExit)) {
        expect(exit.value.artifactExit.cause.toString()).toContain("LiveStreakConfigError");
        expect(exit.value.artifactExit.cause.toString()).toContain("Run run_missing not found in store");
      }
    }
  });

  it("isolates artifacts across runs", async () => {
    const { options } = createBrowserRuntimeKernelOptions(64);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });

          yield* runtime.prepareRun(
            makeBrowserObserveRunConfig("run_public_iso_a", "/tmp/run_public_iso_a.mp4")
          );
          yield* runtime.prepareRun(
            makeBrowserObserveRunConfig("run_public_iso_b", "/tmp/run_public_iso_b.mp4")
          );

          yield* runtime.startRun("run_public_iso_a");
          yield* runtime.startRun("run_public_iso_b");

          const previewA = yield* waitForBrowserPreviewCall(() =>
            runtime.callFunction({
              callId: "call_iso_a_preview",
              runId: "run_public_iso_a",
              scope: browserCaptureInspectTargetsScope
            })
          );

          const artifactId = previewA.artifactId;
          if (artifactId === undefined) {
            return yield* Effect.fail(new Error("expected artifact id"));
          }

          const fromA = yield* runtime.getArtifact("run_public_iso_a", artifactId);
          const fromBExit = yield* Effect.exit(
            runtime.getArtifact("run_public_iso_b", artifactId)
          );

          yield* runtime.callFunction({
            callId: "call_iso_a_stop",
            runId: "run_public_iso_a",
            scope: systemRunStopScope
          });
          yield* runtime.callFunction({
            callId: "call_iso_b_stop",
            runId: "run_public_iso_b",
            scope: systemRunStopScope
          });
          yield* runtime.awaitRun("run_public_iso_a");
          yield* runtime.awaitRun("run_public_iso_b");

          return { fromA, fromBExit, artifactId };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.fromA.id).toBe(exit.value.artifactId);
      expect(Exit.isFailure(exit.value.fromBExit)).toBe(true);
      if (Exit.isFailure(exit.value.fromBExit)) {
        expect(exit.value.fromBExit.cause.toString()).toContain(
          `Artifact ${exit.value.artifactId} not found for run run_public_iso_b`
        );
      }
    }
  });

  it("subscribeBoard receives board updates and unsubscribe stops later notifications", async () => {
    const { options } = createSyntheticKernelOptions(4);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          const runId = "run_public_board_sub";
          yield* runtime.prepareRun(syntheticCaptureRunConfig(runId, "/tmp/out.mp4", { frameCount: 4 }));

          const revisions: number[] = [];
          const subscription = yield* runtime.subscribeBoard(runId, (board) => {
            revisions.push(board.revision);
          });

          yield* runtime.callFunction({
            callId: "call_board_sub_presentation",
            runId,
            scope: systemPauseSetPresentationScope,
            payload: { whilePaused: "slate", slateAssetId: "asset1" }
          });

          yield* subscription.unsubscribe();

          yield* runtime.callFunction({
            callId: "call_board_sub_presentation_again",
            runId,
            scope: systemPauseSetPresentationScope,
            payload: { whilePaused: "hold" }
          });

          return revisions;
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.length).toBe(1);
      expect(exit.value[0]).toBeGreaterThan(1);
    }
  });

  it("subscribeArtifacts receives artifact events and unsubscribe stops later notifications", async () => {
    const { options } = createBrowserRuntimeKernelOptions(64);
    const runId = "run_public_artifact_sub";
    const config = makeBrowserObserveRunConfig(runId, "/tmp/run_public_artifact_sub.mp4");

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(config);
          yield* runtime.startRun(runId);

          const seen: string[] = [];
          const subscription = yield* runtime.subscribeArtifacts(runId, (artifact) => {
            seen.push(artifact.id);
          });

          const first = yield* waitForBrowserPreviewCall(() =>
            runtime.callFunction({
              callId: "call_artifact_sub_first",
              runId,
              scope: browserCaptureInspectTargetsScope
            })
          );

          yield* subscription.unsubscribe();

          yield* waitForBrowserPreviewCall(() =>
            runtime.callFunction({
              callId: "call_artifact_sub_second",
              runId,
              scope: browserCaptureInspectTargetsScope
            })
          );

          return { seen, first };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.seen).toHaveLength(1);
      expect(exit.value.seen[0]).toBe(exit.value.first.artifactId);
    }
  });

  it("duplicate active start remains protected", async () => {
    const { options } = createBrowserRuntimeKernelOptions(4);
    const runId = "run_public_dup_start";
    const config = makeBrowserObserveRunConfig(runId, "/tmp/run_public_dup_start.mp4");

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(config);
          yield* runtime.startRun(runId);
          return yield* runtime.startRun(runId);
        })
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("Active handle for run run_public_dup_start already exists");
    }
  });
});

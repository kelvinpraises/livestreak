import { describe, expect, it } from "vitest";
import { runCellIdOf } from "#run/control/board/model.js";
import { Effect, Exit, Fiber, Option } from "effect";
import {
  bridgeArtifactReadScope,
  bridgeBoardReadScope,
  bridgeBoardSubscribeScope,
  browserCaptureClearCropScope,
  browserCaptureInspectTargetsScope,
  createCapabilityGrant,
  createObserveBridge,
  createObserveRuntime,
  evaluateBridgeAuthorization,
  systemPauseSetPresentationScope,
  systemRunStopScope,
  type BridgeCaller,
  type CapabilityScope,
  type ObserveRunConfig
} from "#index.js";
import {
  createBrowserRuntimeKernelOptions,
  waitForBrowserPreviewCall
} from "#test/helpers/browser-runtime.js";
import { createSyntheticKernelOptions } from "#test/helpers/runtime.js";

import {
  syntheticCaptureRunConfig
} from "#test/helpers/run-config.js";
import {
  makeObserveRun,
  mountObserveT0Bus,
  shellRunConfig
} from "#index.js";
import { createFakeMarketRegistrar } from "#test/helpers/fake-market-registrar.js";
import {
  observationCellId,
  readObservationIndex,
  systemConfigCaptureKindScope,
  systemConfigPublishKindScope
} from "#run/control/system/config.js";
import { ingestCaptureConfigureScope } from "#pipeline/capture/ingest/commands.js";
import { liveSinkConfigureScope } from "#pipeline/publish/sinks/live/commands.js";
import { directSinkConfigureScope } from "#pipeline/publish/sinks/direct/commands.js";
import { readBoardRunPrepared } from "#run/control/board/index.js";
import { waitForBoard } from "#test/helpers/presentation-runtime.js";
import { systemRunAwaitScope, type SystemRunHooks } from "#run/control/system/run.js";

const trustedCaller: BridgeCaller = { id: "trusted-local", trusted: true };

const callerWithScopes = (
  id: string,
  scopes: readonly CapabilityScope[],
  options?: { readonly trusted?: boolean; readonly revoked?: boolean; readonly expiresAt?: number }
): BridgeCaller => ({
  id,
  trusted: options?.trusted,
  grants: [
    createCapabilityGrant({
      id: `${id}-grant`,
      holder: id,
      scopes,
      ...(options?.revoked === undefined ? {} : { revoked: options.revoked }),
      ...(options?.expiresAt === undefined ? {} : { expiresAt: options.expiresAt })
    })
  ]
});

const syntheticRunConfig = (runId: string, frameCount = 4) =>
  syntheticCaptureRunConfig(runId, "/tmp/out.mp4", {
    frameCount,
    width: 16,
    height: 16,
    fps: 30
  });

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

describe("ObserveBridge", () => {
  it("allows trusted caller to read board", async () => {
    const { options } = createSyntheticKernelOptions(4);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          const bridge = createObserveBridge({ runtime });
          const runId = "run_bridge_board";
          yield* runtime.prepareRun(syntheticRunConfig(runId));

          return yield* bridge.readBoard({ caller: trustedCaller, runId });
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.cells[runCellIdOf(exit.value) ?? "system:run"]?.status[0]).toBe("prepared");
    }
  });

  it("allows trusted caller to read controls", async () => {
    const { options } = createSyntheticKernelOptions(4);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          const bridge = createObserveBridge({ runtime });
          const runId = "run_bridge_controls";
          yield* runtime.prepareRun(syntheticRunConfig(runId));

          return yield* bridge.readControls({ caller: trustedCaller, runId });
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.runId).toBe("run_bridge_controls");
      expect(exit.value.cells.some((cell) => cell.id === "system:pause")).toBe(true);
      const setPresentation = exit.value.cells
        .find((cell) => cell.id === "system:pause")
        ?.functions.find((functionView) => functionView.name === "setPresentation");
      expect(setPresentation?.scope).toBe("system:pause:setPresentation");
      expect(setPresentation?.label).toBe("Set pause presentation");
      expect(setPresentation?.resultKind).toBe("patch");
    }
  });

  it("allows trusted caller to call system:pause:setPresentation", async () => {
    const { options } = createSyntheticKernelOptions(4);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          const bridge = createObserveBridge({ runtime });
          const runId = "run_bridge_pause";
          yield* runtime.prepareRun(syntheticRunConfig(runId));

          return yield* bridge.callFunction({
            caller: trustedCaller,
            envelope: {
              callId: "call_bridge_pause",
              runId,
              scope: systemPauseSetPresentationScope,
              payload: { whilePaused: "slate", slateAssetId: "bridge-asset" }
            }
          });
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.changed).toBe(true);
    }
  });

  it("allows trusted caller to get artifact after browser preview", async () => {
    const { options } = createBrowserRuntimeKernelOptions(64);
    const runId = "run_bridge_artifact";

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          const bridge = createObserveBridge({ runtime });
          yield* runtime.prepareRun(makeBrowserObserveRunConfig(runId, "/tmp/run_bridge_artifact.mp4"));
          yield* runtime.startRun(runId);

          const preview = yield* waitForBrowserPreviewCall(() =>
            bridge.callFunction({
              caller: trustedCaller,
              envelope: {
                callId: "call_bridge_preview",
                runId,
                scope: browserCaptureInspectTargetsScope
              }
            })
          );

          const artifactId = preview.artifactId;
          if (artifactId === undefined) {
            return yield* Effect.fail(new Error("expected artifact id"));
          }

          return yield* bridge.getArtifact({
            caller: trustedCaller,
            runId,
            artifactId
          });
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.ownerCell).toBe("capture:browser");
    }
  });

  it("allows trusted caller to subscribe board and receive update", async () => {
    const { options } = createSyntheticKernelOptions(4);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          const bridge = createObserveBridge({ runtime });
          const runId = "run_bridge_board_sub";
          yield* runtime.prepareRun(syntheticRunConfig(runId));

          const revisions: number[] = [];
          const subscription = yield* bridge.subscribeBoard({
            caller: trustedCaller,
            runId,
            listener: (board) => {
              revisions.push(board.revision);
            }
          });

          yield* bridge.callFunction({
            caller: trustedCaller,
            envelope: {
              callId: "call_bridge_board_sub",
              runId,
              scope: systemPauseSetPresentationScope,
              payload: { whilePaused: "slate", slateAssetId: "bridge-asset" }
            }
          });

          yield* subscription.unsubscribe();
          return revisions;
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.length).toBe(1);
    }
  });

  it("allows trusted caller to subscribe artifacts and receive artifact event", async () => {
    const { options } = createBrowserRuntimeKernelOptions(64);
    const runId = "run_bridge_artifact_sub";

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          const bridge = createObserveBridge({ runtime });
          yield* runtime.prepareRun(makeBrowserObserveRunConfig(runId, "/tmp/run_bridge_artifact_sub.mp4"));
          yield* runtime.startRun(runId);

          const seen: string[] = [];
          const subscription = yield* bridge.subscribeArtifacts({
            caller: trustedCaller,
            runId,
            listener: (artifact) => {
              seen.push(artifact.id);
            }
          });

          const preview = yield* waitForBrowserPreviewCall(() =>
            bridge.callFunction({
              caller: trustedCaller,
              envelope: {
                callId: "call_bridge_artifact_sub",
                runId,
                scope: browserCaptureInspectTargetsScope
              }
            })
          );

          yield* subscription.unsubscribe();
          return { seen, preview };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.seen).toEqual([exit.value.preview.artifactId]);
    }
  });

  it("allows trusted caller to await run", async () => {
    const { options } = createSyntheticKernelOptions(4);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          const bridge = createObserveBridge({ runtime });
          const runId = "run_bridge_await";
          yield* runtime.prepareRun(syntheticRunConfig(runId));
          yield* runtime.startRun(runId);

          return yield* bridge.awaitRun({ caller: trustedCaller, runId });
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.outcome).toBe("stopped");
    }
  });

  it("denies untrusted caller without grant from reading board", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime();
          const bridge = createObserveBridge({ runtime });
          return yield* bridge.readBoard({
            caller: { id: "limited" },
            runId: "run_missing"
          });
        })
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("LiveStreakCapabilityError");
      expect(exit.cause.toString()).toContain("bridge:board:read");
    }
  });

  it("allows untrusted caller with bridge:board:read to read board", async () => {
    const { options } = createSyntheticKernelOptions(4);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          const bridge = createObserveBridge({ runtime });
          const runId = "run_bridge_granted_read";
          yield* runtime.prepareRun(syntheticRunConfig(runId));

          return yield* bridge.readBoard({
            caller: callerWithScopes("reader", [bridgeBoardReadScope]),
            runId
          });
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("denies untrusted caller without function scope from calling function", async () => {
    const { options } = createSyntheticKernelOptions(4);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          const bridge = createObserveBridge({ runtime });
          const runId = "run_bridge_denied_call";
          yield* runtime.prepareRun(syntheticRunConfig(runId));

          return yield* bridge.callFunction({
            caller: callerWithScopes("reader", [bridgeBoardReadScope]),
            envelope: {
              callId: "call_denied",
              runId,
              scope: systemPauseSetPresentationScope,
              payload: { whilePaused: "slate", slateAssetId: "bridge-asset" }
            }
          });
        })
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("LiveStreakCapabilityError");
      expect(exit.cause.toString()).toContain(systemPauseSetPresentationScope);
    }
  });

  it("allows untrusted caller with exact function scope to call function", async () => {
    const { options } = createSyntheticKernelOptions(4);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          const bridge = createObserveBridge({ runtime });
          const runId = "run_bridge_granted_call";
          yield* runtime.prepareRun(syntheticRunConfig(runId));

          return yield* bridge.callFunction({
            caller: callerWithScopes("operator", [systemPauseSetPresentationScope]),
            envelope: {
              callId: "call_granted",
              runId,
              scope: systemPauseSetPresentationScope,
              payload: { whilePaused: "slate", slateAssetId: "bridge-asset" }
            }
          });
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("denies artifact read without bridge:artifact:read", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime();
          const bridge = createObserveBridge({ runtime });

          return yield* bridge.getArtifact({
            caller: callerWithScopes("reader", [bridgeBoardReadScope]),
            runId: "run_any",
            artifactId: "art_any"
          });
        })
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("LiveStreakCapabilityError");
      expect(exit.cause.toString()).toContain(bridgeArtifactReadScope);
    }
  });

  it("returns typed missing-run error after authorization succeeds", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime();
          const bridge = createObserveBridge({ runtime });

          return yield* bridge.readBoard({
            caller: trustedCaller,
            runId: "run_missing_after_auth"
          });
        })
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("LiveStreakConfigError");
      expect(exit.cause.toString()).toContain("Run run_missing_after_auth not found in store");
    }
  });

  it("fails when call envelope runId is not in store", async () => {
    const { options } = createSyntheticKernelOptions(4);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          const bridge = createObserveBridge({ runtime });
          const runId = "run_bridge_mismatch";
          yield* runtime.prepareRun(syntheticRunConfig(runId));

          return yield* bridge.callFunction({
            caller: trustedCaller,
            envelope: {
              callId: "call_mismatch",
              runId: "run_other",
              scope: systemPauseSetPresentationScope,
              payload: { whilePaused: "slate", slateAssetId: "bridge-asset" }
            }
          });
        })
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("Run run_other not found in store");
    }
  });

  it("allows trusted caller to stop a live run through bridge", async () => {
    const { options } = createBrowserRuntimeKernelOptions(64);
    const runId = "run_bridge_stop";

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          const bridge = createObserveBridge({ runtime });
          yield* runtime.prepareRun(makeBrowserObserveRunConfig(runId, "/tmp/run_bridge_stop.mp4"));
          yield* runtime.startRun(runId);

          yield* bridge.callFunction({
            caller: trustedCaller,
            envelope: {
              callId: "call_bridge_stop",
              runId,
              scope: systemRunStopScope
            }
          });

          return yield* bridge.awaitRun({ caller: trustedCaller, runId });
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.outcome).toBe("stopped");
    }
  });

  it("readPanel works for prepared run", async () => {
    const { options } = createSyntheticKernelOptions(4);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          const runId = "run_bridge_panel";
          yield* runtime.prepareRun(syntheticRunConfig(runId));

          return yield* runtime.readPanel(runId, { includeCatalog: true });
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.board.cells[runCellIdOf(exit.value.board) ?? "system:run"]?.status[0]).toBe("prepared");
      expect(exit.value.catalog?.cells["system:pause"]).toBeDefined();
    }
  });

  it("denies empty caller id", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime();
          const bridge = createObserveBridge({ runtime });

          return yield* bridge.readBoard({
            caller: { id: "" },
            runId: "run_any"
          });
        })
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("LiveStreakConfigError");
      expect(exit.cause.toString()).toContain("Bridge caller id is required");
    }
  });

  it("does not reach runtime when caller id is empty", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime();
          let readBoardCalled = false;
          const wrappedRuntime = {
            ...runtime,
            readBoard: (runId: string) => {
              readBoardCalled = true;
              return runtime.readBoard(runId);
            }
          };
          const bridge = createObserveBridge({ runtime: wrappedRuntime });

          const denied = yield* Effect.exit(
            bridge.readBoard({
              caller: { id: "", trusted: true },
              runId: "run_any"
            })
          );

          return { denied, readBoardCalled };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(Exit.isFailure(exit.value.denied)).toBe(true);
      expect(exit.value.readBoardCalled).toBe(false);
      if (Exit.isFailure(exit.value.denied)) {
        expect(exit.value.denied.cause.toString()).toContain("Bridge caller id is required");
      }
    }
  });

  it("denies trusted caller with empty id", async () => {
    const exit = await Effect.runPromiseExit(
      evaluateBridgeAuthorization({ id: "", trusted: true }, bridgeBoardReadScope)
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("Bridge caller id is required");
    }
  });

  it("denies empty required scope through evaluator", async () => {
    const exit = await Effect.runPromiseExit(
      evaluateBridgeAuthorization(trustedCaller, " ".repeat(3))
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("Bridge authorization scope is required");
    }
  });

  it("does not authorize bridge:* for bridge:board:read", async () => {
    const exit = await Effect.runPromiseExit(
      evaluateBridgeAuthorization(
        callerWithScopes("wildcard", ["bridge:*"]),
        bridgeBoardReadScope
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("LiveStreakCapabilityError");
      expect(exit.cause.toString()).toContain(bridgeBoardReadScope);
    }
  });

  it("authorizes duplicate exact grants without issue", async () => {
    const exit = await Effect.runPromiseExit(
      evaluateBridgeAuthorization(
        callerWithScopes("reader", [bridgeBoardReadScope, bridgeBoardReadScope]),
        bridgeBoardReadScope
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("denies callFunction with empty envelope scope", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime();
          const bridge = createObserveBridge({ runtime });

          return yield* bridge.callFunction({
            caller: trustedCaller,
            envelope: {
              callId: "call_empty_scope",
              runId: "run_any",
              scope: " ".repeat(3)
            }
          });
        })
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("Control call envelope scope is required");
    }
  });

  it("denies callFunction with empty caller id", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime();
          const bridge = createObserveBridge({ runtime });

          return yield* bridge.callFunction({
            caller: { id: " ".repeat(2) },
            envelope: {
              callId: "call_empty_caller",
              runId: "run_any",
              scope: systemPauseSetPresentationScope
            }
          });
        })
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("Bridge caller id is required");
    }
  });

  it("returns typed missing-run error for readControls after authorization", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime();
          const bridge = createObserveBridge({ runtime });

          return yield* bridge.readControls({
            caller: trustedCaller,
            runId: "run_missing_controls"
          });
        })
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("Run run_missing_controls not found in store");
    }
  });

  it("does not register board listener when caller is denied", async () => {
    const { options } = createSyntheticKernelOptions(4);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          let subscribeCalled = false;
          const wrappedRuntime = {
            ...runtime,
            subscribeBoard: (runId: string, listener: (board: import("#index.js").Board) => void) => {
              subscribeCalled = true;
              return runtime.subscribeBoard(runId, listener);
            }
          };
          const bridge = createObserveBridge({ runtime: wrappedRuntime });
          const runId = "run_bridge_sub_denied";
          yield* runtime.prepareRun(syntheticRunConfig(runId));

          const denied = yield* Effect.exit(
            bridge.subscribeBoard({
              caller: { id: "reader" },
              runId,
              listener: () => {}
            })
          );

          return { denied, subscribeCalled };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(Exit.isFailure(exit.value.denied)).toBe(true);
      expect(exit.value.subscribeCalled).toBe(false);
    }
  });

  it("does not register artifact listener when caller is denied", async () => {
    const { options } = createBrowserRuntimeKernelOptions(4);
    const runId = "run_bridge_artifact_sub_denied";

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          let subscribeCalled = false;
          const wrappedRuntime = {
            ...runtime,
            subscribeArtifacts: (
              subscribedRunId: string,
              listener: (artifact: import("#index.js").ControlArtifact) => void
            ) => {
              subscribeCalled = true;
              return runtime.subscribeArtifacts(subscribedRunId, listener);
            }
          };
          const bridge = createObserveBridge({ runtime: wrappedRuntime });
          yield* runtime.prepareRun(makeBrowserObserveRunConfig(runId, "/tmp/out.mp4"));
          yield* runtime.startRun(runId);

          const denied = yield* Effect.exit(
            bridge.subscribeArtifacts({
              caller: callerWithScopes("reader", [bridgeBoardSubscribeScope]),
              runId,
              listener: () => {}
            })
          );

          return { denied, subscribeCalled };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(Exit.isFailure(exit.value.denied)).toBe(true);
      expect(exit.value.subscribeCalled).toBe(false);
    }
  });

  it("allows global wildcard grant to read board", async () => {
    const { options } = createSyntheticKernelOptions(4);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          const bridge = createObserveBridge({ runtime });
          const runId = "run_bridge_global_read";
          yield* runtime.prepareRun(syntheticRunConfig(runId));

          return yield* bridge.readBoard({
            caller: callerWithScopes("global", ["*"]),
            runId
          });
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("allows global wildcard grant to call function", async () => {
    const { options } = createSyntheticKernelOptions(4);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          const bridge = createObserveBridge({ runtime });
          const runId = "run_bridge_global_call";
          yield* runtime.prepareRun(syntheticRunConfig(runId));

          return yield* bridge.callFunction({
            caller: callerWithScopes("global", ["*"]),
            envelope: {
              callId: "call_global",
              runId,
              scope: systemPauseSetPresentationScope,
              payload: { whilePaused: "slate", slateAssetId: "bridge-asset" }
            }
          });
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("allows bridge:board:* grant to subscribe board", async () => {
    const { options } = createSyntheticKernelOptions(4);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          const bridge = createObserveBridge({ runtime });
          const runId = "run_bridge_board_prefix_sub";
          yield* runtime.prepareRun(syntheticRunConfig(runId));

          const subscription = yield* bridge.subscribeBoard({
            caller: callerWithScopes("board-operator", ["bridge:board:*"]),
            runId,
            listener: () => {}
          });

          yield* subscription.unsubscribe();
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("denies bridge:board:* grant from reading artifacts", async () => {
    const exit = await Effect.runPromiseExit(
      evaluateBridgeAuthorization(
        callerWithScopes("board-operator", ["bridge:board:*"]),
        bridgeArtifactReadScope
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain(bridgeArtifactReadScope);
    }
  });

  it("allows capture:browser:* grant to call browser function", async () => {
    const exit = await Effect.runPromiseExit(
      evaluateBridgeAuthorization(
        callerWithScopes("browser-operator", ["capture:browser:*"]),
        browserCaptureClearCropScope
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("denies revoked grants", async () => {
    const exit = await Effect.runPromiseExit(
      evaluateBridgeAuthorization(
        callerWithScopes("reader", [bridgeBoardReadScope], { revoked: true }),
        bridgeBoardReadScope
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("denies expired grants", async () => {
    const exit = await Effect.runPromiseExit(
      evaluateBridgeAuthorization(
        callerWithScopes("reader", [bridgeBoardReadScope], { expiresAt: Date.now() - 1 }),
        bridgeBoardReadScope
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("does not call runtime when callFunction authorization fails", async () => {
    const { options } = createSyntheticKernelOptions(4);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          let callFunctionCalled = false;
          const wrappedRuntime = {
            ...runtime,
            callFunction: (envelope: import("#index.js").ControlCallEnvelope) => {
              callFunctionCalled = true;
              return runtime.callFunction(envelope);
            }
          };
          const bridge = createObserveBridge({ runtime: wrappedRuntime });
          const runId = "run_bridge_call_denied";
          yield* runtime.prepareRun(syntheticRunConfig(runId));

          const denied = yield* Effect.exit(
            bridge.callFunction({
              caller: callerWithScopes("reader", [bridgeBoardReadScope]),
              envelope: {
                callId: "call_denied_runtime",
                runId,
                scope: systemPauseSetPresentationScope,
                payload: { whilePaused: "slate", slateAssetId: "bridge-asset" }
              }
            })
          );

          return { denied, callFunctionCalled };
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(Exit.isFailure(exit.value.denied)).toBe(true);
      expect(exit.value.callFunctionCalled).toBe(false);
    }
  });
});

const bridgeSessionInit = {
  package: "observe" as const,
  chain: "eip155:31337",
  contracts: { marketRegistry: "0x00000000000000000000000000000000000000aa" },
  wallet: {
    chain: "eip155:31337",
    seed: "0xseed",
    walletInit: { chain: "evm" as const, seedSource: "raw" as const, config: {} as never },
    operatorAddress: "0x0000000000000000000000000000000000000001"
  },
  hostUrl: "http://127.0.0.1:8787"
};

const openBridgeConsole = (
  runId: string,
  onRegister?: () => void,
  defaults?: Record<string, unknown>
) =>
  Effect.gen(function* () {
    const runtime = yield* createObserveRuntime({
      sessionInit: bridgeSessionInit,
      ...(defaults === undefined ? {} : { defaultKernelOptions: defaults as never })
    });
    const runHooks: SystemRunHooks = {
      // No hardcoded Host: hooks resolve retained-then-session context canonically.
      prepare: (id, obs) =>
        runtime.prepareConfiguredRun(id, {
          ...(obs === undefined ? {} : { obsId: obs })
        }),
      start: (id, obs) => runtime.startRun(id, undefined, obs),
      await: (id, obs) => runtime.awaitRun(id, obs)
    };
    const run = yield* makeObserveRun(shellRunConfig(runId));
    const mounted = yield* mountObserveT0Bus(run, {
      sessionInit: bridgeSessionInit,
      runHooks,
      market: {
        resolveRegistrar: () =>
          Effect.succeed(
            createFakeMarketRegistrar({
              ...(onRegister === undefined ? {} : { onRegister: () => onRegister() })
            })
          )
      }
    });
    yield* runtime.store.put(mounted);
    const bridge = createObserveBridge({
      runtime,
      sessionInit: bridgeSessionInit,
      hostBaseUrl: "http://127.0.0.1:8787"
    });
    const addObservation = (title: string) =>
      Effect.gen(function* () {
        const before = readObservationIndex(yield* runtime.readBoard(runId));
        yield* bridge.callConsoleAction({
          caller: trustedCaller,
          runId,
          action: "configure",
          args: { title, chain: "eip155:31337" }
        });
        const after = readObservationIndex(yield* runtime.readBoard(runId));
        return Object.keys(after).find((id) => before[id] === undefined)!;
      });
    return { runtime, bridge, addObservation };
  });

describe("ObserveBridge descriptor agreement and authoritative start", () => {

  it("rejects an action that disagrees with its descriptor id", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const { bridge, addObservation } = yield* openBridgeConsole("run_bridge_agree");
          const obsId = yield* addObservation("Agree Show");
          return yield* bridge.callConsoleAction({
            caller: trustedCaller,
            runId: "run_bridge_agree",
            action: "goLive",
            args: {},
            id: `observe.obs.${obsId}.market.register`
          });
        })
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain("disagrees with descriptor id");
    }
  });

  it("rejects a malformed descriptor id instead of falling back to the action", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const { bridge, addObservation } = yield* openBridgeConsole("run_bridge_malformed");
          yield* addObservation("Malformed Show");
          return yield* bridge.callConsoleAction({
            caller: trustedCaller,
            runId: "run_bridge_malformed",
            action: "configure",
            args: { title: "x", chain: "eip155:31337" },
            id: "not-a-descriptor"
          });
        })
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain("Malformed observe descriptor id");
    }
  });

  it("rejects a function the cell does not advertise", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const { bridge, addObservation } = yield* openBridgeConsole("run_bridge_unknown_fn");
          const obsId = yield* addObservation("Unknown Fn Show");
          return yield* bridge.callConsoleAction({
            caller: trustedCaller,
            runId: "run_bridge_unknown_fn",
            action: "bogus",
            args: {},
            id: `observe.obs.${obsId}.capture.bogus`
          });
        })
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain("does not advertise function");
    }
  });

  it("start re-prepares a demoted board instead of trusting the composite flag", async () => {
    let registerCalls = 0;
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runId = "run_bridge_restart";
          const { runtime, bridge, addObservation } = yield* openBridgeConsole(runId, () => {
            registerCalls += 1;
          });
          const obsId = yield* addObservation("Restart Show");

          // Ingest capture (idles with no POSTs) + live publish, through the public verbs.
          yield* runtime.callFunction({
            callId: "kind-1",
            runId,
            scope: systemConfigCaptureKindScope,
            payload: { obsId, kind: "ingest" }
          });
          yield* runtime.callFunction({
            callId: "cap-1",
            runId,
            cellId: observationCellId(obsId, "capture"),
            scope: ingestCaptureConfigureScope,
            payload: { port: 48801, width: 16, height: 16, fps: 30 }
          });
          yield* runtime.callFunction({
            callId: "sink-1",
            runId,
            cellId: observationCellId(obsId, "publish"),
            scope: liveSinkConfigureScope,
            payload: {}
          });

          // Console prepare registers once; console start runs the worker (idles).
          yield* bridge.callConsoleAction({
            caller: trustedCaller,
            runId,
            action: "prepare",
            args: {},
            id: `observe.obs.${obsId}.run.prepare`
          });
          expect(registerCalls).toBe(1);
          const marketBefore = (yield* runtime.readBoard(runId)).cells[
            observationCellId(obsId, "market")
          ]?.readonly?.marketId;
          yield* bridge.callConsoleAction({
            caller: trustedCaller,
            runId,
            action: "start",
            args: {},
            id: `observe.obs.${obsId}.run.start`
          });

          // Stop, then a pipeline change demotes the board flag; the composite stays stale-true.
          // (Reconfiguring mid-run is refused — the admission gate above proves it.)
          yield* runtime.stopRun(runId, { reason: "reconfigure" }, obsId);
          yield* runtime.callFunction({
            callId: "cap-2",
            runId,
            cellId: observationCellId(obsId, "capture"),
            scope: ingestCaptureConfigureScope,
            payload: { port: 48802, width: 16, height: 16, fps: 30 }
          });
          const demoted = yield* runtime.readBoard(runId);
          expect(readBoardRunPrepared(demoted, obsId)).toBe(false);

          // Bridge start re-prepares (no second registration, same market) and restarts.
          yield* bridge.callConsoleAction({
            caller: trustedCaller,
            runId,
            action: "start",
            args: {},
            id: `observe.obs.${obsId}.run.start`
          });
          // The restarted worker acknowledges start (an idling ingest worker commits no
          // snapshots until frames flow, so `starting` — not `running` — is the stable signal).
          const final = yield* waitForBoard(
            () => runtime.readBoard(runId),
            (board) => board.cells[observationCellId(obsId, "run")]?.status[0] === "starting"
          );
          expect(registerCalls).toBe(1);
          expect(final.cells[observationCellId(obsId, "market")]?.readonly?.marketId).toBe(
            marketBefore
          );
          yield* runtime.stopRun(runId, { reason: "cleanup" }, obsId);
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

describe("ObserveBridge hook lifecycle suppression", () => {
  it("await after terminal completion replays nothing; await after restart sees the successor", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const cellId = observationCellId;
          const runId = "run_bridge_await";
          const { runtime, bridge, addObservation } = yield* openBridgeConsole(runId);
          const obsId = yield* addObservation("Await Show");
          yield* runtime.callFunction({
            callId: "kind-1",
            runId,
            scope: systemConfigCaptureKindScope,
            payload: { obsId, kind: "ingest" }
          });
          yield* runtime.callFunction({
            callId: "cap-1",
            runId,
            cellId: cellId(obsId, "capture"),
            scope: ingestCaptureConfigureScope,
            payload: { port: 48821, width: 16, height: 16, fps: 30 }
          });
          yield* runtime.callFunction({
            callId: "sink-1",
            runId,
            cellId: cellId(obsId, "publish"),
            scope: liveSinkConfigureScope,
            payload: {}
          });
          yield* bridge.callConsoleAction({
            caller: trustedCaller,
            runId,
            action: "prepare",
            args: {},
            id: `observe.obs.${obsId}.run.prepare`
          });
          yield* bridge.callConsoleAction({
            caller: trustedCaller,
            runId,
            action: "start",
            args: {},
            id: `observe.obs.${obsId}.run.start`
          });
          yield* runtime.stopRun(runId, { reason: "await test" }, obsId);

          // Await on the terminal run: no stale patch replayed, receipt truthful.
          const first = yield* runtime.callFunction({
            callId: "await-1",
            runId,
            cellId: cellId(obsId, "run"),
            scope: systemRunAwaitScope
          });
          expect(first.changed).toBe(false);
          expect(
            (yield* runtime.readBoard(runId)).cells[cellId(obsId, "run")]?.status[0]
          ).toBe("stopped");

          // Restart, then await the RUNNING successor in a fiber: it must block (no stale
          // immediate return of the old terminal), then resolve with the successor terminal
          // without replaying anything stale onto the board.
          yield* bridge.callConsoleAction({
            caller: trustedCaller,
            runId,
            action: "start",
            args: {},
            id: `observe.obs.${obsId}.run.start`
          });
          const awaiting = yield* Effect.fork(
            runtime.callFunction({
              callId: "await-2",
              runId,
              cellId: cellId(obsId, "run"),
              scope: systemRunAwaitScope
            })
          );
          yield* Effect.sleep(500);
          expect(yield* Fiber.poll(awaiting).pipe(Effect.map(Option.isSome))).toBe(false);
          yield* runtime.stopRun(runId, { reason: "cleanup" }, obsId);
          const second = yield* Fiber.join(awaiting);
          expect(second.changed).toBe(false);
          expect(
            (yield* runtime.readBoard(runId)).cells[cellId(obsId, "run")]?.status[0]
          ).toBe("stopped");
          return true;
        })
      )
    );
    if (Exit.isFailure(exit)) {
      console.log("AWAIT-CAUSE:", String(exit.cause).slice(0, 900));
    }
    expect(Exit.isSuccess(exit)).toBe(true);
  });
});

describe("ObserveBridge canonical hook preparation and host context", () => {
  it("wired-hook reprepare rederives canonical inputs instead of certifying cached config", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runId = "run_bridge_hook_rederive";
          const { runtime, bridge, addObservation } = yield* openBridgeConsole(runId);
          const obsId = yield* addObservation("Hook Show");
          const key = `${runId}#${obsId}`;
          const setupCapture = (port: number) =>
            Effect.gen(function* () {
              yield* runtime.callFunction({
                callId: `kind-${port}`,
                runId,
                scope: systemConfigCaptureKindScope,
                payload: { obsId, kind: "ingest" }
              });
              yield* runtime.callFunction({
                callId: `cap-${port}`,
                runId,
                cellId: observationCellId(obsId, "capture"),
                scope: ingestCaptureConfigureScope,
                payload: { port, width: 16, height: 16, fps: 30 }
              });
              yield* runtime.callFunction({
                callId: `sink-${port}`,
                runId,
                cellId: observationCellId(obsId, "publish"),
                scope: liveSinkConfigureScope,
                payload: {}
              });
            });
          yield* setupCapture(48841);
          yield* bridge.callConsoleAction({
            caller: trustedCaller,
            runId,
            action: "prepare",
            args: {},
            id: `observe.obs.${obsId}.run.prepare`
          });
          const firstPort = (
            (yield* runtime.store.require(key)).config.capture.config as Record<string, unknown>
          ).port;
          expect(firstPort).toBe(48841);

          // Canonical change demotes; the wired hook must rederive (not certify cached).
          yield* setupCapture(48842);
          yield* runtime.callFunction({
            callId: "hook-reprepare",
            runId,
            cellId: observationCellId(obsId, "run"),
            scope: "system:run:prepare"
          });
          const stored = yield* runtime.store.require(key);
          expect(stored.prepared).toBe(true);
          expect((stored.config.capture.config as Record<string, unknown>).port).toBe(48842);
          return true;
        })
      )
    );
    if (Exit.isFailure(exit)) {
      console.log("HOOK-CAUSE:", String(exit.cause).slice(0, 900));
    }
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("retains explicit host context per family; failures do not poison; removal clears", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runId = "run_bridge_hostctx";
          const { runtime, addObservation } = yield* openBridgeConsole(runId);
          const obsId = yield* addObservation("Host Show");
          const key = `${runId}#${obsId}`;
          const setupDirect = () =>
            Effect.gen(function* () {
              yield* runtime.callFunction({
                callId: `kind-d`,
                runId,
                scope: systemConfigCaptureKindScope,
                payload: { obsId, kind: "ingest" }
              });
              yield* runtime.callFunction({
                callId: `cap-d`,
                runId,
                cellId: observationCellId(obsId, "capture"),
                scope: ingestCaptureConfigureScope,
                payload: { port: 48843, width: 16, height: 16, fps: 30 }
              });
              yield* runtime.callFunction({
                callId: `pkind-d`,
                runId,
                scope: systemConfigPublishKindScope,
                payload: { obsId, kind: "direct" }
              });
              yield* runtime.callFunction({
                callId: `sink-d`,
                runId,
                cellId: observationCellId(obsId, "publish"),
                scope: directSinkConfigureScope,
                payload: {}
              });
            });
          yield* setupDirect();
          const hostOf = (config: unknown) =>
            ((config as { sink: { config: Record<string, unknown> } }).sink.config.hostBaseUrl);

          // Explicit URL differing from the session default stays selected.
          yield* runtime.prepareConfiguredRun(runId, {
            hostBaseUrl: "http://127.0.0.1:9999",
            obsId
          });
          expect(hostOf((yield* runtime.store.require(key)).config)).toBe(
            "http://127.0.0.1:9999"
          );

          // Hook reprepare (no explicit URL) reuses the retained context, not the default.
          yield* runtime.callFunction({
            callId: "hook-reprepare-host",
            runId,
            cellId: observationCellId(obsId, "run"),
            scope: "system:run:prepare"
          });
          expect(hostOf((yield* runtime.store.require(key)).config)).toBe(
            "http://127.0.0.1:9999"
          );

          // Failed reprepare with a bogus URL does not poison the retained context.
          const bogus = yield* Effect.exit(
            runtime.prepareConfiguredRun(runId, { hostBaseUrl: "bogus", obsId })
          );
          expect(Exit.isFailure(bogus)).toBe(true);
          yield* runtime.callFunction({
            callId: "hook-reprepare-again",
            runId,
            cellId: observationCellId(obsId, "run"),
            scope: "system:run:prepare"
          });
          expect(hostOf((yield* runtime.store.require(key)).config)).toBe(
            "http://127.0.0.1:9999"
          );
          return true;
        })
      )
    );
    if (Exit.isFailure(exit)) {
      console.log("HOSTCTX-CAUSE:", String(exit.cause).slice(0, 900));
    }
    expect(Exit.isSuccess(exit)).toBe(true);
  });
});

describe("ObserveBridge real hook start", () => {
  it("wired start hook resolves drivers like public start", async () => {
    const attached: { streamId: unknown }[] = [];
    const liveDouble = {
      descriptor: {
        kind: "publish",
        id: "live",
        version: "0.1.0",
        displayName: "live hook double",
        summary: "Test double.",
        capabilityScopes: [],
        flags: [],
        commands: [],
        mode: "file",
        requiresHost: false,
        debugOnly: true
      },
      mode: "file",
      validate: (sinkConfig: unknown) => Effect.succeed(sinkConfig),
      describeControl: () =>
        Effect.succeed({
          id: "sink:live",
          cell: {
            label: "Live",
            catalog: "sink:live",
            status: ["idle", null, Date.now()] as [string, null, number],
            settings: {},
            readonly: {},
            functions: []
          }
        }),
      attach: (sinkConfig: unknown) =>
        Effect.sync(() => {
          attached.push({
            streamId: (sinkConfig as Record<string, unknown>).streamId
          });
          return {
            id: "live-attached",
          deliver: () => Effect.void,
          finalize: Effect.succeed({ deliveredItems: 0, output: { kind: "memory" as const } }),
          health: Effect.succeed({
            stage: "publish" as const,
            descriptorId: "live-attached",
            status: "running" as const,
            updatedAtMs: Date.now(),
            deliveredItems: 0
          }),
          detach: Effect.void
          };
        })
    };
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runId = "run_bridge_hook_start";
          const { runtime, bridge, addObservation } = yield* openBridgeConsole(
            runId,
            undefined,
            { sinkDriver: liveDouble }
          );
          const obsId = yield* addObservation("Hook Start Show");
          yield* runtime.callFunction({
            callId: "kind-1",
            runId,
            scope: systemConfigCaptureKindScope,
            payload: { obsId, kind: "ingest" }
          });
          yield* runtime.callFunction({
            callId: "cap-1",
            runId,
            cellId: observationCellId(obsId, "capture"),
            scope: ingestCaptureConfigureScope,
            payload: { port: 48861, width: 16, height: 16, fps: 30 }
          });
          yield* runtime.callFunction({
            callId: "sink-1",
            runId,
            cellId: observationCellId(obsId, "publish"),
            scope: liveSinkConfigureScope,
            payload: {}
          });
          yield* bridge.callConsoleAction({
            caller: trustedCaller,
            runId,
            action: "prepare",
            args: {},
            id: `observe.obs.${obsId}.run.prepare`
          });
          // Wired hook start (not public startRun): same canonical admitted path.
          const started = yield* Effect.exit(
            runtime.callFunction({
              callId: "hook-start",
              runId,
              cellId: observationCellId(obsId, "run"),
              scope: "system:run:start"
            })
          );
          expect(Exit.isSuccess(started)).toBe(true);
          // Attach lands in the forked worker fiber: poll for it.
          yield* Effect.gen(function* () {
            const deadline = Date.now() + 10000;
            for (;;) {
              if (attached.length >= 1) return;
              if (Date.now() >= deadline) {
                return yield* Effect.fail(new Error("live attach never landed"));
              }
              yield* Effect.sleep(100);
            }
          });
          expect(attached.length).toBe(1);
          expect(attached[0]!.streamId).toBe(
            (yield* runtime.readBoard(runId)).cells[observationCellId(obsId, "market")]?.readonly
              ?.marketId
          );
          yield* runtime.stopRun(runId, { reason: "cleanup" }, obsId);
          return true;
        })
      )
    );
    if (Exit.isFailure(exit)) {
      console.log("HOOKSTART-CAUSE:", String(exit.cause).slice(0, 900));
    }
    expect(Exit.isSuccess(exit)).toBe(true);
  });
});

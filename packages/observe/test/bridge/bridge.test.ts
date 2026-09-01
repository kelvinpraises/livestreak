import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
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
  // eslint-disable-next-line unicorn/no-null -- passthrough signal
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
      expect(exit.value.cells["system:run"]?.status[0]).toBe("prepared");
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
      expect(exit.value.board.cells["system:run"]?.status[0]).toBe("prepared");
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

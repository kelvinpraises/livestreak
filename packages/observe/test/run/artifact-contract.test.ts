import { describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Option } from "effect";
import {
  isLiveStreakError,
  serializeUnknownError,
  type SerializedError
} from "@livestreak/core";
import {
  bridgeArtifactReadScope,
  bridgeBoardReadScope,
  browserCaptureInspectTargetsScope,
  createCapabilityGrant,
  createObserveBridge,
  createObserveRuntime,
  projectControlPanelControls,
  type BridgeCaller,
  type CapabilityScope,
  type ControlCallResult,
  type ObserveRunConfig
} from "#index.js";
import {
  createBrowserRuntimeKernelOptions,
  waitForBrowserPreviewCall
} from "#test/helpers/browser-runtime.js";
import { createSyntheticKernelOptions } from "#test/helpers/runtime.js";
import { syntheticCaptureRunConfig } from "#test/helpers/run-config.js";

const opaqueArtifactIdPattern = /^art_[0-9a-f-]{36}$/i;
const trustedCaller: BridgeCaller = { id: "trusted-artifact-contract", trusted: true };

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

const configErrorFromExit = (exit: Exit.Exit<unknown, unknown>): string | undefined => {
  if (Exit.isFailure(exit) === false) {
    return undefined;
  }

  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure) && isLiveStreakError(failure.value)) {
    return failure.value.message;
  }

  return exit.cause.toString();
};

const serializedFromExit = (exit: Exit.Exit<unknown, unknown>): SerializedError | undefined => {
  if (Exit.isFailure(exit) === false) {
    return undefined;
  }

  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) {
    return undefined;
  }

  return serializeUnknownError(failure.value);
};

describe("artifact contract", () => {
  describe("runtime", () => {
    it("assigns opaque art_<uuid> ids and returns distinct ids per artifact", async () => {
      const { options } = createBrowserRuntimeKernelOptions(64);
      const runId = "run_artifact_opaque_ids";
      const config = makeBrowserObserveRunConfig(runId, `/tmp/${runId}.mp4`);

      const exit = await Effect.runPromiseExit(
        Effect.scoped(
          Effect.gen(function* () {
            const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
            yield* runtime.prepareRun(config);
            yield* runtime.startRun(runId);

            const first = yield* waitForBrowserPreviewCall(() =>
              runtime.callFunction({
                callId: "call_artifact_first",
                runId,
                scope: browserCaptureInspectTargetsScope
              })
            );
            const second = yield* waitForBrowserPreviewCall(() =>
              runtime.callFunction({
                callId: "call_artifact_second",
                runId,
                scope: browserCaptureInspectTargetsScope
              })
            );

            return { first, second };
          })
        )
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.first.artifactId).toMatch(opaqueArtifactIdPattern);
        expect(exit.value.second.artifactId).toMatch(opaqueArtifactIdPattern);
        expect(exit.value.first.artifactId).not.toBe(exit.value.second.artifactId);
      }
    });

    it("getArtifact returns the stored artifact for a valid id", async () => {
      const { options } = createBrowserRuntimeKernelOptions(64);
      const runId = "run_artifact_fetch";
      const config = makeBrowserObserveRunConfig(runId, `/tmp/${runId}.mp4`);

      const exit = await Effect.runPromiseExit(
        Effect.scoped(
          Effect.gen(function* () {
            const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
            yield* runtime.prepareRun(config);
            yield* runtime.startRun(runId);

            const preview = yield* waitForBrowserPreviewCall(() =>
              runtime.callFunction({
                callId: "call_artifact_fetch",
                runId,
                scope: browserCaptureInspectTargetsScope
              })
            );

            const artifactId = preview.artifactId;
            if (artifactId === undefined) {
              return yield* Effect.fail(new Error("expected artifact id"));
            }

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

    it("getArtifact fails with config error for missing artifact id", async () => {
      const { options } = createSyntheticKernelOptions(4);
      const runId = "run_artifact_missing";

      const exit = await Effect.runPromiseExit(
        Effect.scoped(
          Effect.gen(function* () {
            const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
            yield* runtime.prepareRun(syntheticCaptureRunConfig(runId, "/tmp/out.mp4"));
            return yield* runtime.getArtifact(runId, "art_missing");
          })
        )
      );

      expect(Exit.isFailure(exit)).toBe(true);
      expect(configErrorFromExit(exit)).toContain("Artifact art_missing not found");
    });

    it("getArtifact rejects blank artifact id with config error", async () => {
      const { options } = createSyntheticKernelOptions(4);
      const runId = "run_artifact_blank";

      const exit = await Effect.runPromiseExit(
        Effect.scoped(
          Effect.gen(function* () {
            const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
            yield* runtime.prepareRun(syntheticCaptureRunConfig(runId, "/tmp/out.mp4"));
            return yield* runtime.getArtifact(runId, " ".repeat(3));
          })
        )
      );

      expect(Exit.isFailure(exit)).toBe(true);
      expect(configErrorFromExit(exit)).toBe("artifactId must be a non-empty string");
    });

    it("getArtifact rejects non-string artifact id with config error", async () => {
      const { options } = createSyntheticKernelOptions(4);
      const runId = "run_artifact_non_string";

      const exit = await Effect.runPromiseExit(
        Effect.scoped(
          Effect.gen(function* () {
            const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
            yield* runtime.prepareRun(syntheticCaptureRunConfig(runId, "/tmp/out.mp4"));
            return yield* runtime.getArtifact(runId, 123);
          })
        )
      );

      expect(Exit.isFailure(exit)).toBe(true);
      expect(configErrorFromExit(exit)).toBe("artifactId must be a non-empty string");
    });

    it("getArtifact cannot read an artifact from another run", async () => {
      const { options } = createBrowserRuntimeKernelOptions(64);

      const exit = await Effect.runPromiseExit(
        Effect.scoped(
          Effect.gen(function* () {
            const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });

            yield* runtime.prepareRun(
              makeBrowserObserveRunConfig("run_artifact_iso_a", "/tmp/run_artifact_iso_a.mp4")
            );
            yield* runtime.prepareRun(
              makeBrowserObserveRunConfig("run_artifact_iso_b", "/tmp/run_artifact_iso_b.mp4")
            );
            yield* runtime.startRun("run_artifact_iso_a");
            yield* runtime.startRun("run_artifact_iso_b");

            const preview = yield* waitForBrowserPreviewCall(() =>
              runtime.callFunction({
                callId: "call_artifact_iso",
                runId: "run_artifact_iso_a",
                scope: browserCaptureInspectTargetsScope
              })
            );

            const artifactId = preview.artifactId;
            if (artifactId === undefined) {
              return yield* Effect.fail(new Error("expected artifact id"));
            }

            const crossRunExit = yield* Effect.exit(
              runtime.getArtifact("run_artifact_iso_b", artifactId)
            );

            return { artifactId, crossRunExit };
          })
        )
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(Exit.isFailure(exit.value.crossRunExit)).toBe(true);
        expect(configErrorFromExit(exit.value.crossRunExit)).toContain(
          `Artifact ${exit.value.artifactId} not found for run run_artifact_iso_b`
        );
      }
    });
  });

  describe("bridge", () => {
    it("allows trusted caller to fetch artifact by id", async () => {
      const { options } = createBrowserRuntimeKernelOptions(64);
      const runId = "run_bridge_artifact_fetch";

      const exit = await Effect.runPromiseExit(
        Effect.scoped(
          Effect.gen(function* () {
            const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
            const bridge = createObserveBridge({ runtime });
            yield* runtime.prepareRun(makeBrowserObserveRunConfig(runId, `/tmp/${runId}.mp4`));
            yield* runtime.startRun(runId);

            const preview = yield* waitForBrowserPreviewCall(() =>
              bridge.callFunction({
                caller: trustedCaller,
                envelope: {
                  callId: "call_bridge_artifact_fetch",
                  runId,
                  scope: browserCaptureInspectTargetsScope
                }
              })
            );

            const artifactId = preview.artifactId;
            if (artifactId === undefined) {
              return yield* Effect.fail(new Error("expected artifact id"));
            }

            const artifact = yield* bridge.getArtifact({
              caller: trustedCaller,
              runId,
              artifactId
            });

            return { preview, artifact };
          })
        )
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.artifact).toEqual(exit.value.preview.artifact);
      }
    });

    it("denies artifact read without bridge:artifact:read before reaching runtime", async () => {
      const exit = await Effect.runPromiseExit(
        Effect.scoped(
          Effect.gen(function* () {
            const runtime = yield* createObserveRuntime();
            let getArtifactCalled = false;
            const wrappedRuntime = {
              ...runtime,
              getArtifact: (subscribedRunId: string, artifactId: unknown) => {
                getArtifactCalled = true;
                return runtime.getArtifact(subscribedRunId, artifactId);
              }
            };
            const bridge = createObserveBridge({ runtime: wrappedRuntime });

            const denied = yield* Effect.exit(
              bridge.getArtifact({
                caller: callerWithScopes("reader", [bridgeBoardReadScope]),
                runId: "run_any",
                artifactId: "art_any"
              })
            );

            return { denied, getArtifactCalled };
          })
        )
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(Exit.isFailure(exit.value.denied)).toBe(true);
        if (Exit.isFailure(exit.value.denied)) {
          expect(exit.value.denied.cause.toString()).toContain("LiveStreakCapabilityError");
          expect(exit.value.denied.cause.toString()).toContain(bridgeArtifactReadScope);
        }
        expect(exit.value.getArtifactCalled).toBe(false);
      }
    });

    it("validates caller authorization before blank artifact id input", async () => {
      const exit = await Effect.runPromiseExit(
        Effect.scoped(
          Effect.gen(function* () {
            const runtime = yield* createObserveRuntime();
            let getArtifactCalled = false;
            const wrappedRuntime = {
              ...runtime,
              getArtifact: (subscribedRunId: string, artifactId: unknown) => {
                getArtifactCalled = true;
                return runtime.getArtifact(subscribedRunId, artifactId);
              }
            };
            const bridge = createObserveBridge({ runtime: wrappedRuntime });

            const deniedBlank = yield* Effect.exit(
              bridge.getArtifact({
                caller: callerWithScopes("reader", [bridgeBoardReadScope]),
                runId: "run_any",
                artifactId: " ".repeat(3)
              })
            );

            return { deniedBlank, getArtifactCalled };
          })
        )
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(Exit.isFailure(exit.value.deniedBlank)).toBe(true);
        if (Exit.isFailure(exit.value.deniedBlank)) {
          expect(exit.value.deniedBlank.cause.toString()).toContain("LiveStreakCapabilityError");
        }
        expect(exit.value.getArtifactCalled).toBe(false);
      }
    });

    it("rejects non-string artifact id after authorization for trusted callers", async () => {
      const exit = await Effect.runPromiseExit(
        Effect.scoped(
          Effect.gen(function* () {
            const runtime = yield* createObserveRuntime();
            const bridge = createObserveBridge({ runtime });

            return yield* bridge.getArtifact({
              caller: trustedCaller,
              runId: "run_any",
              artifactId: 123
            });
          })
        )
      );

      expect(Exit.isFailure(exit)).toBe(true);
      expect(configErrorFromExit(exit)).toBe("artifactId must be a non-empty string");
    });

    it("validates caller authorization before non-string artifact id input", async () => {
      const exit = await Effect.runPromiseExit(
        Effect.scoped(
          Effect.gen(function* () {
            const runtime = yield* createObserveRuntime();
            let getArtifactCalled = false;
            const wrappedRuntime = {
              ...runtime,
              getArtifact: (subscribedRunId: string, artifactId: unknown) => {
                getArtifactCalled = true;
                return runtime.getArtifact(subscribedRunId, artifactId);
              }
            };
            const bridge = createObserveBridge({ runtime: wrappedRuntime });

            const deniedNumeric = yield* Effect.exit(
              bridge.getArtifact({
                caller: callerWithScopes("reader", [bridgeBoardReadScope]),
                runId: "run_any",
                artifactId: 123
              })
            );

            return { deniedNumeric, getArtifactCalled };
          })
        )
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(Exit.isFailure(exit.value.deniedNumeric)).toBe(true);
        if (Exit.isFailure(exit.value.deniedNumeric)) {
          expect(exit.value.deniedNumeric.cause.toString()).toContain("LiveStreakCapabilityError");
        }
        expect(exit.value.getArtifactCalled).toBe(false);
      }
    });
  });

  describe("subscriptions", () => {
    it("scopes artifact subscriptions to each run", async () => {
      const { options } = createBrowserRuntimeKernelOptions(64);

      const exit = await Effect.runPromiseExit(
        Effect.scoped(
          Effect.gen(function* () {
            const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });

            yield* runtime.prepareRun(
              makeBrowserObserveRunConfig("run_artifact_sub_a", "/tmp/run_artifact_sub_a.mp4")
            );
            yield* runtime.prepareRun(
              makeBrowserObserveRunConfig("run_artifact_sub_b", "/tmp/run_artifact_sub_b.mp4")
            );
            yield* runtime.startRun("run_artifact_sub_a");
            yield* runtime.startRun("run_artifact_sub_b");

            const seenA: string[] = [];
            const seenB: string[] = [];

            yield* runtime.subscribeArtifacts("run_artifact_sub_a", (artifact) => {
              seenA.push(artifact.id);
            });
            yield* runtime.subscribeArtifacts("run_artifact_sub_b", (artifact) => {
              seenB.push(artifact.id);
            });

            const preview = yield* waitForBrowserPreviewCall(() =>
              runtime.callFunction({
                callId: "call_artifact_sub_a_only",
                runId: "run_artifact_sub_a",
                scope: browserCaptureInspectTargetsScope
              })
            );

            return { seenA, seenB, preview };
          })
        )
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.seenA).toEqual([exit.value.preview.artifactId]);
        expect(exit.value.seenB).toEqual([]);
      }
    });

    it("stops artifact notifications after unsubscribe", async () => {
      const { options } = createBrowserRuntimeKernelOptions(64);
      const runId = "run_artifact_sub_unsub";
      const config = makeBrowserObserveRunConfig(runId, `/tmp/${runId}.mp4`);

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
        expect(exit.value.seen).toEqual([exit.value.first.artifactId]);
      }
    });

    it("does not register artifact listener when bridge caller is denied", async () => {
      const { options } = createBrowserRuntimeKernelOptions(4);
      const runId = "run_bridge_artifact_sub_denied_contract";

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
            yield* runtime.prepareRun(makeBrowserObserveRunConfig(runId, `/tmp/${runId}.mp4`));
            yield* runtime.startRun(runId);

            const denied = yield* Effect.exit(
              bridge.subscribeArtifacts({
                caller: callerWithScopes("reader", [bridgeBoardReadScope]),
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
  });

  describe("serialization", () => {
    it("serializes missing artifact errors as config shortName without cause or stack", async () => {
      const { options } = createSyntheticKernelOptions(4);
      const runId = "run_artifact_serialize_missing";

      const exit = await Effect.runPromiseExit(
        Effect.scoped(
          Effect.gen(function* () {
            const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
            yield* runtime.prepareRun(syntheticCaptureRunConfig(runId, "/tmp/out.mp4"));
            return yield* runtime.getArtifact(runId, "art_missing");
          })
        )
      );

      const serialized = serializedFromExit(exit);
      expect(serialized).toBeDefined();
      expect(serialized?.shortName).toBe("config");
      expect(serialized?.message).toContain("Artifact art_missing not found");
      expect(Object.hasOwn(serialized!, "cause")).toBe(false);
      expect(Object.hasOwn(serialized!, "stack")).toBe(false);
      expect(() => JSON.stringify(serialized)).not.toThrow();
    });

    it("serializes blank artifact id errors as config shortName", async () => {
      const exit = await Effect.runPromiseExit(
        Effect.scoped(
          Effect.gen(function* () {
            const runtime = yield* createObserveRuntime();
            return yield* runtime.getArtifact("run_any", " ".repeat(3));
          })
        )
      );

      const serialized = serializedFromExit(exit);
      expect(serialized).toBeDefined();
      expect(serialized?.shortName).toBe("config");
      expect(serialized?.message).toBe("artifactId must be a non-empty string");
    });
  });

  describe("read model isolation", () => {
    it("does not embed preview dataUri in Board, Panel, or Controls after artifact creation", async () => {
      const { options } = createBrowserRuntimeKernelOptions(64);
      const runId = "run_artifact_read_model";
      const config = makeBrowserObserveRunConfig(runId, `/tmp/${runId}.mp4`);

      const exit = await Effect.runPromiseExit(
        Effect.scoped(
          Effect.gen(function* () {
            const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
            yield* runtime.prepareRun(config);
            yield* runtime.startRun(runId);

            const preview = yield* waitForBrowserPreviewCall(() =>
              runtime.callFunction({
                callId: "call_artifact_read_model",
                runId,
                scope: browserCaptureInspectTargetsScope
              })
            );

            const previewDataUri = extractPreviewDataUri(preview);
            const board = yield* runtime.readBoard(runId);
            const panel = yield* runtime.readPanel(runId, { includeCatalog: true });
            const controls = projectControlPanelControls(panel);

            return { previewDataUri, board, panel, controls };
          })
        )
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit) && exit.value.previewDataUri !== undefined) {
        const snapshots = [
          JSON.stringify(exit.value.board),
          JSON.stringify(exit.value.panel),
          JSON.stringify(exit.value.controls)
        ];

        for (const json of snapshots) {
          expect(json).not.toContain(exit.value.previewDataUri);
          expect(json).not.toContain("data:image");
        }
      }
    });

    // Fuller Scenario A coverage lives in test/edge/public-edge-contract.test.ts.
  });
});

const extractPreviewDataUri = (preview: ControlCallResult): string | undefined => {
  const payload = preview.artifact?.payload;
  if (payload === undefined || payload === null || typeof payload !== "object" || !("preview" in payload)) {
    return undefined;
  }

  const dataUri = (payload as { preview?: { dataUri?: string } }).preview?.dataUri;
  return typeof dataUri === "string" ? dataUri : undefined;
};

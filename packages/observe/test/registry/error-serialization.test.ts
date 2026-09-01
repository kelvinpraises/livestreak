import { describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Option } from "effect";
import {
  isLiveStreakError,
  serializeLiveStreakError,
  type LiveStreakError,
  type SerializedLiveStreakError
} from "@livestreak/core";
import {
  bridgeBoardReadScope,
  browserCaptureRunConfig,
  createCapabilityGrant,
  createObserveBridge,
  createObserveRuntime,
  systemPauseSetPresentationScope,
  type BridgeCaller,
  type CapabilityScope
} from "#index.js";
import { createSyntheticKernelOptions } from "#test/helpers/runtime.js";
import { syntheticCaptureRunConfig } from "#test/helpers/run-config.js";

describe("observe error serialization", () => {
  it("serializes missing run readBoard failures as config errors", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime();
          return yield* runtime.readBoard("run_missing_serialize");
        })
      )
    );

    expectSerialized(exit, {
      shortName: "config",
      tag: "LiveStreakConfigError",
      message: "Run run_missing_serialize not found in store"
    });
  });

  it("serializes missing artifact failures as config errors", async () => {
    const { options } = createSyntheticKernelOptions(4);
    const runId = "run_missing_artifact_serialize";

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(syntheticCaptureRunConfig(runId, "/tmp/out.mp4"));
          return yield* runtime.getArtifact(runId, "art_missing");
        })
      )
    );

    expectSerialized(exit, {
      shortName: "config",
      tag: "LiveStreakConfigError"
    });
    const serialized = serializedFromExit(exit);
    expect(serialized?.message).toContain("Artifact art_missing not found");
  });

  it("serializes bridge denied function calls as capability errors with requiredScope", async () => {
    const { options } = createSyntheticKernelOptions(4);
    const runId = "run_bridge_serialize_denied";

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          const bridge = createObserveBridge({ runtime });
          yield* runtime.prepareRun(syntheticCaptureRunConfig(runId, "/tmp/out.mp4"));

          return yield* bridge.callFunction({
            caller: callerWithScopes("reader", [bridgeBoardReadScope]),
            envelope: {
              callId: "call_serialize_denied",
              runId,
              scope: systemPauseSetPresentationScope,
              payload: { whilePaused: "slate", slateAssetId: "asset1" }
            }
          });
        })
      )
    );

    expectSerialized(exit, {
      shortName: "capability",
      tag: "LiveStreakCapabilityError",
      context: { requiredScope: systemPauseSetPresentationScope }
    });
  });

  it("serializes malformed system:pause:setPresentation payloads as config errors", async () => {
    const { options } = createSyntheticKernelOptions(4);
    const runId = "run_bad_set_presentation";

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          yield* runtime.prepareRun(syntheticCaptureRunConfig(runId, "/tmp/out.mp4"));

          return yield* runtime.callFunction({
            callId: "call_bad_presentation",
            runId,
            scope: systemPauseSetPresentationScope,
            payload: { whilePaused: "slate" }
          });
        })
      )
    );

    expectSerialized(exit, {
      shortName: "config",
      tag: "LiveStreakConfigError"
    });
    const serialized = serializedFromExit(exit);
    expect(serialized?.message).toContain("slateAssetId");
  });

  it("serializes browser prepare without injected driver as config errors", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime();
          return yield* runtime.prepareRun(
            browserCaptureRunConfig(
              "run_browser_missing_driver_serialize",
              {
                url: "https://example.com",
                captureFps: 30,
                viewport: { width: 640, height: 480 },
                encoding: "jpeg"
              },
              { path: "/tmp/out.mp4" }
            )
          );
        })
      )
    );

    expectSerialized(exit, {
      shortName: "config",
      tag: "LiveStreakConfigError"
    });
    const serialized = serializedFromExit(exit);
    expect(serialized?.message).toContain('Unknown capture driver "browser"');
  });

  it("serializes blank artifact id failures as config errors", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime();
          return yield* runtime.getArtifact("run_any", " ".repeat(3));
        })
      )
    );

    expectSerialized(exit, {
      shortName: "config",
      tag: "LiveStreakConfigError",
      message: "artifactId must be a non-empty string"
    });
  });

  it("does not leak metadata.cause through observe runtime failures", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime();
          return yield* runtime.readBoard("run_missing_cause_check");
        })
      )
    );

    const serialized = serializedFromExit(exit);
    expect(serialized).toBeDefined();
    expect(Object.hasOwn(serialized!, "cause")).toBe(false);
    expect(() => JSON.stringify(serialized)).not.toThrow();
  });
});

// --- helpers ---

const callerWithScopes = (id: string, scopes: readonly CapabilityScope[]): BridgeCaller => ({
  id,
  grants: [
    createCapabilityGrant({
      id: `${id}-grant`,
      holder: id,
      scopes
    })
  ]
});

const flowStreamErrorFromCause = (cause: Cause.Cause<unknown>): LiveStreakError | undefined => {
  const failure = Cause.failureOption(cause);
  if (Option.isSome(failure) && isLiveStreakError(failure.value)) {
    return failure.value;
  }

  return undefined;
};

const serializedFromExit = (
  exit: Exit.Exit<unknown, unknown>
): SerializedLiveStreakError | undefined => {
  if (Exit.isFailure(exit) === false) {
    return undefined;
  }

  const error = flowStreamErrorFromCause(exit.cause);
  if (error === undefined) {
    return undefined;
  }

  return serializeLiveStreakError(error);
};

const expectSerialized = (
  exit: Exit.Exit<unknown, unknown>,
  expected: Partial<SerializedLiveStreakError>
): void => {
  expect(Exit.isFailure(exit)).toBe(true);
  const serialized = serializedFromExit(exit);
  expect(serialized).toBeDefined();
  expect(serialized).toMatchObject(expected);
  expect(() => JSON.stringify(serialized)).not.toThrow();
};

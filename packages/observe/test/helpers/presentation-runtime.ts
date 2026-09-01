import { Effect } from "effect";
import type { RuntimeKernelOptions } from "#run/runtime.js";
import {
  createFakeLiveCaptureDriver,
  type FakeLiveCaptureCounters,
  type FakeLiveFrameSource
} from "#test/helpers/fake-live-capture.js";
import {
  createPresentationRecordingSinkDriver,
  type PresentationRecordingSinkOptions,
  type PresentationSinkRecording
} from "#test/helpers/presentation-sink.js";

export { makeFakeLiveObserveRun, runStatusIs, waitForBoard } from "#test/helpers/fake-live-runtime.js";

export interface PresentationRuntimeKernelOptions {
  readonly options: RuntimeKernelOptions;
  readonly getCounters: () => FakeLiveCaptureCounters | undefined;
  readonly recording: PresentationSinkRecording;
}

export const createPresentationRuntimeKernelOptions = (
  input: {
    readonly frameCount?: number;
    readonly sink?: PresentationRecordingSinkOptions;
  } = {}
): PresentationRuntimeKernelOptions => {
  const frameCount = input.frameCount ?? 512;
  let counters: FakeLiveCaptureCounters | undefined;
  const baseDriver = createFakeLiveCaptureDriver({
    frameCount,
    yieldEachFrame: true
  });

  const captureDriver = {
    ...baseDriver,
    create: (config: { readonly frameCount: number }) =>
      Effect.gen(function* () {
        const source = (yield* baseDriver.create(config)) as FakeLiveFrameSource;
        counters = source.counters;
        return source;
      })
  };

  const { driver: sinkDriver, recording } = createPresentationRecordingSinkDriver(
    input.sink ?? {}
  );

  return {
    options: {
      captureDriver,
      sinkDriver,
      maxTurns: frameCount * 64
    },
    getCounters: () => counters,
    recording
  };
};

export const waitForRecording = (
  readRecording: () => PresentationSinkRecording,
  predicate: (recording: PresentationSinkRecording) => boolean,
  attempts = 200
): Effect.Effect<PresentationSinkRecording, Error> =>
  Effect.gen(function* () {
    for (let index = 0; index < attempts; index += 1) {
      const recording = readRecording();
      if (predicate(recording)) {
        return recording;
      }

      yield* Effect.yieldNow();
    }

    return yield* Effect.fail(new Error("Timed out waiting for sink recording condition"));
  });

export const yieldWhilePaused = (attempts = 32): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    for (let index = 0; index < attempts; index += 1) {
      yield* Effect.yieldNow();
    }
  });

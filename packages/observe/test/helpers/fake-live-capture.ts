import { Effect, Ref, Stream } from "effect";
import type {
  CaptureDriver,
  CaptureDriverDescriptor,
  CaptureLiveControls,
  CaptureStageHealth,
  FrameSource,
  RawFrame,
  RawFrameCadence
} from "#pipeline/capture/index.js";
import { nowTimePoint } from "@livestreak/schema";

export interface FakeLiveCaptureCounters {
  pauseCalls: number;
  resumeCalls: number;
  emittedFrames: number;
}

export interface FakeLiveCaptureOptions {
  readonly frameCount?: number;
  readonly yieldEachFrame?: boolean;
}

export interface FakeLiveFrameSource extends FrameSource {
  readonly counters: FakeLiveCaptureCounters;
}

export const fakeLiveCaptureDescriptor: CaptureDriverDescriptor = {
  kind: "capture",
  id: "fake-live",
  version: "0.1.0",
  displayName: "Fake Live Capture",
  capabilityScopes: ["capture:fake-live:*"],
  flags: [],
  commands: [],
  sourceType: "synthetic",
  sourceMode: "live"
};

export const createFakeLiveCaptureDriver = (
  options: FakeLiveCaptureOptions = {}
): CaptureDriver<{ readonly frameCount: number }> => {
  const counters: FakeLiveCaptureCounters = {
    pauseCalls: 0,
    resumeCalls: 0,
    emittedFrames: 0
  };

  return {
    descriptor: fakeLiveCaptureDescriptor,
    validate: (config) => Effect.succeed(config),
    describeControl: (_config, context) =>
      Effect.succeed({
        id: "capture:fake-live",
        cell: {
          label: "Fake Live Capture",
          catalog: "capture:fake-live",
           
          status: ["idle", null, context.nowMs ?? Date.now()],
          settings: {},
          readonly: {
            sourceType: "synthetic",
            sourceMode: "live"
          },
          functions: []
        }
      }),
    create: (config) =>
      Effect.gen(function* () {
        const pausedReference = yield* Ref.make(false);
        let revision = 0;

        const readSnapshot = () =>
          Effect.gen(function* () {
            return {
              paused: yield* Ref.get(pausedReference),
              revision
            };
          });

        const controls: CaptureLiveControls = {
          pause: () =>
            Effect.gen(function* () {
              counters.pauseCalls += 1;
              revision += 1;
              yield* Ref.set(pausedReference, true);
              return {
                paused: true,
                revision
              };
            }),
          resume: () =>
            Effect.gen(function* () {
              counters.resumeCalls += 1;
              revision += 1;
              yield* Ref.set(pausedReference, false);
              return {
                paused: false,
                revision
              };
            }),
          snapshot: readSnapshot()
        };

        const frameCount = options.frameCount ?? config.frameCount;
        const frames = Stream.range(0, Math.max(0, frameCount - 1)).pipe(
          Stream.mapEffect((index) =>
            Effect.gen(function* () {
              while (yield* Ref.get(pausedReference)) {
                yield* Effect.yieldNow();
              }

              if (options.yieldEachFrame === true) {
                yield* Effect.yieldNow();
              }

              counters.emittedFrames += 1;
              return makeFrame(index);
            })
          )
        );

        const source: FakeLiveFrameSource = {
          descriptor: fakeLiveCaptureDescriptor,
          frames,
          health: Effect.succeed(makeHealth(frameCount)),
          live: controls,
          counters
        };

        return source;
      })
  };
};

// --- helpers ---

const makeFrame = (index: number): RawFrame => {
  const cadence: RawFrameCadence = {
    mode: "synthetic",
    sequence: index,
    droppedFrames: 0
  };

  return {
    id: `fake-live:${index}`,
    sourceId: "capture:fake-live",
    time: nowTimePoint(index),
    cadence,
    payload: {
      width: 2,
      height: 2,
      byteFormat: "rgba",
      encoding: "raw",
      data: new Uint8Array(16)
    }
  };
};

const makeHealth = (frameCount: number): CaptureStageHealth => ({
  stage: "capture",
  descriptorId: "fake-live",
  status: "running",
  updatedAtMs: Date.now(),
  sourceId: "capture:fake-live",
  frameCount,
  droppedFrames: 0
});

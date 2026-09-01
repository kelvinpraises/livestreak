import { Effect } from "effect";
import type { RuntimeKernelOptions } from "#run/runtime.js";
import type { Board, BoardRunStatus } from "#run/control/board/index.js";
import {
  createFakeLiveCaptureDriver,
  type FakeLiveCaptureCounters,
  type FakeLiveFrameSource
} from "#test/helpers/fake-live-capture.js";
import {
  createMarkerRecordingSinkDriver,
  type MarkerSinkRecording
} from "#test/helpers/marker-sink.js";

export interface FakeLiveRuntimeKernelOptions {
  readonly options: RuntimeKernelOptions;
  readonly getCounters: () => FakeLiveCaptureCounters | undefined;
  readonly recording: MarkerSinkRecording;
}

export const makeFakeLiveObserveRun = (runId: string, outputPath: string) => ({
  runId,
  capture: {
    driverId: "fake-live",
    config: { frameCount: 512 }
  },
  sink: {
    driverId: "memory",
    config: { path: outputPath }
  },
  // eslint-disable-next-line unicorn/no-null -- passthrough signal
  process: null
});

export const waitForBoard = (
  readBoard: () => Effect.Effect<Board, unknown>,
  predicate: (board: Board) => boolean,
  attempts = 200
): Effect.Effect<Board, Error> =>
  Effect.gen(function* () {
    for (let index = 0; index < attempts; index += 1) {
      const board = yield* readBoard().pipe(Effect.mapError(toError));
      if (predicate(board)) {
        return board;
      }

      yield* Effect.yieldNow();
    }

    return yield* Effect.fail(new Error("Timed out waiting for board condition"));
  });

export const runStatusIs = (
  board: Board,
  statuses: readonly BoardRunStatus[]
): boolean => {
  const status = board.cells["system:run"]?.status[0];
  return typeof status === "string" && statuses.includes(status as BoardRunStatus);
};

export const createFakeLiveRuntimeKernelOptions = (
  frameCount = 512
): FakeLiveRuntimeKernelOptions => {
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

  const { driver: sinkDriver, recording } = createMarkerRecordingSinkDriver();

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

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

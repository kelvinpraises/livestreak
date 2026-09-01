import { Chunk, Effect, Option, Scope, Stream } from "effect";
import { LiveStreakRuntimeError, type LiveStreakError } from "@livestreak/core";
import type { CaptureLiveControls, FrameSource, RawFrame } from "#pipeline/capture/index.js";
import type { CaptureStageState } from "./state.js";

export interface CaptureFramePull {
  readonly pullNext: () => Effect.Effect<RawFrame | undefined, LiveStreakError>;
}

export interface CaptureLivePauseStageState {
  readonly controls: CaptureLiveControls;
  paused: boolean;
  appliedBoardRevision?: number;
}

export const createCaptureFramePull = (
  frames: Stream.Stream<RawFrame, LiveStreakError>
): Effect.Effect<CaptureFramePull, never, Scope.Scope> => {
  return Effect.gen(function* () {
    const pullChunk = yield* Stream.toPull(frames);
    const pending: RawFrame[] = [];

    const pullNext = (): Effect.Effect<RawFrame | undefined, LiveStreakError> => {
      return pullNextFrame(pullChunk, pending);
    };

    return {
      pullNext
    };
  });
};

export const createCaptureStageState = (
  source: FrameSource
): Effect.Effect<CaptureStageState, LiveStreakRuntimeError, Scope.Scope> => {
  return Effect.gen(function* () {
    if (source.descriptor.sourceMode === "live" && source.live === undefined) {
      return yield* Effect.fail(
        new LiveStreakRuntimeError({
          message: `Live capture source ${source.descriptor.id} is missing CaptureLiveControls`
        })
      );
    }

    const pull = yield* createCaptureFramePull(source.frames);

    const capture: CaptureStageState = {
      pull,
      descriptor: source.descriptor,
      readHealth: source.health,
      exhausted: false,
      eosAppended: false
    };

    if (source.live !== undefined) {
      capture.livePause = {
        controls: source.live,
        paused: false
      };
    }

    return capture;
  });
};

const pullNextFrame = (
  pullChunk: Effect.Effect<Chunk.Chunk<RawFrame>, Option.Option<LiveStreakError>>,
  pending: RawFrame[]
): Effect.Effect<RawFrame | undefined, LiveStreakError> =>
  Effect.gen(function* () {
    if (pending.length > 0) {
      return pending.shift();
    }

    const chunkOption = yield* pullChunk.pipe(Effect.option);
    if (Option.isNone(chunkOption)) {
      return;
    }

    const chunk = chunkOption.value;
    if (Chunk.isEmpty(chunk)) {
      return;
    }

    const frames = Chunk.toReadonlyArray(chunk);
    const [first, ...rest] = frames;
    pending.push(...rest);
    return first;
  });

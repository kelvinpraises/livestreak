import { Cause, Chunk, Effect, Exit, Fiber, Option, Scope, Stream } from "effect";
import { LiveStreakRuntimeError, type LiveStreakError } from "@livestreak/core";
import type { CaptureLiveControls, FrameSource, RawFrame } from "#pipeline/capture/index.js";
import type { CaptureStageState } from "./state.js";
import type { WorkerBoardWake } from "./wake.js";

export interface CaptureLivePauseStageState {
  readonly controls: CaptureLiveControls;
  paused: boolean;
  appliedBoardRevision?: number;
}

export interface CaptureFramePull {
  readonly pullNext: () => Effect.Effect<RawFrame | undefined, LiveStreakError>;
  /**
   * Control-aware pull, present on pulls built by createCaptureFramePull. Hand-built fakes
   * carry pullNext only and take the legacy path. A wake is NEVER undefined/EOS or exhaustion —
   * it means "reread the board now". Only a genuine stream end (or genuine failure) ends it.
   */
  readonly pullNextAware?: (
    wake: WorkerBoardWake
  ) => Effect.Effect<CapturePullWait, LiveStreakError>;
}

/**
 * Control-aware pull outcome: frame carries the next frame; end means genuine upstream end;
 * wake means reread the board now. Empty upstream chunks are consumed inside the retained
 * pull and never surface as either end or wake.
 */
export type CapturePullWait =
  | { readonly _tag: "frame"; readonly frame: RawFrame }
  | { readonly _tag: "end" }
  | { readonly _tag: "wake" };

export const createCaptureFramePull = (
  frames: Stream.Stream<RawFrame, LiveStreakError>
): Effect.Effect<CaptureFramePull, never, Scope.Scope> => {
  return Effect.gen(function* () {
    const pullChunk = yield* Stream.toPull(frames);
    const scope = yield* Effect.scope;
    const pending: RawFrame[] = [];
    // One interrupt-safe permit serializes BOTH public operations over shared retained state:
    // at most one forked upstream take exists, so there is never a second consumer of
    // pullChunk. The permit releases on wake, success AND caller interruption; the retained
    // upstream fiber itself is never cancelled to serialize callers — only scope closure ends it.
    const permit = yield* Effect.makeSemaphore(1);
    let retained: Fiber.Fiber<Chunk.Chunk<RawFrame>, Option.Option<LiveStreakError>> | undefined;
    let ended = false;

    // Nonempty-chunk read loop INSIDE the retained upstream fiber: empty chunks are skipped
    // with a short interruptible backoff (no hot-spin) so they surface neither as EOS nor as a
    // fake control wake. Genuine end (None) and genuine errors pass through untouched.
    const readNonempty = (): Effect.Effect<
      Chunk.Chunk<RawFrame>,
      Option.Option<LiveStreakError>
    > =>
      Effect.gen(function* () {
        for (;;) {
          const exit = yield* Effect.exit(pullChunk);
          if (exit._tag === "Failure") {
            const failure = Cause.failureOption(exit.cause);
            if (failure._tag === "None") {
              return yield* Effect.failCause(exit.cause);
            }
            return yield* exit;
          }
          if (!Chunk.isEmpty(exit.value)) {
            return exit.value;
          }
          yield* Effect.sleep(5);
        }
      });

    const takeUpstream = (): Effect.Effect<
      Fiber.Fiber<Chunk.Chunk<RawFrame>, Option.Option<LiveStreakError>>,
      never,
      never
    > => {
      if (retained !== undefined) {
        return Effect.succeed(retained);
      }
      return Effect.tap(Effect.forkIn(scope)(readNonempty()), (fiber) =>
        Effect.sync(() => {
          retained = fiber;
        })
      );
    };

    const settleTake = (
      exit: Exit.Exit<Chunk.Chunk<RawFrame>, Option.Option<LiveStreakError>>
    ): Effect.Effect<Chunk.Chunk<RawFrame> | undefined, LiveStreakError> =>
      Effect.gen(function* () {
        retained = undefined;
        if (exit._tag === "Failure") {
          const failure: Option.Option<Option.Option<LiveStreakError>> = Cause.failureOption(
            exit.cause
          );
          if (failure._tag === "None") {
            // Defect/interruption of the take itself — propagate, never report as end.
            return yield* Effect.failCause(exit.cause as Cause.Cause<LiveStreakError>);
          }
          if (failure.value._tag === "None") {
            ended = true;
            return undefined;
          }
          return yield* Effect.fail(failure.value.value);
        }
        return exit.value;
      });

    // Legacy direct pull, preserved for direct callers and lightweight fakes.
    const pullNext = (): Effect.Effect<RawFrame | undefined, LiveStreakError> =>
      permit.withPermits(1)(
        Effect.gen(function* () {
          if (pending.length > 0) {
            return pending.shift();
          }
          if (ended) {
            return undefined;
          }
          const fiber = yield* takeUpstream();
          const chunk = yield* settleTake(yield* Effect.exit(Fiber.join(fiber)));
          if (chunk === undefined) {
            return undefined;
          }
          const list = Chunk.toReadonlyArray(chunk);
          const [first, ...rest] = list;
          pending.push(...rest);
          return first;
        })
      );

    const pullNextAware = (wake: WorkerBoardWake): Effect.Effect<CapturePullWait, LiveStreakError> =>
      permit.withPermits(1)(
        Effect.gen(function* () {
          if (pending.length > 0) {
            return { _tag: "frame" as const, frame: pending.shift()! };
          }
          if (ended) {
            return { _tag: "end" as const };
          }
          const fiber = yield* takeUpstream();
          // Race the retained JOIN (observational — interrupting the loser cannot harm the
          // upstream fiber) against the control wake. Wake winning keeps the fiber retained.
          const outcome = yield* Effect.race(
            Effect.exit(Fiber.join(fiber)),
            Effect.as(wake.waitForWake(), "wake" as const)
          );
          if (outcome === "wake") {
            return { _tag: "wake" as const };
          }
          const chunk = yield* settleTake(outcome);
          if (chunk === undefined) {
            return { _tag: "end" as const };
          }
          const list = Chunk.toReadonlyArray(chunk);
          const [first, ...rest] = list;
          pending.push(...rest);
          return { _tag: "frame" as const, frame: first! };
        })
      );

    return {
      pullNext,
      pullNextAware
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

// O5: Stream.toPull's failure channel is Option<E>: None means the stream ended cleanly
// (EOS), Some(e) is a REAL error (e.g. ffmpeg decode failure mid-stream). settleTake
// inspects the Option so genuine failures propagate (run reaches `failed`) while defects
// and interruptions propagate as themselves — never reported as a clean end.

import { Deferred, Effect, Ref } from "effect";
import type { LiveStreakError } from "@livestreak/core";
import type { CaptureLiveControls, CaptureLivePauseState } from "#pipeline/capture/types.js";

export interface BrowserLivePauseRuntime {
  readonly controls: CaptureLiveControls;
  readonly pausedRef: Ref.Ref<boolean>;
  readonly revisionRef: Ref.Ref<number>;
  readonly resumeGateRef: Ref.Ref<Deferred.Deferred<void, never> | undefined>;
}

export const createBrowserLivePauseRuntime = (): Effect.Effect<BrowserLivePauseRuntime, never> =>
  Effect.gen(function* () {
    const pausedReference = yield* Ref.make(false);
    const revisionReference = yield* Ref.make(0);
    const resumeGateReference = yield* Ref.make<Deferred.Deferred<void, never> | undefined>(
      // eslint-disable-next-line unicorn/no-useless-undefined -- Ref.make requires an initial value
      undefined
    );

    const snapshot = Effect.gen(function* () {
      return {
        paused: yield* Ref.get(pausedReference),
        revision: yield* Ref.get(revisionReference)
      };
    });

    const pause = (): Effect.Effect<CaptureLivePauseState, LiveStreakError> =>
      Effect.gen(function* () {
        yield* Ref.set(pausedReference, true);
        yield* Ref.update(revisionReference, (revision) => revision + 1);
        return yield* snapshot;
      });

    const resume = (): Effect.Effect<CaptureLivePauseState, LiveStreakError> =>
      Effect.gen(function* () {
        yield* Ref.set(pausedReference, false);
        yield* Ref.update(revisionReference, (revision) => revision + 1);

        const resumeGate = yield* Ref.get(resumeGateReference);
        if (resumeGate !== undefined) {
          yield* Ref.set(resumeGateReference, undefined);
          yield* Deferred.succeed(resumeGate, void 0);
        }

        return yield* snapshot;
      });

    const controls: CaptureLiveControls = {
      pause,
      resume,
      snapshot
    };

    return {
      controls,
      pausedRef: pausedReference,
      revisionRef: revisionReference,
      resumeGateRef: resumeGateReference
    };
  });

export const awaitBrowserLiveResume = (
  runtime: BrowserLivePauseRuntime
): Effect.Effect<void, LiveStreakError> =>
  Effect.gen(function* () {
    const paused = yield* Ref.get(runtime.pausedRef);
    if (!paused) {
      return;
    }

    let resumeGate = yield* Ref.get(runtime.resumeGateRef);
    if (resumeGate === undefined) {
      resumeGate = yield* Deferred.make<void>();
      yield* Ref.set(runtime.resumeGateRef, resumeGate);
    }

    const pausedAfterGate = yield* Ref.get(runtime.pausedRef);
    if (!pausedAfterGate) {
      const currentGate = yield* Ref.get(runtime.resumeGateRef);
      if (currentGate === resumeGate) {
        yield* Ref.set(runtime.resumeGateRef, undefined);
        yield* Deferred.succeed(resumeGate, void 0);
      }
      return;
    }

    yield* Deferred.await(resumeGate);
  });

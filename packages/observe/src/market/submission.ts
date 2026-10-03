import { Effect } from "effect";
import { LiveStreakRuntimeError, type LiveStreakError } from "@livestreak/core";
import type { MarketLifecycleInput } from "./types.js";

/** Submission + checkpoint form one interruption-safe section; confirmation remains cancellable. */
export const retainMarketSubmission = (
  input: MarketLifecycleInput | undefined,
  submit: Effect.Effect<{ readonly hash: string }, LiveStreakError>,
): Effect.Effect<{ readonly hash: string }, LiveStreakError> =>
  Effect.gen(function* () {
    if (input?.submittedHash !== undefined) return { hash: input.submittedHash };
    const result = yield* submit;
    if (input?.onSubmitted !== undefined)
      yield* input
        .onSubmitted(result.hash)
        .pipe(
          Effect.mapError(
            (error) =>
              new LiveStreakRuntimeError({
                message: `Submission ${result.hash} exists but its checkpoint failed: ${error.message}. Read before retrying.`,
              }),
          ),
        );
    return result;
  }).pipe(Effect.uninterruptible);

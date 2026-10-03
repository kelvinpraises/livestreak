import { Effect } from "effect";
import { LiveStreakRuntimeError, type LiveStreakError } from "@livestreak/core";
import type {
  MarketLifecycleInput,
  MarketLifecycleTxResult,
  MarketStreamState,
} from "./types.js";

/** Read before retrying an uncertain end. Never resubmit a transition already on-chain. */
export const confirmMarketEnd = (
  input: MarketLifecycleInput,
  read: Effect.Effect<MarketStreamState, LiveStreakError>,
  send: Effect.Effect<MarketLifecycleTxResult, LiveStreakError>,
): Effect.Effect<MarketLifecycleTxResult, LiveStreakError> =>
  Effect.gen(function* () {
    const current = yield* read;
    if (
      current.status === "ended" &&
      current.scheme === input.scheme &&
      current.id === input.id
    ) {
      // No invented transaction hash: the original response may have been lost.
      return {
        userOpHash: input.submittedHash ?? "",
        alreadyEnded: true,
        endedAtMs: current.endedAtMs,
      };
    }
    if(current.status === "ended" && current.id.length > 0 && input.id.length === 0) return yield* Effect.fail(new LiveStreakRuntimeError({ message: "A replay is already published; refresh the market instead of replacing it with no recording." }));
    const tx = yield* send;
    const actual = yield* read;
    if (
      actual.status !== "ended" ||
      actual.scheme !== input.scheme ||
      actual.id !== input.id
    ) {
      return yield* Effect.fail(
        new LiveStreakRuntimeError({
          message: `End submission ${tx.userOpHash} did not reconcile with the chain. Read before retrying.`,
        }),
      );
    }
    return { ...tx, endedAtMs: actual.endedAtMs };
  });

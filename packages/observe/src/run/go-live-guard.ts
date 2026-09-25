import { Effect } from "effect";
import { LiveStreakConfigError, type LiveStreakError } from "@livestreak/core";

/**
 * Go-live media gate (flow 02): chain state must never go live before real bytes flow.
 *
 * Ordered sequence this guards:
 *   register market → configure capture + publish for that market id → prepare → start
 *   → assertWatchableProof (a SECOND viewer sees init + advancing fragments)
 *   → chain goLive. A producer-start failure reports the split state honestly instead.
 *
 * The viewer probe is injected (direct-lane door dial, host watch endpoint, fake in tests) —
 * this helper judges the proof and owns no sockets, so it stays runnable in every bundle.
 */
export interface WatchableProof {
  /** Bytes of the initialization segment the viewer received (0 = none yet). */
  readonly initBytes: number;
  /** Count of advancing media fragments the viewer received after init. */
  readonly fragments: number;
}

export interface AssertWatchableInput {
  /** Injected viewer probe; transient probe failures keep polling until the deadline. */
  readonly probe: Effect.Effect<WatchableProof, LiveStreakError>;
  /** Advancing fragments required after init. Default 2. */
  readonly minFragments?: number;
  /** Give up after this long. Default 30_000ms. */
  readonly timeoutMs?: number;
  /** Delay between probe attempts. Default 500ms. */
  readonly pollIntervalMs?: number;
}

export const assertWatchableProof = (
  input: AssertWatchableInput
): Effect.Effect<WatchableProof, LiveStreakError> =>
  Effect.gen(function* () {
    const minFragments = input.minFragments ?? 2;
    const timeoutMs = input.timeoutMs ?? 30_000;
    const pollIntervalMs = input.pollIntervalMs ?? 500;
    const deadline = Date.now() + timeoutMs;

    let last: WatchableProof = { initBytes: 0, fragments: 0 };
    for (;;) {
      last = yield* input.probe.pipe(Effect.catchAll(() => Effect.succeed(last)));
      if (last.initBytes > 0 && last.fragments >= minFragments) {
        return last;
      }
      if (Date.now() >= deadline) {
        return yield* Effect.fail(
          new LiveStreakConfigError({
            message:
              `Producer is not delivering watchable media ` +
              `(init=${last.initBytes}b fragments=${last.fragments}, ` +
              `need init>0 and fragments>=${minFragments}). ` +
              `Do NOT mark the market live — fix capture/publish and retry.`
          })
        );
      }
      yield* Effect.sleep(pollIntervalMs);
    }
  });

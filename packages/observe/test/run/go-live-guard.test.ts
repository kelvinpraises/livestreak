import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { LiveStreakConfigError } from "@livestreak/core";
import { assertWatchableProof } from "#run/go-live-guard.js";

describe("assertWatchableProof", () => {
  it("passes once a viewer sees init plus advancing fragments", async () => {
    const proof = await Effect.runPromise(
      assertWatchableProof({
        probe: Effect.succeed({ initBytes: 128, fragments: 2 })
      })
    );

    expect(proof).toEqual({ initBytes: 128, fragments: 2 });
  });

  it("keeps polling through empty and failing probes until bytes arrive", async () => {
    let calls = 0;
    const proof = await Effect.runPromise(
      assertWatchableProof({
        probe: Effect.gen(function* () {
          calls += 1;
          if (calls === 1) return { initBytes: 0, fragments: 0 };
          if (calls === 2) {
            return yield* Effect.fail(
              new LiveStreakConfigError({ message: "connection refused" })
            );
          }
          return { initBytes: 64, fragments: 3 };
        }),
        pollIntervalMs: 1,
        timeoutMs: 5_000
      })
    );

    expect(proof.fragments).toBe(3);
    expect(calls).toBe(3);
  });

  it("fails honestly when no watchable media arrives before the deadline", async () => {
    const exit = await Effect.runPromiseExit(
      assertWatchableProof({
        probe: Effect.succeed({ initBytes: 0, fragments: 0 }),
        pollIntervalMs: 1,
        timeoutMs: 20
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain("not delivering watchable media");
      expect(String(exit.cause)).toContain("Do NOT mark the market live");
    }
  });
});

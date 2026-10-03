import { describe, expect, it } from "vitest";
import { Deferred, Effect, Fiber } from "effect";
import { retainMarketSubmission } from "#market/submission.js";

const input = {
  marketId: `0x${"ab".repeat(32)}` as `0x${string}`,
  scheme: 0 as const,
  id: "",
};

describe("end submission checkpoint safety", () => {
  it("interruption cannot separate a submitted transaction from its checkpoint", async () => {
    let saved: string | undefined;
    await Effect.runPromise(
      Effect.gen(function* () {
        const submitted = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const fiber = yield* retainMarketSubmission(
          {
            ...input,
            onSubmitted: (hash) =>
              Effect.sync(() => {
                saved = hash;
              }),
          },
          Effect.gen(function* () {
            yield* Deferred.succeed(submitted, undefined);
            yield* Deferred.await(release);
            return { hash: "original" };
          }),
        ).pipe(Effect.fork);
        yield* Deferred.await(submitted);
        yield* Fiber.interruptFork(fiber);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.await(fiber);
      }),
    );
    expect(saved).toBe("original");
  });

  it("a retained submission skips sending but still identifies the original transaction", async () => {
    let sends = 0;
    const result = await Effect.runPromise(
      retainMarketSubmission(
        { ...input, submittedHash: "original" },
        Effect.sync(() => {
          sends++;
          return { hash: "duplicate" };
        }),
      ),
    );
    expect(sends).toBe(0);
    expect(result.hash).toBe("original");
  });
});

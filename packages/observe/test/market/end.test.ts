import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { LiveStreakRuntimeError } from "@livestreak/core";
import { confirmMarketEnd } from "#market/end.js";
import type { MarketStreamState } from "#market/types.js";
const input = {
  marketId: `0x${"ab".repeat(32)}` as `0x${string}`,
  scheme: 0 as const,
  id: "",
};
describe("uncertain end reconciliation", () => {
  it("a lost confirmed response reloads from chain without resubmitting or inventing a hash", async () => {
    let state: MarketStreamState = {
      status: "live",
      scheme: 0,
      id: "live-route",
      endedAtMs: 0,
    };
    let sends = 0;
    const read = Effect.sync(() => state);
    const send = Effect.suspend(() => {
      sends++;
      state = { status: "ended", scheme: 0, id: "", endedAtMs: 1234000 };
      return Effect.fail(
        new LiveStreakRuntimeError({ message: "confirmation response lost" }),
      );
    });
    await expect(Effect.runPromise(confirmMarketEnd(input, read, send))).rejects.toThrow(
      "response lost",
    );
    const recovered = await Effect.runPromise(confirmMarketEnd(input, read, send));
    expect(recovered).toEqual({ userOpHash: "", alreadyEnded: true, endedAtMs: 1234000 });
    expect(sends).toBe(1);
  });
  it("confirmation without the intended chain state is an error", async () => {
    const read = Effect.succeed({
      status: "live" as const,
      scheme: 0 as const,
      id: "live",
      endedAtMs: 0,
    });
    await expect(
      Effect.runPromise(
        confirmMarketEnd(input, read, Effect.succeed({ userOpHash: "submitted-original" })),
      ),
    ).rejects.toThrow("submitted-original");
  });
  it("first success reports actual chain time rather than client wall-clock time", async () => {
    let state: MarketStreamState = { status: "live", scheme: 0, id: "live", endedAtMs: 0 };
    const result = await Effect.runPromise(
      confirmMarketEnd(
        input,
        Effect.sync(() => state),
        Effect.sync(() => {
          state = { status: "ended", scheme: 0, id: "", endedAtMs: 5678000 };
          return { userOpHash: "original" };
        }),
      ),
    );
    expect(result).toEqual({ userOpHash: "original", endedAtMs: 5678000 });
  });
});

it("a stale no-recording retry cannot erase a published archive", async () => {
  let sends=0;
  const current:MarketStreamState={status:"ended",scheme:4,id:"a".repeat(64),endedAtMs:1234000};
  await expect(Effect.runPromise(confirmMarketEnd(input,Effect.succeed(current),Effect.sync(()=>{sends++;return {userOpHash:"should-not-send"};})))).rejects.toThrow("replay is already published");
  expect(sends).toBe(0);
});

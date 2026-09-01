import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { verifyMarketRegistration } from "#market/verify.js";

describe("market verification", () => {
  it("rejects a MarketRegistered payload when sender is foreign", async () => {
    const exit = await Effect.runPromiseExit(
      verifyMarketRegistration({
        decoded: {
          marketId: "0x0000000000000000000000000000000000000000000000000000000000000001",
          streamId: "0x00000000000000000000000000000000000000000000000000000000000000aa",
          title: "Derby"
        },
        expectedStreamId:
          "0x00000000000000000000000000000000000000000000000000000000000000aa",
        sender: "0x0000000000000000000000000000000000000bad",
        expectedSender: "0x00000000000000000000000000000000000000aa",
        userOpHash: "0xuserop"
      })
    );

    expect(exit._tag).toBe("Failure");
  });

  it("accepts matching streamId and sender", async () => {
    const verified = await Effect.runPromise(
      verifyMarketRegistration({
        decoded: {
          marketId: "0x0000000000000000000000000000000000000000000000000000000000000001",
          streamId: "0x00000000000000000000000000000000000000000000000000000000000000aa",
          title: "Derby"
        },
        expectedStreamId:
          "0x00000000000000000000000000000000000000000000000000000000000000aa",
        sender: "0x00000000000000000000000000000000000000aa",
        expectedSender: "0x00000000000000000000000000000000000000aa",
        userOpHash: "0xuserop"
      })
    );

    expect(verified.marketId).toBe(
      "0x0000000000000000000000000000000000000000000000000000000000000001"
    );
  });
});

import { LiveStreakConfigError } from "@livestreak/core";
import { describe, expect, it } from "vitest";

import { validateRate } from "../../src/model/validate.js";
import { createFakeChainWriter } from "../helpers/fake-chain.js";

describe("chain writer lvst", () => {
  it("stakeLvst records amount", async () => {
    const writer = createFakeChainWriter();
    const amount = 250_000_000_000_000_000n;

    await writer.stakeLvst({ amount });

    expect(writer.requests[0]).toEqual({ action: "stakeLvst", args: { amount } });
  });

  it("unstakeLvst records amount", async () => {
    const writer = createFakeChainWriter();
    const amount = 100_000_000_000_000_000n;

    await writer.unstakeLvst({ amount });

    expect(writer.requests[0]).toEqual({ action: "unstakeLvst", args: { amount } });
  });

  it("claimDividends records action", async () => {
    const writer = createFakeChainWriter();

    await writer.claimDividends();

    expect(writer.requests[0]).toEqual({ action: "claimDividends", args: {} });
  });

  it("rejects zero rate at domain validation", () => {
    expect(() => validateRate(0n)).toThrow(LiveStreakConfigError);
  });
});

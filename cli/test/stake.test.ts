import { describe, expect, it } from "vitest";

import { LVST_DECIMALS_EVM, LVST_DECIMALS_SUI, parseHumanLvstAmount } from "../src/commands/args.js";

describe("parseHumanLvstAmount", () => {
  it("scales whole LVST for EVM (18 decimals)", () => {
    expect(parseHumanLvstAmount("400", "evm")).toBe(400n * 10n ** BigInt(LVST_DECIMALS_EVM));
  });

  it("scales fractional LVST for EVM", () => {
    expect(parseHumanLvstAmount("1.5", "evm")).toBe(15n * 10n ** 17n);
  });

  it("uses 9 decimals on Sui", () => {
    expect(parseHumanLvstAmount("400", "sui")).toBe(400n * 10n ** BigInt(LVST_DECIMALS_SUI));
  });
});

import { describe, expect, it } from "vitest";
import { LiveStreakConfigError } from "@livestreak/core";

import {
  sideToSolidityValue,
  validateDepositBounds,
  validateMarketIdForContracts,
  validateSeedRate
} from "../../../src/chains/evm/encode.js";

const MAX_DEPOSIT = BigInt("0x7fffffffffffffffffffffffffffffff");

describe("sideToSolidityValue", () => {
  it("maps yes to 0 and no to 1", () => {
    expect(sideToSolidityValue("yes")).toBe(0);
    expect(sideToSolidityValue("no")).toBe(1);
  });
});

describe("validateMarketIdForContracts", () => {
  it("accepts a valid bytes32 hex string", () => {
    const marketId = `0x${"ab".repeat(32)}`;
    expect(validateMarketIdForContracts(marketId)).toBe(marketId);
  });

  it("rejects non-0x prefix", () => {
    expect(() => validateMarketIdForContracts(`${"ab".repeat(32)}`)).toThrow(LiveStreakConfigError);
  });

  it("rejects wrong length", () => {
    expect(() => validateMarketIdForContracts("0xabcd")).toThrow(LiveStreakConfigError);
  });
});

describe("validateDepositBounds", () => {
  it("accepts positive deposits within int128 max", () => {
    expect(validateDepositBounds(1n)).toBe(1n);
    expect(validateDepositBounds(MAX_DEPOSIT)).toBe(MAX_DEPOSIT);
  });

  it("rejects zero", () => {
    expect(() => validateDepositBounds(0n)).toThrow(LiveStreakConfigError);
  });

  it("rejects negative values", () => {
    expect(() => validateDepositBounds(-1n)).toThrow(LiveStreakConfigError);
  });

  it("rejects values above int128 max", () => {
    expect(() => validateDepositBounds(MAX_DEPOSIT + 1n)).toThrow(LiveStreakConfigError);
  });

  it("rejects non-bigint values", () => {
    expect(() => validateDepositBounds(5 as unknown as bigint)).toThrow(LiveStreakConfigError);
  });
});

describe("validateSeedRate", () => {
  it("accepts positive bigint rates", () => {
    expect(validateSeedRate(8_333n)).toBe(8_333n);
  });

  it("rejects zero", () => {
    expect(() => validateSeedRate(0n)).toThrow(LiveStreakConfigError);
  });

  it("rejects negative values", () => {
    expect(() => validateSeedRate(-1n)).toThrow(LiveStreakConfigError);
  });

  it("rejects non-bigint values", () => {
    expect(() => validateSeedRate(100 as unknown as bigint)).toThrow(LiveStreakConfigError);
  });
});

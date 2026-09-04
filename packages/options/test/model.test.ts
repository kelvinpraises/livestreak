import { LiveStreakConfigError } from "@livestreak/core";
import { describe, expect, it } from "vitest";

import {
  BASE_PRICE,
  CURVE_K,
  isOptionsVaultSide,
  priceOf,
  sharesPerUsdc,
  totalVaultPool,
  validateOptionsVaultSide
} from "../src/model/index.js";
import { fixtureResolvedVault, fixtureVault } from "./helpers/fake-chain.js";

describe("options model", () => {
  it("allows YES and NO sides", () => {
    expect(isOptionsVaultSide("yes")).toBe(true);
    expect(isOptionsVaultSide("no")).toBe(true);
    expect(validateOptionsVaultSide("yes")).toBe("yes");
    expect(validateOptionsVaultSide("no")).toBe("no");
  });

  it("rejects invalid side values", () => {
    expect(() => validateOptionsVaultSide("maybe")).toThrow(LiveStreakConfigError);
    expect(() => validateOptionsVaultSide("YES")).toThrow(LiveStreakConfigError);
  });

  it("computes total vault pool from YES and NO pools", () => {
    const vault = fixtureResolvedVault();

    expect(totalVaultPool(vault.pools)).toBe(597_000_000n);
  });

  it("computes priceOf from pool size using bonding curve constants", () => {
    expect(priceOf(0n)).toBe(BASE_PRICE);
    expect(priceOf(CURVE_K)).toBe(BASE_PRICE * 2n);
  });

  it("computes sharesPerUsdc from pool price", () => {
    const pool = 50_000_000n;
    const expectedPrice = BASE_PRICE + (BASE_PRICE * pool) / CURVE_K;

    expect(sharesPerUsdc(pool)).toBe(1_000_000n / expectedPrice);
    expect(sharesPerUsdc(0n)).toBe(10n);
  });

  it("models open vault pool composition", () => {
    const vault = fixtureVault();

    expect(vault.pools.yes).toBe(94_000_000n);
    expect(vault.pools.no).toBe(185_000_000n);
    expect(totalVaultPool(vault.pools)).toBe(279_000_000n);
  });
});

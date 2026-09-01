import { LiveStreakConfigError } from "@livestreak/core";
import { describe, expect, it } from "vitest";

import {
  emptySidePosition,
  hasVaultExposure,
  isOptionsVaultSide,
  totalVaultPool,
  validateOptionsVaultSide
} from "../src/model/index.js";
import { fixtureResolvedPosition, fixtureResolvedVault } from "./helpers/fake-transport.js";

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

  it("supports user positions with both YES and NO exposure", () => {
    const position = fixtureResolvedPosition();

    expect(hasVaultExposure(position)).toBe(true);
    expect(position.positions.yes.shares).toBeGreaterThan(0n);
    expect(position.positions.no.shares).toBeGreaterThan(0n);
  });

  it("models resolved vault winning side claimable and losing side loss claim", () => {
    const vault = fixtureResolvedVault();
    const position = fixtureResolvedPosition();

    expect(vault.outcome).toBe("yes");
    expect(position.positions.yes.claimable).toBeGreaterThan(0n);
    expect(position.positions.no.lossClaimable).toBeGreaterThan(0n);
  });

  it("computes total vault pool from YES and NO pools", () => {
    const vault = fixtureResolvedVault();

    expect(totalVaultPool(vault.pools)).toBe(597_000_000n);
  });

  it("provides empty side positions for both sides", () => {
    expect(emptySidePosition("yes").side).toBe("yes");
    expect(emptySidePosition("no").side).toBe("no");
  });
});

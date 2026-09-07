import { describe, expect, it } from "vitest";
import { encodeErrorResult } from "viem";
import { describeChainError } from "../src/adapters/revert.js";

const errorStringAbi = [
  { type: "error", name: "Error", inputs: [{ type: "string" }] }
] as const;

describe("describeChainError — surfaces the inner revert reason", () => {
  it("extracts an Error(string) reason hidden inside an ExecutionFailed wrapper", () => {
    const inner = encodeErrorResult({
      abi: errorStringAbi,
      errorName: "Error",
      args: ["MarketRegistry: market exists"]
    });
    const wrapped = new Error(
      `UserOperation reverted with ExecutionFailed() 0xacfdb444; data=${inner}`
    );
    const out = describeChainError(wrapped);
    expect(out).toContain("MarketRegistry: market exists");
    expect(out).toContain("ExecutionFailed()");
  });

  it("notes a bare ExecutionFailed selector when no inner reason is recoverable", () => {
    const out = describeChainError(new Error("reverted: 0xacfdb444"));
    expect(out).toMatch(/ExecutionFailed\(\)/);
  });

  it("falls back to the raw message for plain errors", () => {
    expect(describeChainError(new Error("boom"))).toBe("boom");
  });
});

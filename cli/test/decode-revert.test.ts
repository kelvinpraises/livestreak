import { describe, expect, it } from "vitest";
import { encodeErrorResult, type Hex } from "viem";
import { decodeRevertData, enrichRelayErrorMessage } from "../src/gateway/decode-revert.js";

describe("decode-revert", () => {
  it("decodes ExecutionFailed selector to a human string", () => {
    expect(decodeRevertData("0xacfdb444" as Hex)).toBe(
      "ExecutionFailed() (Safe4337 masked inner revert)"
    );
  });

  it("decodes Error(string) payloads", () => {
    const data = encodeErrorResult({
      abi: [{ type: "error", name: "Error", inputs: [{ type: "string", name: "message" }] }],
      errorName: "Error",
      args: ["ERC20: transfer amount exceeds balance"]
    });
    expect(decodeRevertData(data)).toBe("ERC20: transfer amount exceeds balance");
  });

  it("enrichRelayErrorMessage appends innerRevert for masked ExecutionFailed hex", () => {
    const base =
      "UserOperation reverted during simulation with reason: AA23 reverted 0xacfdb444";
    const enriched = enrichRelayErrorMessage(base);
    expect(enriched).toContain("innerRevert:");
    expect(enriched).toContain("ExecutionFailed()");
  });

  it("enrichRelayErrorMessage passes through host-enriched reason suffix", () => {
    const already =
      "bundler error reason: ERC20: transfer amount exceeds balance";
    expect(enrichRelayErrorMessage(already)).toBe(already);
  });
});

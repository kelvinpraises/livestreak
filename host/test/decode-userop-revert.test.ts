import { encodeErrorResult, type Hex, parseAbi } from "viem";
import { describe, expect, it } from "vitest";
import {
  decodeRevertData,
  enrichBundlerJsonRpcError
} from "#services/aa/decode-userop-revert.js";

const entryPointErrors = parseAbi([
  "error FailedOp(uint256 opIndex, string reason)",
  "error FailedOpWithRevert(uint256 opIndex, string reason, bytes inner)"
]);

describe("decodeRevertData", () => {
  it("decodes Error(string) revert payloads", () => {
    const inner = encodeErrorResult({
      abi: parseAbi(["error Error(string)"]),
      errorName: "Error",
      args: ["MarketRegistry: market exists"]
    });

    expect(decodeRevertData(inner)).toBe("MarketRegistry: market exists");
  });

  it("decodes Safe ExecutionFailed selector", () => {
    expect(decodeRevertData("0xacfdb444" as Hex)).toBe(
      "ExecutionFailed() (Safe4337 masked inner revert)"
    );
  });

  it("unwraps FailedOpWithRevert inner bytes", () => {
    const inner = encodeErrorResult({
      abi: parseAbi(["error Error(string)"]),
      errorName: "Error",
      args: ["MarketRegistry: market exists"]
    });
    const wrapped = encodeErrorResult({
      abi: entryPointErrors,
      errorName: "FailedOpWithRevert",
      args: [0n, "AA23 reverted", inner]
    });

    expect(decodeRevertData(wrapped)).toBe(
      "AA23 reverted — MarketRegistry: market exists"
    );
  });
});

describe("enrichBundlerJsonRpcError", () => {
  it("appends innerRevert when message carries masked ExecutionFailed hex", () => {
    const enriched = enrichBundlerJsonRpcError({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32500,
        message:
          "UserOperation reverted during simulation with reason: AA23 reverted 0xacfdb444"
      }
    }) as { error: { message: string } };

    expect(enriched.error.message).toContain("innerRevert:");
    expect(enriched.error.message).toContain("ExecutionFailed()");
  });

  it("appends reason for undecoded Error(string) hex in the message", () => {
    const inner = encodeErrorResult({
      abi: parseAbi(["error Error(string)"]),
      errorName: "Error",
      args: ["MarketRegistry: market exists"]
    });

    const enriched = enrichBundlerJsonRpcError({
      jsonrpc: "2.0",
      id: 2,
      error: {
        code: -32500,
        message: `UserOperation reverted during simulation with reason: AA23 reverted ${inner}`
      }
    }) as { error: { message: string } };

    expect(enriched.error.message).toContain("reason: MarketRegistry: market exists");
  });

  it("leaves already-human-readable messages unchanged", () => {
    const original = {
      jsonrpc: "2.0",
      id: 3,
      error: {
        code: -32500,
        message:
          "UserOperation reverted during simulation with reason: AA23 reverted MarketRegistry: market exists"
      }
    };

    expect(enrichBundlerJsonRpcError(original)).toEqual(original);
  });
});
